'use strict';
/**
 * The CRM side of the «واتساب» tab (19 Oct 2026): scheduled messages, campaigns from the chat list, handing a chat to a
 * colleague, and an AI-suggested reply. They all go through the rep's own linked WhatsApp (lib/whatsappWeb.js) and the
 * same pacing and daily cap; what is queued is sent by lib/whatsappScheduled.js.
 */
const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'whatsapp-web-crm' });
const { pool } = require('../lib/db');
const { requireAuth, requireAdminOrStaff, requireChannel } = require('../middleware/auth');
const { bulkOperationLimiter } = require('../middleware/rateLimits');
const { hasPermission } = require('../constants/permissions');
const { leadScope } = require('../lib/leadAccess');
const { getTenantSetting } = require('../lib/tenantSettings');
const scheduled = require('../lib/whatsappScheduled');
const store = require('../lib/whatsappWebStore');
const { contextForPhone } = require('../lib/whatsappContext');
const { sendStaffMessage } = require('../lib/staffMessages');

const guard = [requireAuth, requireAdminOrStaff, requireChannel('whatsapp')];
const me = req => req.staffRecord?.id || req.user?.uid;
const tenant = req => req.tenantId;

function fail(res, error, where) {
  if (error instanceof scheduled.ScheduleError) return res.status(error.statusCode).json({ error: error.message, code: error.code });
  const status = error?.statusCode || error?.status;
  if (status && status < 500) return res.status(status).json({ error: error.message, code: error.code });
  logger.error(where, error);
  return res.status(500).json({ error: 'Internal server error' });
}

// ── Scheduled messages ─────────────────────────────────────────────────────
router.get('/api/staff/whatsapp-web/scheduled', ...guard, async (req, res) => {
  try { res.json({ items: await scheduled.listPending(tenant(req), me(req), { jid: req.query.jid ? String(req.query.jid) : undefined }), now: Date.now() }); }
  catch (error) { fail(res, error, '[wa-web scheduled list]'); }
});

router.post('/api/staff/whatsapp-web/scheduled', ...guard, async (req, res) => {
  try {
    const { jid, phone, name, text, sendAt } = req.body || {};
    res.json({ ok: true, ...(await scheduled.scheduleOne(tenant(req), me(req), { jid, phone, name, text, sendAt })) });
  } catch (error) { fail(res, error, '[wa-web scheduled create]'); }
});

router.delete('/api/staff/whatsapp-web/scheduled/:id', ...guard, async (req, res) => {
  try {
    if (!await scheduled.cancel(tenant(req), me(req), req.params.id)) return res.status(404).json({ error: 'الرسالة دي اتبعتت أو اتلغت قبل كده' });
    res.json({ ok: true });
  } catch (error) { fail(res, error, '[wa-web scheduled cancel]'); }
});

// ── Campaigns from the chat list ───────────────────────────────────────────
// POST { jids: [...], text, startAt?, gapSeconds?, label? } — one message to the chosen chats, one after another.
router.post('/api/staff/whatsapp-web/campaign', ...guard, bulkOperationLimiter, async (req, res) => {
  try {
    const jids = [...new Set((Array.isArray(req.body?.jids) ? req.body.jids : []).map(String).filter(Boolean))].slice(0, scheduled.MAX_CAMPAIGN + 1);
    if (!jids.length) return res.status(400).json({ error: 'اختار محادثات الأول', code: 'WA_SCHED_NONE' });
    // The names come from the chat list (the CRM's name first), for «{name}».
    const [chats] = await pool.query(
      `SELECT c.jid, c.phone, COALESCE(s.name, l.name, c.name) AS name
         FROM wa_web_chats c
         LEFT JOIN leads l ON l.tenant_id = c.tenant_id AND l.id = c.lead_id
         LEFT JOIN subscribers s ON s.tenant_id = c.tenant_id AND s.id = c.subscriber_id
        WHERE c.tenant_id=? AND c.staff_id=? AND c.jid IN (?)`, [tenant(req), me(req), jids]);
    const result = await scheduled.scheduleCampaign(tenant(req), me(req), {
      recipients: chats.map(chat => ({ jid: chat.jid, phone: chat.phone, name: chat.name })),
      text: req.body?.text, startAt: req.body?.startAt, gapSeconds: req.body?.gapSeconds, label: req.body?.label,
    });
    res.json({ ok: true, ...result, notInYourChats: Math.max(0, jids.length - chats.length) });
  } catch (error) { fail(res, error, '[wa-web campaign]'); }
});

router.get('/api/staff/whatsapp-web/campaigns', ...guard, async (req, res) => {
  try { res.json({ campaigns: await scheduled.listCampaigns(tenant(req), me(req)) }); }
  catch (error) { fail(res, error, '[wa-web campaigns]'); }
});

