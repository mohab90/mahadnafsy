'use strict';
/**
 * «صندوق الرسائل» — the company's WhatsApp number, Facebook page and Instagram
 * account in one inbox that every sales rep works from.
 *
 * A conversation is the rep's it is assigned to; the others see who has it.
 * New people land with the rep who owns their lead, or with nobody until a
 * rep takes them — and answering an unowned conversation takes it, so two
 * reps cannot both answer the same customer. Anyone whose data scope is
 * «everything» (the sales manager, the owner) sees and moves every
 * conversation; a rep can hand their own to a colleague.
 *
 * Replies go out from the company identity the conversation came in on, not
 * a rep's personal number, and are recorded on the CRM timeline with the
 * provider's id, so WhatsApp's delivered / read ticks come back onto them.
 */
const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'team-inbox' });
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { sendWhatsApp, sendWhatsAppTemplate, listMetaTemplates } = require('../lib/whatsapp');
const { sendMessengerMessage, PLATFORM: SOCIAL } = require('../lib/messenger');
const { getSendableChannel } = require('../lib/messagingChannels');
const { isWindowOpen, recordOnThread, PLATFORMS } = require('../lib/inboxThreads');
const { loadSettings: loadBotSettings } = require('../lib/inboxBot');
const { createNotification } = require('../lib/notification');
const { resolveDataScope } = require('../constants/permissions');
const { requireAuth, requireAdminOrStaff, requireChannel } = require('../middleware/auth');
const { bulkOperationLimiter } = require('../middleware/rateLimits');

const guard = [requireAuth, requireAdminOrStaff, requireChannel('inbox')];
const me = req => req.staffRecord?.id || null;
const seesAll = req => resolveDataScope(req.staffRecord, { isSuperAdmin: req.isSuperAdmin }) === 'all';

const TYPE = { whatsapp: 'WHATSAPP', messenger: 'MESSENGER', instagram: 'INSTAGRAM' };

const SEND_FAILURES = {
  daily_limit_reached: 'رقم الشركة وصل للحد اليومي — كلّم الإدارة ترفعه',
  invalid_number: 'رقم العميل مش صالح للإرسال',
  channel_unavailable: 'القناة اللي المحادثة جت عليها مش متصلة — كلّم الإدارة',
  not_configured: 'مفيش قناة متصلة — كلّم الإدارة',
  category_disabled: 'الرد من صندوق الرسائل مقفول — الإدارة تفتحه من «صحة الرسايل ← أنواع رسايل الواتساب المسموح بيها» (الرد على العملاء)',
  templates_need_meta: 'القوالب محتاجة رقم الشركة على واتساب الرسمي (Meta Cloud API)',
  template_required: 'اختار قالب',
};

function fail(res, error, where) {
  if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message, code: error.code });
  logger.error(where, error);
  return res.status(500).json({ error: 'Internal server error' });
}

const refuse = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, code });

const THREAD_COLUMNS = `t.id, t.platform, t.contact_key, t.channel_id, t.lead_id, t.subscriber_id,
  COALESCE(s.name, l.name, t.contact_name) AS name, COALESCE(s.phone, l.phone) AS phone,
  t.assigned_staff_id, st.name AS assigned_name, t.status, t.unread_count, t.last_direction,
  t.last_preview, t.last_message_at, t.last_inbound_at, t.labels, t.bot_paused, t.bot_replies`;
const THREAD_JOINS = `
  LEFT JOIN leads l       ON l.id = t.lead_id AND l.tenant_id = t.tenant_id
  LEFT JOIN subscribers s ON s.id = t.subscriber_id AND s.tenant_id = t.tenant_id
  LEFT JOIN staff st      ON st.id = t.assigned_staff_id AND st.tenant_id = t.tenant_id`;

const parseLabels = raw => {
  try { const list = JSON.parse(raw || '[]'); return Array.isArray(list) ? list.map(String) : []; } catch { return []; }
};
const present = row => ({
  ...row,
  unread_count: Number(row.unread_count) || 0,
  windowOpen: isWindowOpen(row.last_inbound_at),
  labels: parseLabels(row.labels),
  bot_paused: !!row.bot_paused,
  bot_replies: Number(row.bot_replies) || 0,
});

/** A label as stored: trimmed, single-spaced, at most 30 characters. */
const cleanLabel = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 30);

