'use strict';
/**
 * Facebook Messenger — the Page inbox.
 *
 * Two things about Messenger shape everything built on it, and getting them
 * wrong produces a feature that looks finished and fails in production:
 *
 * 1. You cannot address a person by phone or email. Messenger only knows a PSID
 *    (page-scoped id) which is issued the first time *they* message the page.
 *    So Messenger is a reply channel, never an outbound prospecting one — there
 *    is no such thing as a Messenger blast to people who have not written in.
 *
 * 2. Outside 24 hours from the customer's last message, a plain text reply is
 *    rejected. Only specific message tags are allowed after that. The window is
 *    tracked here so the UI can say "this conversation has gone cold" rather
 *    than letting an agent type a reply that silently fails.
 *
 * A Page has one inbox, so unlike WhatsApp there is no per-employee Messenger:
 * it is a shared inbox with assignment.
 */
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { createNotification } = require('./notification');
const logger = require('./logger');

const GRAPH = 'https://graph.facebook.com/v19.0';
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} psid       page-scoped recipient id
 * @param {object} credentials { pageAccessToken, pageId }
 */
async function sendMessengerMessage(psid, text, credentials = {}) {
  const token = credentials.pageAccessToken || credentials.accessToken;
  if (!token) return { ok: false, provider: 'messenger', reason: 'not_configured' };
  if (!psid) return { ok: false, provider: 'messenger', reason: 'invalid_recipient' };

  const response = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: psid },
      // RESPONSE is the only type valid inside the 24h window without a tag.
      messaging_type: 'RESPONSE',
      message: { text: String(text || '').slice(0, 2000) },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    logger.warn('[Messenger] send failed', data);
    return { ok: false, provider: 'messenger', reason: data };
  }
  return { ok: true, provider: 'messenger', idMessage: data.message_id };
}

/**
 * Is this conversation still repliable with plain text?
 * @param {Date|string|null} lastInboundAt
 */
function isWithinReplyWindow(lastInboundAt) {
  if (!lastInboundAt) return false;
  const at = new Date(lastInboundAt).getTime();
  return Number.isFinite(at) && Date.now() - at < REPLY_WINDOW_MS;
}

/** Messenger webhook body → the messages in it. */
function extractMessengerMessages(payload) {
  if (payload?.object !== 'page') return [];
  return (payload.entry || []).flatMap(entry =>
    (entry.messaging || [])
      // Echoes are the page's own outbound messages coming back; recording them
      // would duplicate every reply an agent sends.
      .filter(event => event.message && !event.message.is_echo)
      .map(event => ({
        providerMessageId: event.message.mid,
        psid: event.sender?.id,
        pageId: entry.id,
        body: event.message.text || '',
        // Messenger timestamps are milliseconds; WhatsApp's are seconds.
        timestamp: event.timestamp ? Math.floor(event.timestamp / 1000) : null,
        attachments: (event.message.attachments || []).length,
      }))
  );
}

/**
 * Record an inbound Messenger message against a lead or subscriber.
 *
 * The PSID is the only identifier available, so the link to a CRM record is
 * built once — when a customer's PSID is first matched to them by a human — and
 * stored on the lead. Until then the message is still recorded and still raises
 * a notification: an unattributed message that a human can see beats a
 * perfectly-attributed one that nobody knows about.
 */
async function recordInboundMessenger({ tenantId, channelId, providerMessageId, psid, body, timestamp }, db = pool) {
  if (!providerMessageId || !psid) return { recorded: false, reason: 'incomplete' };
  const text = String(body || '').slice(0, 4000).trim();

  const [[lead]] = await db.query(
    `SELECT id, name, assigned_sales_id FROM leads
      WHERE tenant_id=? AND messenger_psid=? AND hidden=0 LIMIT 1`,
    [tenantId, psid]
  );

  const id = uuidv4();
  const at = timestamp ? new Date(Number(timestamp) * 1000) : new Date();
  const when = Number.isFinite(at.getTime()) ? at : new Date();

  const [result] = await db.query(
    `INSERT IGNORE INTO communications
       (id, tenant_id, lead_id, type, direction, provider_message_id, channel_id,
        date, notes, outcome, staff_id, created_at)
     VALUES (?,?,?, 'MESSENGER', 'IN', ?, ?, ?, ?, ?, ?, NOW())`,
    [
      id, tenantId, lead?.id || null,
      `msgr:${providerMessageId}`, channelId || null, when,
      text || '(رسالة ماسنجر بدون نص)',
      // The PSID is kept on the row itself so messages that arrived before
      // anyone knew who this was can be adopted onto the lead the moment a
      // human makes the link. Without it those messages stay orphaned forever.
      JSON.stringify({ psid: String(psid) }),
      lead?.assigned_sales_id || null,
    ]
  );
  if (!result.affectedRows) return { recorded: false, reason: 'duplicate' };

  await createNotification(
    'messenger',
    'رسالة ماسنجر جديدة',
    `${lead?.name || 'زائر'}: ${text.slice(0, 120) || 'رسالة'}`,
    { leadId: lead?.id || null, psid, communicationId: id },
    tenantId,
    lead?.assigned_sales_id || null
  );

  return { recorded: true, id, leadId: lead?.id || null, matched: Boolean(lead) };
}

module.exports = {
  REPLY_WINDOW_MS,
  sendMessengerMessage,
  isWithinReplyWindow,
  extractMessengerMessages,
  recordInboundMessenger,
};