router.delete('/api/staff/whatsapp-web/campaigns/:batchId', ...guard, async (req, res) => {
  try { res.json({ ok: true, canceled: await scheduled.cancelBatch(tenant(req), me(req), req.params.batchId) }); }
  catch (error) { fail(res, error, '[wa-web campaign cancel]'); }
});

// ── Hand a chat to a colleague ─────────────────────────────────────────────
// The colleagues to choose from.
router.get('/api/staff/whatsapp-web/colleagues', ...guard, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, role FROM staff WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL AND id<>? ORDER BY name LIMIT 300", [tenant(req), me(req)]);
    res.json({ staff: rows });
  } catch (error) { fail(res, error, '[wa-web colleagues]'); }
});

// POST { jid, staffId, note? }. A lead goes to a sales colleague (its owner changes, on its history); anyone else — a client,
// a number not in the data, or a colleague who is not in sales — is handed over by a message that carries the conversation.
router.post('/api/staff/whatsapp-web/assign', ...guard, async (req, res) => {
  try {
    const jid = String(req.body?.jid || '');
    const staffId = String(req.body?.staffId || '');
    const note = String(req.body?.note || '').trim().slice(0, 600);
    if (!jid || !staffId) return res.status(400).json({ error: 'اختار المحادثة والموظف' });
    if (staffId === String(me(req))) return res.status(400).json({ error: 'دي محادثتك أصلاً' });
    const [[target]] = await pool.query(
      'SELECT id, name, role FROM staff WHERE id=? AND tenant_id=? AND is_active=1 AND deleted_at IS NULL LIMIT 1', [staffId, tenant(req)]);
    if (!target) return res.status(404).json({ error: 'الموظف مش موجود أو مش شغال' });

    const match = await store.matchChat(tenant(req), me(req), jid);
    const [[chat]] = await pool.query('SELECT phone, name FROM wa_web_chats WHERE tenant_id=? AND staff_id=? AND jid=? LIMIT 1', [tenant(req), me(req), jid]);
    if (!chat) return res.status(404).json({ error: 'المحادثة مش موجودة' });

    let reassigned = false;
    if (match.leadId && String(target.role || '').toUpperCase() === 'SALES') {
      const staff = req.staffRecord;
      const scope = leadScope(req, 'l');
      const reachable = !scope.none && (req.isSuperAdmin || (staff && hasPermission(staff, 'manage_leads')));
      if (reachable) {
        const [[row]] = await pool.query(`SELECT 1 AS ok FROM leads l WHERE l.tenant_id=? AND l.id=?${scope.sql} LIMIT 1`, [tenant(req), match.leadId, ...scope.params]);
        if (row) {
          const { assignLead } = require('../lib/leadAssignment');
          const done = await assignLead({
            tenantId: tenant(req), leadId: match.leadId, salesId: target.id,
            actor: { id: staff?.id || null, name: staff?.name || null }, reason: 'محادثة واتساب اتحوّلت لزميل',
            metadata: { via: 'whatsapp-web', note: note || null },
          });
          reassigned = Boolean(done.changed);
        }
      }
    }

    // What the colleague needs to pick it up: who it is, what they asked, the last of the conversation.
    const context = await contextForPhone(tenant(req), chat.phone || store.phoneOfJid(jid) || '', { canSeeMoney: false }).catch(() => null);
    const [recent] = await pool.query(
      'SELECT from_me AS fromMe, body, sent_at AS sentAt FROM wa_web_messages WHERE tenant_id=? AND staff_id=? AND jid=? ORDER BY sent_at DESC, id DESC LIMIT 8',
      [tenant(req), me(req), jid]);
    const who = context?.subscriber?.name || context?.lead?.name || chat.name || (chat.phone ? `+${chat.phone}` : 'محادثة');
    const course = context?.lead?.interested?.[0]?.title || context?.subscriber?.courses?.[0]?.title || '';
    const lines = recent.reverse().map(row => `${row.fromMe ? 'أنا' : 'العميل'}: ${String(row.body || '').replace(/\s+/g, ' ').slice(0, 220)}`);
    const body = [
      `📲 ${req.staffRecord?.name || 'زميلك'} حوّل لك محادثة واتساب`,
      `${who}${chat.phone ? ` — +${chat.phone}` : ''}${course ? `\nمهتم بـ: ${course}` : ''}`,
      reassigned ? 'اتحوّل لك كمان كعميل محتمل في الليدز.' : '',
      note ? `ملاحظته: ${note}` : '',
      lines.length ? `آخر الكلام:\n${lines.join('\n')}` : '',
      `ابعتله من «واتسابي» برقمك: +${chat.phone || ''}`,
    ].filter(Boolean).join('\n');
    await sendStaffMessage(pool, { tenantId: tenant(req), staffId: target.id, authorId: req.staffRecord?.id || null, authorName: req.staffRecord?.name || 'زميل', body });
    res.json({ ok: true, reassigned, to: target.name });
  } catch (error) { fail(res, error, '[wa-web assign]'); }
});

