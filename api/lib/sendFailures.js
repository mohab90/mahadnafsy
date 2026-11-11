'use strict';

// What a failed send or a failed credential check says about the CHANNEL, as opposed to the one message or the one moment.
// A channel parked in `error` is skipped by every automatic send until a person re-tests it, so only a failure that will
// still be a failure for the next message to the next person may park it.

/**
 * Will this failure still be a failure in a minute? Throttling, a timeout and a network blip say nothing about whether the
 * credentials work, and only those deserve to take the channel out of service.
 */
const TRANSIENT_PATTERNS = [
  /too many attempts/i,
  /rate.?limit/i,
  /\b429\b/,
  /timeout|timed out|abort/i,
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up|fetch failed/i,
  /\b(502|503|504)\b/,
  /bad gateway|service unavailable|gateway timeout/i,
  /temporarily unavailable|try again/i,
];

function reasonText(reason) {
  if (!reason) return '';
  if (typeof reason === 'string') return reason;
  return reason?.error?.message || reason?.message || JSON.stringify(reason).slice(0, 400);
}

const isTransientSendFailure = reason => TRANSIENT_PATTERNS.some(pattern => pattern.test(reasonText(reason)));

// Meta's own error codes (WhatsApp Cloud API and the Graph API) that are about the account, the token or the number — not about
// the person written to. 12 Nov 2026, «قنوات المراسلة بتقف ومش شغالة ليه»: every other refusal used to park the official WhatsApp
// channel too — a customer outside the 24-hour window (131047), a number that is not on WhatsApp (131026), a per-person marketing
// cap (131049), a bad parameter (100) — so one message to one person took the channel away from everybody.
const META_CHANNEL_CODES = new Set([
  0, 3, 10, 190, 200, 368,
  131005, // access denied
  131031, // account locked
  131042, // payment / billing problem on the business account
  131045, // the number is not registered (certificate)
]);
const metaCodeOf = reason => Number(reason?.error?.code ?? reason?.code);

/**
 * Does this failure mean the channel itself cannot send (so it should read «خطأ» until someone fixes it)?
 * For the official API only the account-level codes do (and the 2xx permission range, 133xxx registration range); a refusal with
 * no recognisable code keeps the channel as it was. Other providers give no such codes, so anything that is not transient counts.
 */
function isChannelLevelFailure(provider, reason) {
  if (!reason || reason === 'not_configured' || isTransientSendFailure(reason)) return false;
  if (provider !== 'meta') return true;
  const code = metaCodeOf(reason);
  if (!Number.isFinite(code)) return false;
  return META_CHANNEL_CODES.has(code) || (code >= 200 && code <= 299) || (code >= 133000 && code <= 133999);
}

module.exports = { isTransientSendFailure, isChannelLevelFailure };
