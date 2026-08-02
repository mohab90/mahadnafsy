'use strict';
/**
 * The shared inbox.
 *
 * Inbound WhatsApp and Messenger messages are recorded and the owning rep is
 * notified — but until now there was nowhere to actually read the conversation
 * or answer it, which meant a customer's reply reached a notification and
 * stopped. This is the screen that closes that loop.
 *
 * Conversations are grouped by the person, not by the channel: a lead who wrote
 * on WhatsApp and later on Messenger is one conversation, because that is how
 * the rep thinks about them.
 */
const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'messaging-inbox' });
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { sendWhatsApp } = require('../lib/whatsapp');
const { sendMessengerMessage, isWithinReplyWindow } = require('../lib/messenger');
const { getSendableChannel } = require('../lib/messagingChannels');
const { toDialable } = require('../lib/phoneNumber');
const { leadScope } = require('../lib/leadAccess');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { bulkOperationLimiter } = require('../middleware/rateLimits');

const view = [requireAuth, requireAdminOrStaff, requirePermission('view_leads')];
const reply = [requireAuth, requireAdminOrStaff, requirePermission('manage_leads')];

function fail(res, error, message) {
  if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message });
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

/**
 * Who may see a conversation.
 *
 * leadScope alone is not enough here: it only constrains leads, and a
 * conversation with a paying client has no lead row at all — a CS rep would see
 * an empty inbox. So the lead side keeps the CRM's own rule (assigned rep,
 * branch, or everything) and the client side is scoped to the assigned CS.
 */
function inboxScope(req) {
  const scope = leadScope(req, 'l');
  if (scope.scope === 'all') return { sql: '', params: [] };
  if (scope.none) return { sql: ' AND 1=0', params: [] };
  const leadCondition = scope.sql.replace(/^\s*AND\s+/i, '');
  const staffId = req.staffRecord?.id || null;
  return {
    sql: ` AND ((c.lead_id IS NOT NULL AND ${leadCondition})
            OR (c.subscriber_id IS NOT NULL AND s.assigned_cs_id = ?))`,
    params: [...scope.params, staffId],
  };
}

/**
 * GET /api/admin/messaging/inbox — conversations, newest activity first.
 *
 * `unansweredOnly` is the default view for a reason: the question a rep opens
 * this screen to answer is "who is waiting on me", not "what has ever been said".
 */
router.get('/api/admin/messaging/inbox', ...view, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const unansweredOnly = req.query.unanswered === '1';
    // Same ownership rule the CRM uses, so the inbox cannot become a way
    // around lead assignment.
    const scope = inboxScope(req);

    const [rows] = await pool.query(
      `SELECT
         c.lead_id, c.subscriber_id,
         COALESCE(l.name, s.name)   AS name,
         COALESCE(l.phone, s.phone) AS phone,
         l.messenger_psid           AS psid,
         l.messenger_last_inbound_at AS messenger_last_inbound_at,
         COALESCE(l.assigned_sales_id, s.assigned_cs_id) AS staff_id,
         MAX(c.date)                AS last_at,
         SUM(c.direction = 'IN')    AS inbound_count,
         SUBSTRING(MAX(CONCAT(c.date, '|', LEFT(c.notes, 160))), 20) AS last_message,
         SUBSTRING_INDEX(GROUP_CONCAT(c.direction ORDER BY c.date DESC), ',', 1) AS last_direction
       FROM communications c
       LEFT JOIN leads l       ON l.id = c.lead_id       AND l.tenant_id = c.tenant_id
       LEFT JOIN subscribers s ON s.id = c.subscriber_id AND s.tenant_id = c.tenant_id
      WHERE c.tenant_id = ?
        AND c.type IN ('WHATSAPP','MESSENGER')
        AND (c.lead_id IS NOT NULL OR c.subscriber_id IS NOT NULL)
        ${scope.sql}
      GROUP BY c.lead_id, c.subscriber_id
      ${unansweredOnly ? "HAVING last_direction = 'IN'" : ''}
      ORDER BY last_at DESC
      LIMIT ?`,
      [req.tenantId, ...scope.params, limit]
    );

    res.json(rows.map(row => ({
      ...row,
      inbound_count: Number(row.inbound_count || 0),
      // Meta rejects plain text outside 24h from the customer's last message,
      // so the UI needs to know before the rep types a reply that cannot land.
      messengerWindowOpen: isWithinReplyWindow(row.messenger_last_inbound_at),
    })));
  } catch (error) { fail(res, error, 'inbox list failed'); }
});