// ── An AI-suggested reply ──────────────────────────────────────────────────
// POST { jid } — a draft the rep reads, edits and sends; nothing is sent from here.
router.post('/api/staff/whatsapp-web/suggest', ...guard, bulkOperationLimiter, async (req, res) => {
  try {
    const jid = String(req.body?.jid || '');
    if (!jid) return res.status(400).json({ error: 'اختار المحادثة' });
    const { generateAdminAi, resolveAiConfig } = require('../lib/adminAi');
    const settings = await getTenantSetting('settings', { tenantId: tenant(req), fallback: {} }).catch(() => ({}));
    const config = resolveAiConfig(settings, 'agent');
    if (!config) return res.status(409).json({ error: 'لسه مفيش مفتاح ذكاء اصطناعي — حطه في «التكاملات ← إعدادات AI»', code: 'NO_AI_KEY' });

    const [[chat]] = await pool.query('SELECT phone, name FROM wa_web_chats WHERE tenant_id=? AND staff_id=? AND jid=? LIMIT 1', [tenant(req), me(req), jid]);
    if (!chat) return res.status(404).json({ error: 'المحادثة مش موجودة' });
    const [rows] = await pool.query(
      "SELECT from_me AS fromMe, body FROM wa_web_messages WHERE tenant_id=? AND staff_id=? AND jid=? AND kind='text' ORDER BY sent_at DESC, id DESC LIMIT 14",
      [tenant(req), me(req), jid]);
    if (!rows.length) return res.status(409).json({ error: 'مفيش رسايل نقترح عليها رد', code: 'NO_MESSAGES' });

    // Same speaker in a row is one turn; a conversation the model reads starts with the customer.
    const turns = [];
    for (const row of rows.reverse()) {
      const role = row.fromMe ? 'assistant' : 'user';
      const content = String(row.body || '').trim().slice(0, 1500);
      if (!content) continue;
      if (turns.length && turns[turns.length - 1].role === role) turns[turns.length - 1].content += `\n${content}`;
      else turns.push({ role, content });
    }
    while (turns.length && turns[0].role !== 'user') turns.shift();
    if (!turns.length) return res.status(409).json({ error: 'مفيش رسايل نقترح عليها رد', code: 'NO_MESSAGES' });
    if (turns[turns.length - 1].role === 'assistant') turns.push({ role: 'user', content: '(العميل لسه ما ردش — اقترح رسالة متابعة قصيرة ومهذبة)' });

    const context = await contextForPhone(tenant(req), chat.phone || '', { canSeeMoney: false }).catch(() => null);
    const name = context?.subscriber?.name || context?.lead?.name || chat.name || '';
    const facts = [
      name ? `اسم العميل: ${name}` : '',
      context?.lead?.interested?.length ? `الكورسات اللي مهتم بيها: ${context.lead.interested.map(course => `${course.title}${course.price ? ` (${course.price} جنيه)` : ''}`).join('، ')}` : '',
      context?.subscriber?.courses?.length ? `مشترك في: ${context.subscriber.courses.map(course => course.title).join('، ')}` : '',
      context?.lead?.status ? `حالته: ${context.lead.status}` : '',
    ].filter(Boolean).join('\n');
    const systemPrompt = [
      'أنت مساعد مبيعات وخدمة عملاء في «معهد الدراسات النفسية». بتكتب مسودة رد واتساب للموظف يراجعها ويبعتها بنفسه.',
      'اكتب بالعامية المصرية المهذبة، قصير (٢ إلى ٤ جمل)، من غير مبالغة. رد على آخر رسالة من العميل بشكل مباشر.',
      'متخترعش أسعار ولا مواعيد ولا خصومات ولا وعود. لو المعلومة مش موجودة تحت قول إنك هتتأكد وترجعله.',
      'ارجع نص الرسالة بس، من غير مقدمة ولا شرح ولا علامات تنسيق.',
      facts ? `\nمعلومات عن العميل:\n${facts}` : '',
    ].join('\n');
    const text = await generateAdminAi({ ...config, systemPrompt: '', temperature: 0.5 }, { messages: turns, systemPrompt, maxTokens: 400 });
    const reply = String(text || '').trim();
    if (!reply) return res.status(502).json({ error: 'الذكاء الاصطناعي ما رجّعش رد — جرّب تاني' });
    res.json({ ok: true, reply });
  } catch (error) {
    if (error?.providerStatus || /provider|api key|quota/i.test(String(error?.message || ''))) {
      logger.warn('[wa-web suggest] the AI provider refused', { error: error.message });
      return res.status(502).json({ error: 'خدمة الذكاء الاصطناعي رفضت الطلب — راجع المفتاح أو الحصة', code: 'AI_PROVIDER' });
    }
    fail(res, error, '[wa-web suggest]');
  }
});

module.exports = router;
