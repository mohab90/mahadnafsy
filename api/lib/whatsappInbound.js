'use strict';
/**
 * A customer replied on WhatsApp. Put it somewhere a human will see it.
 *
 * The webhook used to process delivery statuses and silently discard inbound
 * messages. That was survivable while WhatsApp was one channel among several.
 * It is not survivable now that it is *the* channel: a reply that lands nowhere
 * means the assigned rep never learns the lead answered, and the client's
 * timeline shows the institute talking into a void.
 *
 * Two things happen here, both idempotent:
 *   1. the message is appended to `communications`, the same timeline the CRM
 *      and the client page already read from
 *   2. the rep who owns that lead or client is notified
 */
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { toIdentity, toDialable } = require('./phoneNumber');
const { createNotification } = require('./notification');
const logger = require('./logger');

const MAX_BODY = 4000;

/**
 * Find who this number belongs to. Subscribers win over leads: a paying client
 * who is also still an open lead should have the message on their client record.
 *
 * Matched with an indexed equality against the spellings a number is stored in,
 * not REGEXP_REPLACE — this runs on every inbound message.
 */
async function identifySender(db, tenantId, phone) {
  const identity = toIdentity(phone);
  if (!identity) return null;
  const dialable = toDialable(phone);
  const variants = [...new Set([
    identity, `0${identity}`, `+${identity}`,
    dialable, `+${dialable}`, `00${dialable}`,
  ].filter(Boolean))];
  const placeholders = variants.map(() => '?').join(',');

  const [[subscriber]] = await db.query(
    `SELECT id, name, assigned_cs_id AS staff_id FROM subscribers
      WHERE tenant_id=? AND phone IN (${placeholders}) AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, ...variants]
  );
  if (subscriber) return { kind: 'subscriber', ...subscriber };

  const [[lead]] = await db.query(
    `SELECT id, name, assigned_sales_id AS staff_id FROM leads
      WHERE tenant_id=? AND phone IN (${placeholders}) AND hidden=0
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, ...variants]
  );
  return lead ? { kind: 'lead', ...lead } : null;
}

/**
 * @param {object} message { providerMessageId, from, body, timestamp }
 * @returns {Promise<{recorded: boolean, reason?: string, id?: string}>}
 */
async function recordInboundMessage({ tenantId, providerMessageId, from, body, timestamp }, db = pool) {
  if (!providerMessageId || !from) return { recorded: false, reason: 'incomplete' };
  const text = String(body || '').slice(0, MAX_BODY).trim();

  const sender = await identifySender(db, tenantId, from);
  if (!sender) {
    // An unknown number is not an error — it may be a wrong number, or someone
    // who has not registered yet. Logged so it is visible, not stored as a
    // dangling record with nothing to attach it to.
    logger.info('[wa-inbound] message from a number with no lead or client');
    return { recorded: false, reason: 'unknown_sender' };
  }

  const id = uuidv4();
  const at = timestamp ? new Date(Number(timestamp) * 1000) : new Date();
  const when = Number.isFinite(at.getTime()) ? at : new Date();

  // INSERT IGNORE against uq_comm_tenant_provider_msg: providers retry, and a
  // retry must not append the same message to the timeline twice.
  const [result] = await db.query(
    `INSERT IGNORE INTO communications
       (id, tenant_id, lead_id, subscriber_id, type, direction, provider_message_id,
        date, notes, staff_id, created_at)
     VALUES (?,?,?,?, 'WHATSAPP', 'IN', ?, ?, ?, ?, NOW())`,
    [
      id, tenantId,
      sender.kind === 'lead' ? sender.id : null,
      sender.kind === 'subscriber' ? sender.id : null,
      providerMessageId, when, text || '(رسالة بدون نص)', sender.staff_id || null,
    ]
  );
  if (!result.affectedRows) return { recorded: false, reason: 'duplicate' };

  // Notify the owner. Without a recipient this goes to everyone, which is the
  // right fallback for an unassigned lead — better seen by all than by nobody.
  await createNotification(
    'whatsapp',
    'رد جديد على واتساب',
    `${sender.name || 'عميل'}: ${text.slice(0, 120) || 'رسالة'}`,
    { [sender.kind === 'lead' ? 'leadId' : 'subscriberId']: sender.id, communicationId: id },
    tenantId,
    sender.staff_id || null
  );

  return { recorded: true, id, senderKind: sender.kind, senderId: sender.id };
}

/** Meta Cloud API webhook body → the messages in it. */
function extractMetaMessages(payload) {
  return (payload?.entry || []).flatMap(entry =>
    (entry.changes || []).flatMap(change =>
      (change.value?.messages || []).map(message => ({
        providerMessageId: message.id,
        from: message.from,
        body: message.text?.body || message.button?.text || message.interactive?.list_reply?.title || '',
        timestamp: message.timestamp,
      }))
    )
  );
}

/** Green-API webhook body → the message in it (one per callback). */
function extractGreenApiMessage(payload) {
  if (payload?.typeWebhook !== 'incomingMessageReceived') return null;
  const data = payload.messageData || {};
  return {
    providerMessageId: payload.idMessage,
    // "201012345678@c.us" → the number
    from: String(payload.senderData?.chatId || '').split('@')[0],
    body: data.textMessageData?.textMessage
      || data.extendedTextMessageData?.text
      || '',
    timestamp: payload.timestamp,
  };
}

module.exports = {
  recordInboundMessage,
  identifySender,
  extractMetaMessages,
  extractGreenApiMessage,
};
