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
const { createNotification } = require('../lib/notification');
const { resolveDataScope } = require('../constants/permissions');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { bulkOperationLimiter } = require('../middleware/rateLimits');

const guard = [requireAuth, requireAdminOrStaff, requirePermission('manage_inbox')];
const me = req => req.staffRecord?.id || null;
const seesAll = req => resolveDataScope(req.staffRecord, { isSuperAdmin: req.isSuperAdmin }) === 'all';

const TYPE = { whatsapp: 'WHATSAPP', messenger: 'MESSENGER', instagram: 'INSTAGRAM' };

const SEND_FAILURES = {
  daily_limit_reached: 'رقم الشركة وصل للحد اليومي — كلّم الإدارة ترفعه',
  invalid_number: 'رقم العميل مش صالح للإرسال',
  channel_unavailable: 'القناة اللي المحادثة جت عليها مش متصلة — كلّم الإدارة',
  not_configured: 'مفيش قناة متصلة — كلّم الإدارة',
  category_disabled: 'الرد من صندوق الرسائل مقفول — الإدارة تفتحه من «قنوات الرسائل ← صحة الرسايل ← أنواع الرسائل» (الرد على العملاء)',
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
  t.last_preview, t.last_message_at, t.last_inbound_at`;
const THREAD_JOINS = `
  LEFT JOIN leads l       ON l.id = t.lead_id AND l.tenant_id = t.tenant_id
  LEFT JOIN subscribers s ON s.id = t.subscriber_id AND s.tenant_id = t.tenant_id
  LEFT JOIN staff st      ON st.id = t.assigned_staff_id AND st.tenant_id = t.tenant_id`;

const present = row => ({ ...row, unread_count: Number(row.unread_count) || 0, windowOpen: isWindowOpen(row.last_inbound_at) });

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
              c.staff_id, st.name AS staff_name
         FROM communications c
         LEFT JOIN staff st ON st.id = c.staff_id AND st.tenant_id = c.tenant_id
        WHERE c.tenant_id = ? AND c.thread_id = ?
        ORDER BY c.date DESC LIMIT 300`,
      [req.tenantId, thread.id]);
    if (thread.assigned_staff_id && thread.assigned_staff_id === me(req) && thread.unread_count > 0) {
      await pool.query('UPDATE inbox_threads SET unread_count = 0 WHERE tenant_id=? AND id=?', [req.tenantId, thread.id]);
      thread.unread_count = 0;
    }
    res.json({ thread: present(thread), messages: messages.reverse() });
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
    res.json({ ok: true, id, messageId: result.idMessage || null });
  } catch (error) { fail(res, error, '[team-inbox reply]'); }
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
