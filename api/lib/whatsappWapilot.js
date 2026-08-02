'use strict';
/**
 * Wapilot — a WhatsApp-Web session provider (api.wapilot.net).
 *
 * What is verified against the live API, and therefore hardcoded here:
 *   • base is https://api.wapilot.net/api/v2
 *   • auth is `Authorization: Bearer <apiKey>` — the only scheme that answers;
 *     x-api-key and a bare token both return 401
 *   • GET /instances                     → { success, instances: [...] }
 *   • GET /instances/{unique}            → { success, instance: {...} }
 *   • GET /instances/{unique}/status     → { success, status, me_id, ... }
 *     status 'WORKING' means the session is live and can send
 *
 * What is NOT verified, and is therefore configuration rather than code: the
 * send endpoint. Wapilot publishes no documentation and every plausible path
 * returns the same generic NOT_FOUND from a catch-all handler, so guessing it
 * would produce an adapter that looks finished and silently fails — the exact
 * failure this codebase has been bitten by before.
 *
 * So `sendPath` and the two body field names are stored with the channel, with
 * the most likely defaults filled in. When the real spec arrives from Wapilot it
 * is a settings change, not a deploy — and the channel test says immediately
 * whether it is right.
 */
const logger = require('./logger');

const BASE = process.env.WAPILOT_BASE_URL || 'https://api.wapilot.net/api/v2';
const TIMEOUT_MS = Number(process.env.WAPILOT_TIMEOUT_MS || 15000);

// Best guesses, overridable per channel. Deliberately named so an admin editing
// them knows they are placeholders until a real send succeeds.
const DEFAULT_SEND_PATH = 'instances/{instance}/send-message';
const DEFAULT_RECIPIENT_FIELD = 'chatId';
const DEFAULT_MESSAGE_FIELD = 'message';

function headers(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * Is the session live?
 *
 * This is a real connection check — unlike Meta and Green-API, which can only be
 * proven by sending an actual message to someone. A channel backed by Wapilot
 * can be verified without messaging a soul.
 *
 * @returns {Promise<{ok: boolean, status?: string, number?: string, name?: string, reason?: any}>}
 */
async function verifyWapilot(credentials = {}) {
  const { apiKey, instance } = credentials;
  if (!apiKey || !instance) return { ok: false, reason: 'not_configured' };
  try {
    const response = await fetch(
      `${BASE}/instances/${encodeURIComponent(instance)}/status`,
      { headers: headers(apiKey), signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success !== true) {
      return { ok: false, reason: data?.message || `HTTP ${response.status}` };
    }
    // A session can exist but be logged out; only WORKING can actually send, and
    // reporting anything else as connected would hide a dead session.
    if (String(data.status).toUpperCase() !== 'WORKING') {
      return { ok: false, status: data.status, reason: data.status_message || `الجلسة ${data.status}` };
    }
    return {
      ok: true,
      status: data.status,
      // me_id arrives as "201200400031@c.us"
      number: String(data.me_id || '').split('@')[0] || null,
      name: data.me_push_name || null,
    };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

/** The instances this key can see — used to populate the admin's picker. */
async function listWapilotInstances(apiKey) {
  if (!apiKey) return { ok: false, reason: 'not_configured', instances: [] };
  try {
    const response = await fetch(`${BASE}/instances`, {
      headers: headers(apiKey), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success !== true) {
      return { ok: false, reason: data?.message || `HTTP ${response.status}`, instances: [] };
    }
    return {
      ok: true,
      instances: (data.instances || []).map(row => ({
        uniqueName: row.instance_uniquename,
        name: row.instance_name,
        status: row.status,
        number: String(row.me_id || '').split('@')[0] || null,
        displayName: row.me_push_name || null,
        subscriptionStatus: row.subscription_status || null,
        // Surfaced because a lapsed subscription stops delivery with no other
        // outward sign — the channel keeps reporting WORKING.
        subscriptionEndsAt: row.subscription?.end_date || null,
      })),
    };
  } catch (error) {
    return { ok: false, reason: error.message, instances: [] };
  }
}

/**
 * Send a message.
 *
 * @param {string} dialable full international number, digits only
 * @param {object} credentials { apiKey, instance, sendPath?, recipientField?, messageField? }
 */
async function sendViaWapilot(dialable, message, credentials = {}) {
  const { apiKey, instance } = credentials;
  if (!apiKey || !instance) {
    logger.warn('[Wapilot] not configured — skipping');
    return { ok: false, provider: 'wapilot', reason: 'not_configured' };
  }

  const path = String(credentials.sendPath || DEFAULT_SEND_PATH).replace('{instance}', instance);
  const recipientField = credentials.recipientField || DEFAULT_RECIPIENT_FIELD;
  const messageField = credentials.messageField || DEFAULT_MESSAGE_FIELD;

  // Wapilot addresses chats the way WhatsApp Web does — the live API reports
  // me_id as "201200400031@c.us" — so the suffix is added unless the configured
  // field already carries one.
  const recipient = /@/.test(dialable) ? dialable : `${dialable}@c.us`;

  try {
    const response = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify({ [recipientField]: recipient, [messageField]: message }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      logger.warn('[Wapilot] send failed', { status: response.status, message: data?.message });
      // A 404 here almost certainly means sendPath is still the placeholder
      // rather than the real endpoint — say so, rather than leaving an admin to
      // wonder why a WORKING session will not send.
      const reason = response.status === 404
        ? 'مسار الإرسال غير صحيح — عدّله في إعدادات القناة بالمسار الرسمي من Wapilot'
        : (data?.message || `HTTP ${response.status}`);
      return { ok: false, provider: 'wapilot', reason };
    }
    return {
      ok: true,
      provider: 'wapilot',
      idMessage: data.message_id || data.id || data.idMessage || null,
    };
  } catch (error) {
    return { ok: false, provider: 'wapilot', reason: error.message };
  }
}

module.exports = {
  BASE,
  DEFAULT_SEND_PATH,
  DEFAULT_RECIPIENT_FIELD,
  DEFAULT_MESSAGE_FIELD,
  verifyWapilot,
  listWapilotInstances,
  sendViaWapilot,
};