/** One thread the caller may see, or a refusal. */
async function visibleThread(req, id, db = pool) {
  const [[thread]] = await db.query(
    `SELECT ${THREAD_COLUMNS} FROM inbox_threads t ${THREAD_JOINS} WHERE t.tenant_id=? AND t.id=? LIMIT 1`,
    [req.tenantId, id]);
  if (!thread) throw refuse(404, 'المحادثة مش موجودة');
  if (!seesAll(req) && thread.assigned_staff_id && thread.assigned_staff_id !== me(req)) {
    throw refuse(403, `المحادثة دي مع ${thread.assigned_name || 'زميل تاني'}`, 'THREAD_TAKEN');
  }
  return thread;
}

/**
 * GET /api/admin/team-inbox/threads
 *   view      mine (default) | unassigned | all — «all» is mine + unassigned for a rep
 *   platform  whatsapp | messenger | instagram
 *   status    open (default) | closed
 *   q         name or number
 *   before    last_message_at of the last row shown, for the next page
 */
router.get('/api/admin/team-inbox/threads', ...guard, async (req, res) => {
  try {
    const where = ['1=1'];
    const params = [];
    const view = ['mine', 'unassigned', 'all'].includes(req.query.view) ? req.query.view : 'mine';
    if (view === 'mine') { where.push('t.assigned_staff_id = ?'); params.push(me(req)); }
    else if (view === 'unassigned') where.push('t.assigned_staff_id IS NULL');
    else if (!seesAll(req)) { where.push('(t.assigned_staff_id = ? OR t.assigned_staff_id IS NULL)'); params.push(me(req)); }
    if (PLATFORMS.includes(req.query.platform)) { where.push('t.platform = ?'); params.push(req.query.platform); }
    where.push('t.status = ?'); params.push(req.query.status === 'closed' ? 'closed' : 'open');
    if (req.query.unread === '1') where.push('t.unread_count > 0');
    // Waiting on us: the customer spoke last.
    if (req.query.waiting === '1') where.push("t.last_direction = 'IN'");
    const label = cleanLabel(req.query.label);
    if (label) { where.push('JSON_CONTAINS(COALESCE(t.labels, \'[]\'), JSON_QUOTE(?))'); params.push(label); }
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
      where.push('(t.contact_name LIKE ? OR t.contact_key LIKE ? OR l.name LIKE ? OR s.name LIKE ?)');
      params.push(like, like, like, like);
    }
    if (req.query.before) { where.push('t.last_message_at < ?'); params.push(new Date(String(req.query.before))); }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const [rows] = await pool.query(
      `SELECT ${THREAD_COLUMNS} FROM inbox_threads t ${THREAD_JOINS}
        WHERE t.tenant_id = ? AND ${where.join(' AND ')}
        ORDER BY t.last_message_at DESC LIMIT ?`,
      [req.tenantId, ...params, limit]);
    res.json({ threads: rows.map(present), hasMore: rows.length === limit, seesAll: seesAll(req) });
  } catch (error) { fail(res, error, '[team-inbox list]'); }
});

