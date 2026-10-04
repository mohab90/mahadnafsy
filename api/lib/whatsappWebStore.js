'use strict';

// What the WhatsApp tab shows, kept in the database (migration 242): each rep's
// chats and messages as their linked phone reports them (lib/whatsappWeb.js
// holds the live connection). Separate from the connection so it can be
// exercised without one.

const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { toIdentity, toDialable } = require('./phoneNumber');
const { phoneIdentityClause } = require('./leadMatching');

const PERSON_JID = /@s\.whatsapp\.net$/;
// WhatsApp now addresses some people by a private id (@lid) rather than their
// number. The number, when WhatsApp shares it, is on the message key.
const LID_JID = /@lid$/;

/** The person's chat address — the number-based one whenever it is known. */
function chatJid(key = {}) {
  const remote = String(key.remoteJid || '');
  if (PERSON_JID.test(remote)) return remote.replace(/:\d+@/, '@');
  if (LID_JID.test(remote)) {
    const alt = String(key.remoteJidAlt || key.senderPn || '');
    return PERSON_JID.test(alt) ? alt.replace(/:\d+@/, '@') : remote;
  }
  return null; // groups, status updates, channels: not a conversation with a client
}

const phoneOfJid = jid => (PERSON_JID.test(String(jid || '')) ? String(jid).split('@')[0] : null);

/** A phone typed by a rep → the address WhatsApp knows them by. */
function jidForPhone(phone) {
  const dialable = toDialable(phone);
  return dialable ? `${dialable}@s.whatsapp.net` : null;
}

