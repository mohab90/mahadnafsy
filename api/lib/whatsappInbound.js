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
 * Three things happen here, all idempotent:
 *   1. an unrecognised number becomes a lead — someone who writes to the
 *      company WhatsApp is a lead by definition
 *   2. the message is appended to `communications`, the same timeline the CRM
 *      and the client page already read from
 *   3. the rep who owns that lead or client is notified
 */
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { toIdentity, toDialable } = require('./phoneNumber');
const { createNotification } = require('./notification');
const { getNextSalesRep } = require('./leadAssignment');
const { upsertThread, recordOnThread } = require('./inboxThreads');
const { setMarketingConsent } = require('./marketingConsent');
const logger = require('./logger');

const MAX_BODY = 4000;
const INBOUND_LEAD_SOURCE = 'whatsapp_inbound';

// «إلغاء» / STOP, typed or pressed (a marketing template's opt-out button
// answers with its own text): the person is taken off promotional messages.
// Matched against the whole message only — «عايز ألغي الحجز» is a question
// for a rep, not an unsubscribe.
const OPT_OUT = /^\s*(stop|unsubscribe|الغاء|إلغاء|الغاء الاشتراك|إلغاء الاشتراك|ايقاف|إيقاف|ايقاف الرسائل|إيقاف الرسائل|stop promotions)\s*[.!]?\s*$/i;
const isOptOut = text => OPT_OUT.test(String(text || ''));

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
 * Turn an unrecognised inbound number into a lead.
 *
 * Assigned through the same round-robin the public forms use, so it lands in
 * someone's queue rather than in a pile nobody owns. The first line of their
 * message becomes the name placeholder until a human corrects it — better than
 * a row called "غير معروف" that reads as broken data.
 *
 * @returns {Promise<{kind: 'lead', id: string, name: string, staff_id: string|null}|null>}
 */
async function createLeadFromInbound({ tenantId, from, text }, db = pool) {
  const dialable = toDialable(from);
  if (!dialable) return null;

  const id = uuidv4();
  // Stored in the local shape the rest of the CRM uses, so the duplicate checks
  // and the wa.me links elsewhere keep matching this row.
  const identity = toIdentity(from);
  const storedPhone = /^1[0125]\d{8}$/.test(identity) ? `0${identity}` : dialable;
  const name = `واتساب ${storedPhone}`;

  try {
    const rep = await getNextSalesRep(tenantId, db, {
      lead: { source: INBOUND_LEAD_SOURCE, courseIds: [] },
    }).catch(() => null);
    const [result] = await db.query(
      `INSERT INTO leads
         (id, tenant_id, name, phone, source, status, notes,
          assigned_sales_id, assigned_sales_name, hidden, created_at)
       VALUES (?,?,?,?,?, 'new', ?, ?, ?, 0, NOW())`,
      [
        id, tenantId, name, storedPhone, INBOUND_LEAD_SOURCE,
        // The message itself is the most useful thing a rep can see first.
        String(text || '').slice(0, 500) || null,
        rep?.id || null, rep?.name || null,
      ]
    );
    if (!result.affectedRows) return null;
    logger.info('[wa-inbound] created a lead from an unrecognised number');
    return { kind: 'lead', id, name, staff_id: rep?.id || null, isNew: true };
  } catch (error) {
    // A racing message from the same number can lose the phone-uniqueness race.
    // Re-reading is the right answer: the other request already made the lead.
    logger.warn('[wa-inbound] lead creation failed, re-checking', error.message);
    return identifySender(db, tenantId, from);
  }
}

/**
 * @param {object} message { providerMessageId, from, body, timestamp }
 * @returns {Promise<{recorded: boolean, reason?: string, id?: string}>}
 */