/** The badges: what is waiting on me, and what nobody has taken. */
router.get('/api/admin/team-inbox/counts', ...guard, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT SUM(assigned_staff_id = ?) AS mine,
              SUM(assigned_staff_id = ? AND unread_count > 0) AS mineUnread,
              SUM(assigned_staff_id IS NULL) AS unassigned,
              COUNT(*) AS allOpen
         FROM inbox_threads WHERE tenant_id = ? AND status = 'open'`,
      [me(req), me(req), req.tenantId]);
    res.json({
      mine: Number(row.mine) || 0, mineUnread: Number(row.mineUnread) || 0,
      unassigned: Number(row.unassigned) || 0, all: seesAll(req) ? Number(row.allOpen) || 0 : null,
    });
  } catch (error) { fail(res, error, '[team-inbox counts]'); }
});

/** One conversation with its messages, oldest first. Opening your own marks it read. */
router.get('/api/admin/team-inbox/threads/:id', ...guard, async (req, res) => {
  try {
    const thread = await visibleThread(req, req.params.id);
    const [messages] = await pool.query(
      `SELECT c.id, c.type, c.direction, c.date, c.notes AS text, c.delivery_status,
              c.staff_id, st.name AS staff_name, (c.outcome = 'BOT') AS by_bot
         FROM communications c
         LEFT JOIN staff st ON st.id = c.staff_id AND st.tenant_id = c.tenant_id
        WHERE c.tenant_id = ? AND c.thread_id = ?
        ORDER BY c.date DESC LIMIT 300`,
      [req.tenantId, thread.id]);
    if (thread.assigned_staff_id && thread.assigned_staff_id === me(req) && thread.unread_count > 0) {
      await pool.query('UPDATE inbox_threads SET unread_count = 0 WHERE tenant_id=? AND id=?', [req.tenantId, thread.id]);
      thread.unread_count = 0;
    }
    // The team's notes, drawn in the timeline between the messages.
    const [notes] = await pool.query(
      `SELECT n.id, n.body, n.created_at AS date, n.staff_id, st.name AS staff_name
         FROM inbox_notes n LEFT JOIN staff st ON st.id = n.staff_id AND st.tenant_id = n.tenant_id
        WHERE n.tenant_id = ? AND n.thread_id = ? ORDER BY n.created_at DESC LIMIT 100`,
      [req.tenantId, thread.id]);
    const bot = await loadBotSettings(req.tenantId).catch(() => null);
    res.json({ thread: present(thread), messages: messages.reverse(), notes: notes.reverse(), botEnabled: !!(bot?.enabled && bot.platforms[thread.platform]) });
  } catch (error) { fail(res, error, '[team-inbox thread]'); }
});

/** Take an unowned conversation. */
router.post('/api/admin/team-inbox/threads/:id/claim', ...guard, async (req, res) => {
  try {
    if (!me(req)) throw refuse(403, 'الحساب ده مش مربوط بموظف — حوّلها لموظف بدل ما تستلمها');
    const [result] = await pool.query(
      `UPDATE inbox_threads SET assigned_staff_id=?, assigned_at=NOW()
        WHERE tenant_id=? AND id=? AND assigned_staff_id IS NULL`,
      [me(req), req.tenantId, req.params.id]);
    if (!result.affectedRows) {
      const thread = await visibleThread(req, req.params.id);
      if (thread.assigned_staff_id !== me(req)) throw refuse(409, `زميلك ${thread.assigned_name || ''} استلمها قبلك`.trim(), 'THREAD_TAKEN');
    }
    res.json({ ok: true });
  } catch (error) { fail(res, error, '[team-inbox claim]'); }
});

/** Hand a conversation to a colleague (or back to the unassigned queue). */
router.post('/api/admin/team-inbox/threads/:id/assign', ...guard, async (req, res) => {
  try {
    const thread = await visibleThread(req, req.params.id);
    if (!seesAll(req) && thread.assigned_staff_id !== me(req)) {
      throw refuse(403, 'استلم المحادثة الأول عشان تقدر تحوّلها', 'NOT_OWNER');
    }
    const staffId = req.body?.staffId ? String(req.body.staffId) : null;
    let target = null;
    if (staffId) {
      [[target]] = await pool.query(
        'SELECT id, name FROM staff WHERE tenant_id=? AND id=? AND is_active=1 AND deleted_at IS NULL LIMIT 1',
        [req.tenantId, staffId]);
      if (!target) throw refuse(404, 'الموظف مش موجود');
    }
    await pool.query(
      'UPDATE inbox_threads SET assigned_staff_id=?, assigned_at=IF(? IS NULL, NULL, NOW()) WHERE tenant_id=? AND id=?',
      [staffId, staffId, req.tenantId, thread.id]);
    if (target && target.id !== me(req)) {
      await createNotification('inbox', 'اتحولتلك محادثة',
        `${req.staffRecord?.name || 'الإدارة'} حوّلك محادثة ${thread.name || thread.contact_key}`,
        { threadId: thread.id, leadId: thread.lead_id }, req.tenantId, target.id).catch(() => {});
    }
    res.json({ ok: true, assignedTo: target ? { id: target.id, name: target.name } : null });
  } catch (error) { fail(res, error, '[team-inbox assign]'); }
});

/** Close a finished conversation, or reopen one. A new message reopens it anyway. */
router.post('/api/admin/team-inbox/threads/:id/status', ...guard, async (req, res) => {
  try {
    const thread = await visibleThread(req, req.params.id);
    const status = req.body?.status === 'closed' ? 'closed' : 'open';
    await pool.query('UPDATE inbox_threads SET status=?, unread_count=IF(?=\'closed\', 0, unread_count) WHERE tenant_id=? AND id=?',
      [status, status, req.tenantId, thread.id]);
    res.json({ ok: true, status });
  } catch (error) { fail(res, error, '[team-inbox status]'); }
});

/**
 * POST /api/admin/team-inbox/threads/:id/reply
 *   { text }                         inside the 24-hour window
 *   { template: {name, language, params} }   WhatsApp, any time
 */
router.post('/api/admin/team-inbox/threads/:id/reply', ...guard, bulkOperationLimiter, async (req, res) => {
  try {
    // An owner's account with no staff row answers without taking the
    // conversation: a conversation belongs to someone who can be handed it.
    if (!me(req) && !seesAll(req)) throw refuse(403, 'الحساب ده مش مربوط بموظف');
    let thread = await visibleThread(req, req.params.id);
    const text = String(req.body?.text || '').trim().slice(0, 4000);
    const template = req.body?.template && req.body.template.name ? req.body.template : null;
    if (!text && !template) throw refuse(400, 'اكتب الرسالة');
    if (template && thread.platform !== 'whatsapp') throw refuse(400, 'القوالب للواتساب بس');
    if (!template && !isWindowOpen(thread.last_inbound_at)) {
      throw refuse(409, thread.platform === 'whatsapp'
        ? 'عدّت 24 ساعة على آخر رسالة من العميل — ميتا مش هتوصّل رسالة عادية. ابعت قالب.'
        : 'عدّت 24 ساعة على آخر رسالة من العميل — مش هينفع رد لحد ما يبعت تاني.', 'WINDOW_CLOSED');
    }

    // Answering an unowned conversation takes it — the same conditional
    // UPDATE as «استلام», so two reps answering at once cannot both win.
    if (!thread.assigned_staff_id && me(req)) {
      const [taken] = await pool.query(
        'UPDATE inbox_threads SET assigned_staff_id=?, assigned_at=NOW() WHERE tenant_id=? AND id=? AND assigned_staff_id IS NULL',
        [me(req), req.tenantId, thread.id]);
      if (!taken.affectedRows) thread = await visibleThread(req, thread.id);
    }

    let result;
    let channelId = thread.channel_id || null;
    if (thread.platform === 'whatsapp') {
      result = template
        ? await sendWhatsAppTemplate(thread.contact_key, template, { tenantId: req.tenantId, channelId, category: 'inbox_reply' })
        : await sendWhatsApp(thread.contact_key, text, { tenantId: req.tenantId, channelId, category: 'inbox_reply' });
      channelId = result.channelId || channelId;
    } else {
      // Messenger and Instagram answer through the page's token.
      const resolved = (channelId && await getSendableChannel({ tenantId: req.tenantId, channelId, kind: 'messenger' }).catch(() => null))
        || await getSendableChannel({ tenantId: req.tenantId, kind: 'messenger' }).catch(() => null);
      if (!resolved) throw refuse(409, SEND_FAILURES.not_configured);
      channelId = resolved.row.id;
      result = await sendMessengerMessage(thread.contact_key, text, resolved.credentials);
    }
    if (!result?.ok) {
      const reason = typeof result?.reason === 'string' ? result.reason : null;
      const metaMessage = result?.reason?.error?.message;
      return res.status(502).json({
        error: (reason && SEND_FAILURES[reason]) || (metaMessage ? `ميتا رفضت: ${metaMessage}` : 'لم يتم الإرسال'),
        reason: reason || undefined,
      });
    }

    const shown = template
      ? `📋 قالب «${template.name}»${(template.params || []).length ? `: ${template.params.join(' · ')}` : ''}`
      : text;
    const prefix = thread.platform === 'whatsapp' ? '' : SOCIAL[thread.platform].idPrefix;
    const id = uuidv4();
    const now = new Date();
    await pool.query(
      `INSERT INTO communications
         (id, tenant_id, lead_id, subscriber_id, type, direction, provider_message_id, channel_id,
          thread_id, delivery_status, date, notes, staff_id, created_at)
       VALUES (?,?,?,?,?, 'OUT', ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [id, req.tenantId, thread.lead_id, thread.subscriber_id, TYPE[thread.platform],
        result.idMessage ? `${prefix}${result.idMessage}` : null, channelId, thread.id,
        result.idMessage ? 'sent' : null, now, shown, me(req)]);
    await recordOnThread(pool, { tenantId: req.tenantId, threadId: thread.id, direction: 'OUT', text: shown, at: now });
    // A person answered: the bot leaves this conversation to them.
    await pool.query('UPDATE inbox_threads SET bot_paused=1 WHERE tenant_id=? AND id=?', [req.tenantId, thread.id]);
    res.json({ ok: true, id, messageId: result.idMessage || null });
  } catch (error) { fail(res, error, '[team-inbox reply]'); }
});