/** GET /api/admin/messaging/inbox/thread — one conversation, oldest first. */
router.get('/api/admin/messaging/inbox/thread', ...view, async (req, res) => {
  try {
    const { leadId, subscriberId } = req.query;
    if (!leadId && !subscriberId) return res.status(400).json({ error: 'leadId أو subscriberId مطلوب' });
    // Same rule as the list: a client conversation has no lead row, so scoping
    // on leads alone would hide it from the CS rep who owns it.
    const scope = inboxScope(req);

    const [rows] = await pool.query(
      `SELECT c.id, c.type, c.direction, c.date, c.notes, c.outcome, c.channel_id,
              c.staff_id, st.name AS staff_name, ch.label AS channel_label
         FROM communications c
         LEFT JOIN leads l ON l.id = c.lead_id AND l.tenant_id = c.tenant_id
         LEFT JOIN subscribers s ON s.id = c.subscriber_id AND s.tenant_id = c.tenant_id
         LEFT JOIN staff st ON st.id = c.staff_id AND st.tenant_id = c.tenant_id
         LEFT JOIN messaging_channels ch ON ch.id = c.channel_id AND ch.tenant_id = c.tenant_id
        WHERE c.tenant_id = ?
          AND ${leadId ? 'c.lead_id = ?' : 'c.subscriber_id = ?'}
          ${scope.sql}
        ORDER BY c.date ASC
        LIMIT 500`,
      [req.tenantId, leadId || subscriberId, ...scope.params]
    );
    res.json(rows);
  } catch (error) { fail(res, error, 'inbox thread failed'); }
});

/**
 * POST /api/admin/messaging/inbox/reply — answer a conversation.
 *
 * The reply is recorded on the same timeline as the incoming message, from the
 * rep's own channel when they have one. Recording happens only after the
 * provider accepts it: a timeline showing a message that was never delivered is
 * worse than one showing nothing.
 */