async function recordInboundMessage({ tenantId, channelId = null, providerMessageId, from, body, timestamp }, db = pool) {
  if (!providerMessageId || !from) return { recorded: false, reason: 'incomplete' };
  const text = String(body || '').slice(0, MAX_BODY).trim();

  let sender = await identifySender(db, tenantId, from);
  // A stranger messaging the company WhatsApp is a lead by definition: they saw
  // the ad, they wrote in. Dropping the message meant the institute never knew.
  // The lead is created here rather than left for a human, because there is
  // nowhere for a human to see it before it exists.
  let isNewLead = false;
  if (!sender) {
    const created = await createLeadFromInbound({ tenantId, from, text }, db);
    if (!created) return { recorded: false, reason: 'unknown_sender' };
    sender = created;
    isNewLead = created.isNew === true;
  }

  const id = uuidv4();
  const at = timestamp ? new Date(Number(timestamp) * 1000) : new Date();
  const when = Number.isFinite(at.getTime()) ? at : new Date();

  // INSERT IGNORE against uq_comm_tenant_provider_msg: providers retry, and a
  // retry must not append the same message to the timeline twice.
  const [result] = await db.query(
    `INSERT IGNORE INTO communications
       (id, tenant_id, lead_id, subscriber_id, type, direction, provider_message_id, channel_id,
        date, notes, staff_id, created_at)
     VALUES (?,?,?,?, 'WHATSAPP', 'IN', ?, ?, ?, ?, ?, NOW())`,
    [
      id, tenantId,
      sender.kind === 'lead' ? sender.id : null,
      sender.kind === 'subscriber' ? sender.id : null,
      providerMessageId, channelId, when, text || '(رسالة بدون نص)', sender.staff_id || null,
    ]
  );
  if (!result.affectedRows) return { recorded: false, reason: 'duplicate' };

  // The team inbox. The message is already on the timeline; a conversation
  // that fails to update is a stale list, not a lost message.
  let owner = sender.staff_id || null;
  try {
    const thread = await upsertThread(db, {
      tenantId, platform: 'whatsapp', contactKey: toDialable(from), channelId,
      leadId: sender.kind === 'lead' ? sender.id : null,
      subscriberId: sender.kind === 'subscriber' ? sender.id : null,
      contactName: sender.name || null, ownerStaffId: sender.staff_id || null,
    });
    await recordOnThread(db, { tenantId, threadId: thread.id, communicationId: id, direction: 'IN', text, at: when });
    owner = thread.assigned_staff_id || owner;
  } catch (error) {
    logger.warn('[wa-inbound] team inbox update failed', error.message);
  }

  let optedOut = false;
  if (isOptOut(text)) {
    optedOut = await setMarketingConsent({
      tenantId, subjectType: sender.kind, subjectId: sender.id, channel: 'whatsapp',
      subscribed: false, source: 'whatsapp_reply',
    }).then(() => true).catch(error => {
      logger.warn('[wa-inbound] opt-out not recorded', error.message);
      return false;
    });
  }

  // Notify the owner. Without a recipient this goes to everyone, which is the
  // right fallback for an unassigned lead — better seen by all than by nobody.
  // A first contact and a reply are different events for the rep: one needs
  // qualifying, the other needs answering.
  await createNotification(
    'whatsapp',
    isNewLead ? '🆕 عميل جديد كلّمنا على الواتساب' : 'رد جديد على واتساب',
    `${sender.name || 'عميل'}: ${text.slice(0, 120) || 'رسالة'}`,
    { [sender.kind === 'lead' ? 'leadId' : 'subscriberId']: sender.id, communicationId: id },
    tenantId,
    owner
  );

  return { recorded: true, id, senderKind: sender.kind, senderId: sender.id, createdLead: isNewLead, optedOut };
}

// A picture or a voice note has no text; the rep still needs to see one came.
const MEDIA_LABEL = {
  image: '📷 صورة', audio: '🎤 رسالة صوتية', voice: '🎤 رسالة صوتية', video: '🎬 فيديو',
  document: '📄 ملف', sticker: 'ملصق', location: '📍 موقع', contacts: '👤 جهة اتصال',
};

/** Meta Cloud API webhook body → the messages in it. */
function extractMetaMessages(payload) {
  return (payload?.entry || []).flatMap(entry =>
    (entry.changes || []).flatMap(change =>
      (change.value?.messages || []).map(message => ({
        providerMessageId: message.id,
        from: message.from,
        // Which of the company's numbers it came to — the channel it is filed under.
        phoneNumberId: change.value?.metadata?.phone_number_id || null,
        body: message.text?.body || message.button?.text
          || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title
          || MEDIA_LABEL[message.type] || '',
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
  isOptOut,
};