/** The conversation's labels, replaced as a whole. */
router.post('/api/admin/team-inbox/threads/:id/labels', ...guard, async (req, res) => {
  try {
    const thread = await visibleThread(req, req.params.id);
    const labels = [...new Set((Array.isArray(req.body?.labels) ? req.body.labels : []).map(cleanLabel).filter(Boolean))].slice(0, 8);
    await pool.query('UPDATE inbox_threads SET labels=? WHERE tenant_id=? AND id=?',
      [labels.length ? JSON.stringify(labels) : null, req.tenantId, thread.id]);
    res.json({ ok: true, labels });
  } catch (error) { fail(res, error, '[team-inbox labels]'); }
});

/** Every label in use, most used first — the suggestions under the label box. */
router.get('/api/admin/team-inbox/labels', ...guard, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT labels FROM inbox_threads WHERE tenant_id=? AND labels IS NOT NULL ORDER BY last_message_at DESC LIMIT 2000`,
      [req.tenantId]);
    const used = new Map();
    for (const row of rows) for (const label of parseLabels(row.labels)) used.set(label, (used.get(label) || 0) + 1);
    res.json([...used.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([label, count]) => ({ label, count })));
  } catch (error) { fail(res, error, '[team-inbox label list]'); }
});

/** A note for the team on this conversation. The customer never sees it. */
router.post('/api/admin/team-inbox/threads/:id/notes', ...guard, async (req, res) => {
  try {
    const thread = await visibleThread(req, req.params.id);
    const body = String(req.body?.body || '').trim().slice(0, 2000);
    if (!body) throw refuse(400, 'اكتب الملاحظة');
    const id = uuidv4();
    await pool.query('INSERT INTO inbox_notes (id, tenant_id, thread_id, staff_id, body) VALUES (?,?,?,?,?)',
      [id, req.tenantId, thread.id, me(req), body]);
    res.json({ ok: true, id });
  } catch (error) { fail(res, error, '[team-inbox note]'); }
});

/**
 * Hand the conversation back to the bot, or take it from it.
 * A person replying pauses the bot by itself (lib/inboxBot.js).
 */
router.post('/api/admin/team-inbox/threads/:id/bot', ...guard, async (req, res) => {
  try {
    const thread = await visibleThread(req, req.params.id);
    const paused = req.body?.paused !== false;
    await pool.query('UPDATE inbox_threads SET bot_paused=?, bot_replies=IF(?, bot_replies, 0) WHERE tenant_id=? AND id=?',
      [paused ? 1 : 0, paused ? 1 : 0, req.tenantId, thread.id]);
    res.json({ ok: true, botPaused: paused });
  } catch (error) { fail(res, error, '[team-inbox bot]'); }
});

/**
 * Who this is: the lead or client behind the conversation, for the panel
 * beside it — status, course, rep, what they paid and still owe.
 */
router.get('/api/admin/team-inbox/threads/:id/contact', ...guard, async (req, res) => {
  try {
    const thread = await visibleThread(req, req.params.id);
    let lead = null; let client = null; let payments = [];
    if (thread.lead_id) {
      [[lead]] = await pool.query(
        `SELECT l.id, l.client_code, l.name, l.phone, l.email, l.status, l.source, l.branch, l.created_at,
                l.assigned_sales_name, l.next_follow_up_date, l.last_contact_note, c.title AS course_title
           FROM leads l LEFT JOIN courses c ON c.id = l.enrolled_course_id AND c.tenant_id = l.tenant_id
          WHERE l.tenant_id=? AND l.id=? LIMIT 1`, [req.tenantId, thread.lead_id]);
    }
    if (thread.subscriber_id) {
      [[client]] = await pool.query(
        `SELECT id, client_code, name, name_ar, phone, email, branch, assigned_sales_name, assigned_cs_name, created_at
           FROM subscribers WHERE tenant_id=? AND id=? LIMIT 1`, [req.tenantId, thread.subscriber_id]);
      [payments] = await pool.query(
        `SELECT p.id, p.date, p.amount, p.currency, p.amount_egp, p.status, p.payment_type,
                COALESCE(c.title, b.title, p.item_title) AS item
           FROM payments p
           LEFT JOIN courses c ON c.id = p.course_id AND c.tenant_id = p.tenant_id
           LEFT JOIN bundles b ON b.id = p.bundle_id AND b.tenant_id = p.tenant_id
          WHERE p.tenant_id=? AND p.subscriber_id=? AND p.deleted_at IS NULL
          ORDER BY p.date DESC LIMIT 5`, [req.tenantId, thread.subscriber_id]);
    }
    const [[totals]] = thread.subscriber_id
      ? await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount_egp END),0) AS paid FROM payments
          WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL`, [req.tenantId, thread.subscriber_id])
      : [[{ paid: 0 }]];
    const [[history]] = await pool.query(
      `SELECT COUNT(*) AS messages, MIN(date) AS first_at FROM communications WHERE tenant_id=? AND thread_id=?`,
      [req.tenantId, thread.id]);
    res.json({
      lead, client, payments,
      paidEgp: Number(totals.paid) || 0,
      messages: Number(history.messages) || 0,
      firstContactAt: history.first_at,
    });
  } catch (error) { fail(res, error, '[team-inbox contact]'); }
});