function unwrap(message) {
  let m = message || {};
  for (let i = 0; i < 4; i++) {
    const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message
      || m.documentWithCaptionMessage?.message || m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

/** A WhatsApp message → the row the tab stores, or null for what it does not show. */
function parseWaMessage(msg) {
  const key = msg?.key || {};
  const jid = chatJid(key);
  if (!jid || !key.id) return null;
  const m = unwrap(msg.message);
  let kind = 'text';
  let body = m.conversation || m.extendedTextMessage?.text || null;
  if (body == null) {
    if (m.imageMessage) { kind = 'image'; body = m.imageMessage.caption || '[صورة]'; }
    else if (m.videoMessage) { kind = 'video'; body = m.videoMessage.caption || '[فيديو]'; }
    else if (m.audioMessage) { kind = 'audio'; body = '[رسالة صوتية]'; }
    else if (m.documentMessage) { kind = 'document'; body = `[ملف] ${m.documentMessage.fileName || ''}`.trim(); }
    else if (m.stickerMessage) { kind = 'sticker'; body = '[ملصق]'; }
    else if (m.locationMessage) { kind = 'location'; body = '[موقع]'; }
    else if (m.contactMessage) { kind = 'contact'; body = `[جهة اتصال] ${m.contactMessage.displayName || ''}`.trim(); }
    else return null; // reactions, receipts, protocol messages
  }
  const seconds = Number(msg.messageTimestamp?.low ?? msg.messageTimestamp ?? 0);
  return {
    jid,
    phone: phoneOfJid(jid),
    waId: String(key.id),
    fromMe: Boolean(key.fromMe),
    body: String(body).slice(0, 20000),
    kind,
    sentAt: seconds > 0 ? new Date(seconds * 1000) : new Date(),
    pushName: key.fromMe ? null : (msg.pushName || null),
  };
}

/**
 * Store parsed messages for one rep and bring their chats up to date.
 * Returns the rows that were new (a message seen twice is stored once).
 */
async function recordMessages(tenantId, staffId, parsed, { sentBySystem = false, countUnread = true } = {}) {
  const fresh = [];
  for (const row of parsed) {
    if (!row) continue;
    const [result] = await pool.query(
      `INSERT IGNORE INTO wa_web_messages (tenant_id, staff_id, jid, wa_id, from_me, sent_by_system, body, kind, status, sent_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [tenantId, staffId, row.jid, row.waId, row.fromMe ? 1 : 0, sentBySystem ? 1 : 0, row.body, row.kind,
        row.fromMe ? 'sent' : null, row.sentAt]);
    if (!result.affectedRows) continue;
    fresh.push(row);
    const unread = countUnread && !row.fromMe ? 1 : 0;
    await pool.query(
      `INSERT INTO wa_web_chats (tenant_id, staff_id, jid, phone, name, last_message, last_at, unread)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         phone = COALESCE(phone, VALUES(phone)),
         name = COALESCE(name, VALUES(name)),
         last_message = IF(last_at IS NULL OR VALUES(last_at) >= last_at, VALUES(last_message), last_message),
         last_at = GREATEST(COALESCE(last_at, VALUES(last_at)), VALUES(last_at)),
         unread = IF(?, 0, unread + VALUES(unread))`,
      [tenantId, staffId, row.jid, row.phone, row.pushName, row.body.slice(0, 500), row.sentAt, unread, row.fromMe ? 1 : 0]);
  }
  return fresh;
}

/** Names from the phone's address book, for chats that have none yet. */
async function recordContactNames(tenantId, staffId, contacts) {
  for (const contact of contacts || []) {
    const jid = chatJid({ remoteJid: contact.id, remoteJidAlt: contact.phoneNumber });
    const name = contact.name || contact.notify || contact.verifiedName;
    if (!jid || !name) continue;
    await pool.query(
      'UPDATE wa_web_chats SET name=? WHERE tenant_id=? AND staff_id=? AND jid=? AND (name IS NULL OR name=\'\')',
      [String(name).slice(0, 255), tenantId, staffId, jid]);
  }
}

/**
 * Which lead or client this chat's number belongs to — looked up once per chat.
 * The lookup reads every lead's phone, so it runs when a chat is opened, sent
 * to, or written to live, not across the hundreds of chats a linked phone
 * brings with it.
 */
async function matchChat(tenantId, staffId, jid) {
  const [[chat]] = await pool.query(
    'SELECT phone, lead_id, subscriber_id, matched_at FROM wa_web_chats WHERE tenant_id=? AND staff_id=? AND jid=?',
    [tenantId, staffId, jid]);
  if (!chat) return { leadId: null, subscriberId: null };
  if (chat.matched_at) return { leadId: chat.lead_id, subscriberId: chat.subscriber_id };
  let leadId = null;
  let subscriberId = null;
  const clause = chat.phone ? phoneIdentityClause(toIdentity(chat.phone)) : null;
  if (clause) {
    const [[sub]] = await pool.query(
      `SELECT id FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL AND ${clause.sql} ORDER BY created_at DESC LIMIT 1`,
      [tenantId, ...clause.params]);
    subscriberId = sub?.id || null;
    const [[lead]] = await pool.query(
      `SELECT id FROM leads WHERE tenant_id=? AND hidden=0 AND ${clause.sql} ORDER BY created_at DESC LIMIT 1`,
      [tenantId, ...clause.params]);
    leadId = lead?.id || null;
  }
  await pool.query(
    'UPDATE wa_web_chats SET lead_id=?, subscriber_id=?, matched_at=NOW() WHERE tenant_id=? AND staff_id=? AND jid=?',
    [leadId, subscriberId, tenantId, staffId, jid]);
  return { leadId, subscriberId };
}

/**
 * A message to or from a lead or client goes on their timeline, so the CRM's
 * contact counts and «آخر تواصل» see WhatsApp work done from this tab.
 */
async function logToCrm(tenantId, staffId, row, { leadId, subscriberId }) {
  if (!leadId && !subscriberId) return;
  await pool.query(
    `INSERT IGNORE INTO communications
       (id, tenant_id, lead_id, subscriber_id, type, direction, provider_message_id, date, notes, staff_id, created_at)
     VALUES (?,?,?,?, 'WHATSAPP', ?, ?, ?, ?, ?, NOW())`,
    [uuidv4(), tenantId, leadId || null, subscriberId || null, row.fromMe ? 'OUT' : 'IN',
      `waweb:${staffId}:${row.waId}`.slice(0, 128), row.sentAt, row.body.slice(0, 4000), staffId]);
}

module.exports = {
  chatJid, jidForPhone, parseWaMessage, phoneOfJid, recordMessages, recordContactNames, matchChat, logToCrm,
};
