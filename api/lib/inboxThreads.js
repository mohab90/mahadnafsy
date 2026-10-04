'use strict';
/**
 * The team inbox: one conversation per person per platform.
 *
 * The company has one WhatsApp number, one Facebook page and one Instagram
 * account, and every sales rep answers from them. What the reps need from the
 * system is the thing a shared phone cannot give them: who is answering whom.
 * A conversation belongs to one rep at a time (assigned_staff_id); the rest
 * see it is taken. A new person is the lead's own rep's, or nobody's until a
 * rep takes it — and whoever answers an unowned conversation takes it.
 *
 * The messages stay in `communications`, the timeline the CRM and the client
 * page read; a thread only says which conversation each one is part of and
 * what state that conversation is in.
 */
const { pool } = require('./db');
const { uuidv4 } = require('./id');

const PLATFORMS = ['whatsapp', 'messenger', 'instagram'];
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Meta lets a business answer in plain text for 24 h after the customer's last message. */
function isWindowOpen(lastInboundAt, now = Date.now()) {
  if (!lastInboundAt) return false;
  const at = new Date(lastInboundAt).getTime();
  return Number.isFinite(at) && now - at < REPLY_WINDOW_MS;
}

/**
 * The conversation with this person on this platform, made on first contact.
 * A later message fills in what the first one did not know (who the lead is).
 *
 * @returns {Promise<{id: string, assigned_staff_id: string|null}>}
 */
async function upsertThread(db, {
  tenantId, platform, contactKey, channelId = null,
  leadId = null, subscriberId = null, contactName = null, ownerStaffId = null,
}) {
  if (!PLATFORMS.includes(platform)) throw new Error(`unknown platform ${platform}`);
  const key = String(contactKey || '').slice(0, 64);
  if (!key) throw new Error('contact key is required');
  await db.query(
    `INSERT INTO inbox_threads
       (id, tenant_id, platform, contact_key, channel_id, lead_id, subscriber_id, contact_name,
        assigned_staff_id, assigned_at)
     VALUES (?,?,?,?,?,?,?,?,?, IF(? IS NULL, NULL, NOW()))
     ON DUPLICATE KEY UPDATE
       channel_id    = COALESCE(VALUES(channel_id), channel_id),
       lead_id       = COALESCE(lead_id, VALUES(lead_id)),
       subscriber_id = COALESCE(subscriber_id, VALUES(subscriber_id)),
       contact_name  = COALESCE(VALUES(contact_name), contact_name),
       -- assigned_at first: the assignments run in order and each sees the ones before it.
       assigned_at   = IF(assigned_staff_id IS NULL AND VALUES(assigned_staff_id) IS NOT NULL, NOW(), assigned_at),
       assigned_staff_id = COALESCE(assigned_staff_id, VALUES(assigned_staff_id))`,
    [uuidv4(), tenantId, platform, key, channelId, leadId, subscriberId,
      contactName ? String(contactName).slice(0, 255) : null, ownerStaffId, ownerStaffId]);
  const [[thread]] = await db.query(
    'SELECT id, assigned_staff_id FROM inbox_threads WHERE tenant_id=? AND platform=? AND contact_key=? LIMIT 1',
    [tenantId, platform, key]);
  return thread;
}

/**
 * File a message under its conversation and move the conversation's state:
 * a message in reopens it and waits for an answer; a message out answers it.
 */
async function recordOnThread(db, { tenantId, threadId, communicationId, direction, text, at = new Date() }) {
  const inbound = direction === 'IN';
  await db.query(
    `UPDATE inbox_threads
        SET last_message_at = GREATEST(COALESCE(last_message_at, ?), ?),
            last_direction  = IF(last_message_at IS NULL OR ? >= last_message_at, ?, last_direction),
            last_preview    = IF(last_message_at IS NULL OR ? >= last_message_at, ?, last_preview),
            last_inbound_at = IF(?, GREATEST(COALESCE(last_inbound_at, ?), ?), last_inbound_at),
            unread_count    = IF(?, unread_count + 1, 0),
            status          = IF(?, 'open', status)
      WHERE tenant_id=? AND id=?`,
    [at, at, at, direction, at, String(text || '').replace(/\s+/g, ' ').slice(0, 200),
      inbound, at, at, inbound, inbound, tenantId, threadId]);
  if (communicationId) {
    await db.query('UPDATE communications SET thread_id=? WHERE tenant_id=? AND id=?',
      [threadId, tenantId, communicationId]);
  }
}

module.exports = { PLATFORMS, REPLY_WINDOW_MS, isWindowOpen, upsertThread, recordOnThread };