/**
 * How fast the team answers: for every reply that followed a customer
 * message, the time between them — per person, over the last `days` days.
 */
router.get('/api/admin/team-inbox/stats', ...guard, async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const [rows] = await pool.query(
      `SELECT x.staff_id, x.by_bot, st.name, COUNT(*) AS replies,
              AVG(TIMESTAMPDIFF(SECOND, x.prev_date, x.date)) AS avg_seconds,
              SUM(TIMESTAMPDIFF(SECOND, x.prev_date, x.date) <= 900) AS within_15m
         FROM (
           SELECT c.staff_id, c.date, c.direction, (c.outcome = 'BOT') AS by_bot,
                  LAG(c.direction) OVER (PARTITION BY c.thread_id ORDER BY c.date) AS prev_direction,
                  LAG(c.date) OVER (PARTITION BY c.thread_id ORDER BY c.date) AS prev_date
             FROM communications c
            WHERE c.tenant_id = ? AND c.thread_id IS NOT NULL AND c.date >= DATE_SUB(NOW(), INTERVAL ? DAY)
         ) x
         LEFT JOIN staff st ON st.id = x.staff_id AND st.tenant_id = ?
        WHERE x.direction = 'OUT' AND x.prev_direction = 'IN'
        GROUP BY x.staff_id, x.by_bot, st.name
        ORDER BY replies DESC`,
      [req.tenantId, days, req.tenantId]);
    const [[waiting]] = await pool.query(
      `SELECT COUNT(*) AS n, MIN(last_inbound_at) AS oldest FROM inbox_threads
        WHERE tenant_id=? AND status='open' AND last_direction='IN'`, [req.tenantId]);
    const [[fresh]] = await pool.query(
      'SELECT COUNT(*) AS n FROM inbox_threads WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)',
      [req.tenantId, days]);
    const people = rows.map(row => ({
      staffId: row.by_bot ? 'bot' : row.staff_id,
      name: row.by_bot ? '🤖 البوت' : row.staff_id ? row.name || 'موظف' : 'الإدارة',
      replies: Number(row.replies) || 0,
      avgMinutes: row.avg_seconds == null ? null : Math.round(Number(row.avg_seconds) / 6) / 10,
      within15m: Number(row.within_15m) || 0,
    }));
    res.json({ days, people, waitingNow: Number(waiting.n) || 0, oldestWaitingAt: waiting.oldest, newConversations: Number(fresh.n) || 0 });
  } catch (error) { fail(res, error, '[team-inbox stats]'); }
});

