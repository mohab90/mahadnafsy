'use strict';
/**
 * Wapilot — a WhatsApp-Web session provider (api.wapilot.net).
 *
 * What is verified against the live API, and therefore hardcoded here:
 *   • base is https://api.wapilot.net/api/v2
 *   • auth: `Authorization: Bearer <apiKey>` works everywhere. A dedicated
 *     `token: <apiKey>` header also authenticates (it is what Wapilot's own
 *     examples use); `x-api-key`, `api-key`, and a bare unprefixed
 *     Authorization value all return 401.
 *   • GET /instances                     → { success, instances: [...] }
 *   • GET /instances/{unique}            → { success, instance: {...} }
 *   • GET /instances/{unique}/status     → { success, status, me_id, ... }
 *     status 'WORKING' means the session is live and can send
 *
 *   • POST /{unique}/send-message  → { chat_id, text, priority?, send_at? }
 *     confirmed by posting an empty body and reading the 422 back: it names
 *     chat_id and text as required, which proves path and auth without
 *     delivering anything to anyone.
 *
 * Note the send path has NO /instances/ segment — the instance name sits
 * directly under /v2/. Every earlier guess included it and got a catch-all
 * NOT_FOUND, which is why this is spelled out rather than inferred.
 *
 * Both `Authorization: Bearer <key>` and `token: <key>` authenticate. Bearer is
 * used throughout so there is one scheme to reason about.
 *
 * The path and field names stay overridable per channel. They are verified
 * today, but a provider that publishes no documentation can change them without
 * telling anyone, and a settings change beats an emergency deploy.
 */
const logger = require('./logger');
const { toDialable } = require('./phoneNumber');

const BASE = process.env.WAPILOT_BASE_URL || 'https://api.wapilot.net/api/v2';
const TIMEOUT_MS = Number(process.env.WAPILOT_TIMEOUT_MS || 15000);

// Verified against the live API — see the 422 probe described above.
const DEFAULT_SEND_PATH = '{instance}/send-message';
const DEFAULT_RECIPIENT_FIELD = 'chat_id';
const DEFAULT_MESSAGE_FIELD = 'text';

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
 * Turn a provider rejection into something an admin can act on.
 *
 * Wapilot answers a bad request with 422 and a per-field `errors` object. That
 * detail is the whole difference between "لم يتم الإرسال" and knowing the
 * number was malformed, so it is unpacked rather than collapsed into a status
 * code.
 */
function describeFailure(status, data) {
  if (status === 422 && data?.errors) {
    const fields = Object.values(data.errors).flat().filter(Boolean);
    if (fields.length) return fields.join(' · ');
  }
  if (status === 404) {
    return 'مسار الإرسال مرفوض — راجع اسم النسخة في إعدادات القناة';
  }
  if (status === 401 || status === 403) {
    return 'مفتاح الـAPI مرفوض — جدّده من لوحة Wapilot';
  }
  return data?.message || `HTTP ${status}`;
}

/**
 * Send a message.
 *
 * `send_at` is deliberately not used even though Wapilot supports it. Campaign
 * pacing already staggers delivery through the outbox, which works the same for
 * every provider — and a message already handed to Wapilot with a future
 * send_at cannot be recalled, so "cancel campaign" would stop being honest.
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
  // me_id as "201200400031@c.us" — so the suffix is added unless one is present.
  //
  // The number is re-normalised here rather than trusted from the caller. Every
  // real send already arrives dialable, but a caller that passes 01012345678
  // would otherwise address 01012345678@c.us, which is nobody. That missing
  // country code is the single most expensive bug in this system's history, and
  // an adapter is the last place it can still be caught.
  const [rawNumber, suffix] = String(dialable).split('@');
  const normalized = toDialable(rawNumber);
  if (!normalized) {
    logger.warn('[Wapilot] refusing to send: number is not dialable');
    return { ok: false, provider: 'wapilot', reason: 'invalid_number' };
  }
  const recipient = `${normalized}@${suffix || 'c.us'}`;

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
      return { ok: false, provider: 'wapilot', reason: describeFailure(response.status, data) };
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