router.post('/api/admin/messaging/inbox/reply', ...reply, bulkOperationLimiter, async (req, res) => {
  try {
    const { leadId, subscriberId, message, via } = req.body || {};
    const text = String(message || '').trim();
    if (!text) return res.status(400).json({ error: 'نص الرسالة مطلوب' });
    if (!leadId && !subscriberId) return res.status(400).json({ error: 'حدّد المحادثة' });

    const scope = leadScope(req, 'l');
    // A scoped rep may only answer their own clients. Without this any sales rep
    // could reply inside any client conversation in the institute.
    const seesEveryone = scope.scope === 'all';
    const clientOwnership = seesEveryone ? '' : ' AND s.assigned_cs_id=?';
    const [[target]] = await pool.query(
      leadId
        ? `SELECT l.id, l.name, l.phone, l.messenger_psid, l.messenger_last_inbound_at
             FROM leads l WHERE l.tenant_id=? AND l.id=? ${scope.sql} LIMIT 1`
        : `SELECT s.id, s.name, s.phone, NULL AS messenger_psid, NULL AS messenger_last_inbound_at
             FROM subscribers s
            WHERE s.tenant_id=? AND s.id=? AND s.deleted_at IS NULL${clientOwnership} LIMIT 1`,
      leadId
        ? [req.tenantId, leadId, ...scope.params]
        : (seesEveryone ? [req.tenantId, subscriberId] : [req.tenantId, subscriberId, req.staffRecord?.id || null])
    );
    if (!target) return res.status(404).json({ error: 'المحادثة غير موجودة أو غير مصرح بها' });

    const staffId = req.staffRecord?.id || null;
    const channel = via === 'messenger' ? 'MESSENGER' : 'WHATSAPP';

    let result;
    let usedChannelId = null;

    if (channel === 'MESSENGER') {
      if (!target.messenger_psid) {
        return res.status(409).json({ error: 'العميل ده مفيش له محادثة ماسنجر مربوطة' });
      }
      // Refused up front rather than sent and silently rejected by Meta.
      if (!isWithinReplyWindow(target.messenger_last_inbound_at)) {
        return res.status(409).json({
          error: 'عدّت 24 ساعة على آخر رسالة من العميل — ماسنجر مش هيقبل رد نصي. جرّب الواتساب.',
          code: 'MESSENGER_WINDOW_CLOSED',
        });
      }
      const resolved = await getSendableChannel({ tenantId: req.tenantId, kind: 'messenger' });
      if (!resolved) return res.status(409).json({ error: 'قناة الماسنجر غير متصلة' });
      usedChannelId = resolved.row.id;
      result = await sendMessengerMessage(target.messenger_psid, text, resolved.credentials);
    } else {
      const to = toDialable(target.phone);
      if (!to) return res.status(409).json({ error: 'رقم العميل مش صالح للإرسال' });
      // staffId first: the rep's own number if they connected one, else the
      // company's. Same rule as everywhere else.
      result = await sendWhatsApp(to, text, { tenantId: req.tenantId, staffId });
      usedChannelId = result.channelId || null;
    }

    if (!result?.ok) {
      return res.status(502).json({
        error: 'لم يتم الإرسال',
        reason: typeof result?.reason === 'string' ? result.reason : undefined,
      });
    }

    const id = uuidv4();
    await pool.query(
      `INSERT INTO communications
         (id, tenant_id, lead_id, subscriber_id, type, direction, channel_id,
          date, notes, staff_id, created_at)
       VALUES (?,?,?,?,?, 'OUT', ?, NOW(), ?, ?, NOW())`,
      [id, req.tenantId, leadId || null, subscriberId || null, channel,
       usedChannelId, text.slice(0, 4000), staffId]
    );

    res.json({ ok: true, id, channelId: usedChannelId, messageId: result.idMessage || null });
  } catch (error) { fail(res, error, 'inbox reply failed'); }
});

/**
 * POST /api/admin/messaging/inbox/link-messenger — attach a Messenger conversation to a lead.
 *
 * Messenger gives us a page-scoped id and nothing else — no phone, no email — so
 * matching a conversation to a CRM record is a one-time human act. Everything
 * that arrives on that PSID afterwards lands on the lead automatically.
 */
router.post('/api/admin/messaging/inbox/link-messenger', ...reply, async (req, res) => {
  try {
    const { leadId, psid } = req.body || {};
    if (!leadId || !psid) return res.status(400).json({ error: 'leadId و psid مطلوبان' });
    const scope = leadScope(req, 'l');

    const [[lead]] = await pool.query(
      `SELECT l.id FROM leads l WHERE l.tenant_id=? AND l.id=? ${scope.sql} LIMIT 1`,
      [req.tenantId, leadId, ...scope.params]
    );
    if (!lead) return res.status(404).json({ error: 'العميل غير موجود أو غير مصرح به' });

    try {
      await pool.query(
        'UPDATE leads SET messenger_psid=?, updated_at=updated_at WHERE id=? AND tenant_id=?',
        [String(psid).slice(0, 64), leadId, req.tenantId]
      );
    } catch (error) {
      // uq_leads_tenant_psid: one person is one PSID. Attaching it twice would
      // split their conversation across two records.
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'محادثة الماسنجر دي مربوطة بعميل تاني بالفعل' });
      }
      throw error;
    }

    // Adopt the messages that arrived before anyone knew who this was.
    const [adopted] = await pool.query(
      `UPDATE communications SET lead_id=?
        WHERE tenant_id=? AND type='MESSENGER' AND lead_id IS NULL
          AND JSON_EXTRACT(COALESCE(outcome,'{}'), '$.psid') = ?`,
      [leadId, req.tenantId, String(psid)]
    ).catch(() => [{ affectedRows: 0 }]);

    res.json({ ok: true, adopted: adopted?.affectedRows || 0 });
  } catch (error) { fail(res, error, 'messenger link failed'); }
});

module.exports = router;