/** Saved answers. Everyone on the inbox uses them; whoever wrote one, or a manager, edits it. */
router.get('/api/admin/team-inbox/quick-replies', ...guard, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, shortcut, body, created_by FROM inbox_quick_replies WHERE tenant_id=? ORDER BY title LIMIT 300',
      [req.tenantId]);
    res.json(rows);
  } catch (error) { fail(res, error, '[team-inbox quick replies]'); }
});

async function saveQuickReply(req, id) {
  const title = String(req.body?.title || '').trim().slice(0, 120);
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  const shortcut = String(req.body?.shortcut || '').trim().replace(/^\//, '').replace(/\s+/g, '-').toLowerCase().slice(0, 40) || null;
  if (!title || !body) throw refuse(400, 'العنوان والنص مطلوبين');
  if (shortcut) {
    const [[taken]] = await pool.query('SELECT id FROM inbox_quick_replies WHERE tenant_id=? AND shortcut=? AND id<>? LIMIT 1',
      [req.tenantId, shortcut, id || '']);
    if (taken) throw refuse(409, `الاختصار /${shortcut} مستخدم لرد تاني`);
  }
  if (id) {
    const [[row]] = await pool.query('SELECT created_by FROM inbox_quick_replies WHERE tenant_id=? AND id=? LIMIT 1', [req.tenantId, id]);
    if (!row) throw refuse(404, 'الرد مش موجود');
    if (!seesAll(req) && row.created_by && row.created_by !== me(req)) throw refuse(403, 'الرد ده بتاع زميل — المدير بس يعدّله');
    await pool.query('UPDATE inbox_quick_replies SET title=?, shortcut=?, body=? WHERE tenant_id=? AND id=?',
      [title, shortcut, body, req.tenantId, id]);
    return id;
  }
  const newId = uuidv4();
  await pool.query('INSERT INTO inbox_quick_replies (id, tenant_id, title, shortcut, body, created_by) VALUES (?,?,?,?,?,?)',
    [newId, req.tenantId, title, shortcut, body, me(req)]);
  return newId;
}

router.post('/api/admin/team-inbox/quick-replies', ...guard, async (req, res) => {
  try { res.json({ ok: true, id: await saveQuickReply(req, null) }); } catch (error) { fail(res, error, '[team-inbox quick reply save]'); }
});
router.put('/api/admin/team-inbox/quick-replies/:id', ...guard, async (req, res) => {
  try { res.json({ ok: true, id: await saveQuickReply(req, req.params.id) }); } catch (error) { fail(res, error, '[team-inbox quick reply save]'); }
});
router.delete('/api/admin/team-inbox/quick-replies/:id', ...guard, async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT created_by FROM inbox_quick_replies WHERE tenant_id=? AND id=? LIMIT 1', [req.tenantId, req.params.id]);
    if (!row) throw refuse(404, 'الرد مش موجود');
    if (!seesAll(req) && row.created_by && row.created_by !== me(req)) throw refuse(403, 'الرد ده بتاع زميل — المدير بس يمسحه');
    await pool.query('DELETE FROM inbox_quick_replies WHERE tenant_id=? AND id=?', [req.tenantId, req.params.id]);
    res.json({ ok: true });
  } catch (error) { fail(res, error, '[team-inbox quick reply delete]'); }
});

/** Who a conversation can be handed to. */
router.get('/api/admin/team-inbox/agents', ...guard, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, role FROM staff
        WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL ORDER BY name LIMIT 500`,
      [req.tenantId]);
    res.json(rows);
  } catch (error) { fail(res, error, '[team-inbox agents]'); }
});

/** The company number's approved templates, for a reply after 24 hours. */
router.get('/api/admin/team-inbox/templates', ...guard, async (req, res) => {
  try {
    const result = await listMetaTemplates(req.tenantId);
    if (!result.ok) {
      return res.json({
        templates: [],
        error: result.reason === 'waba_missing'
          ? 'ضيف «WhatsApp Business Account ID» في بيانات قناة رقم الشركة'
          : SEND_FAILURES[result.reason] || `ميتا رفضت: ${result.reason}`,
      });
    }
    res.json({ templates: result.templates.filter(t => t.usable) });
  } catch (error) { fail(res, error, '[team-inbox templates]'); }
});

module.exports = router;
