'use strict';

const SECRET_KEY = /^(api[_-]?key|api[_-]?secret|secret[_-]?key|app[_-]?secret|hmac[_-]?secret|smtp[_-]?password|password|access[_-]?token|page[_-]?access[_-]?token|api[_-]?token|auth[_-]?token|verify[_-]?token|webhook[_-]?verify[_-]?token|secret)$/i;

function isPlainJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The handshake string Meta's webhook form asks for. The admin pastes it THERE, so it has to be readable here: a blanked value is not a
// protected one, it is a field that looks lost (the Integrations screen showed an empty «Webhook Verify Token» after every save).
const VERIFY_TOKEN = /^(webhook[_-]?)?verify[_-]?token$/i;
// Tokens and API keys may show their last four characters so «which one is saved?» has an answer; a password or an app secret shows only that one is.
const TAILABLE = /(token|api[_-]?key)$/i;
// Beside a blanked secret, the answer to «is one saved?»: { accessToken: '1234', appSecret: true }. Never stored — preserveStoredSecrets drops it.
const SAVED_HINTS = '__savedSecrets';

/**
 * The value with every secret emptied. Without options this is the long-standing behaviour. A screen that offers to edit the secret asks
 * for `hints` (an object, `__savedSecrets`, saying which are saved) and, where the secret is only a handshake string, `keepVerifyTokens`.
 */
function redactSecrets(value, options = {}) {
  if (Array.isArray(value)) return value.map(item => redactSecrets(item, options));
  if (!isPlainJsonObject(value)) return value;
  const out = {};
  const saved = {};
  for (const [key, item] of Object.entries(value)) {
    const secret = SECRET_KEY.test(key) && !(options.keepVerifyTokens && VERIFY_TOKEN.test(key));
    if (secret && item) {
      out[key] = '';
      if (options.hints) saved[key] = TAILABLE.test(key) && typeof item === 'string' && item.trim().length >= 8 ? item.trim().slice(-4) : true;
    } else {
      out[key] = secret ? item : redactSecrets(item, options);
    }
  }
  if (Object.keys(saved).length) out[SAVED_HINTS] = saved;
  return out;
}

function preserveStoredSecrets(stored, incoming) {
  if (Array.isArray(incoming)) {
    const oldById = new Map((Array.isArray(stored) ? stored : []).map(item => [item?.id, item]));
    return incoming.map((item, index) => preserveStoredSecrets(oldById.get(item?.id) || stored?.[index], item));
  }
  if (!isPlainJsonObject(incoming)) return incoming;
  const old = isPlainJsonObject(stored) ? stored : {};
  return Object.fromEntries(Object.entries(incoming).filter(([key]) => key !== SAVED_HINTS).map(([key, item]) => {
    if (SECRET_KEY.test(key) && item === '') return [key, old[key] ?? ''];
    return [key, preserveStoredSecrets(old[key], item)];
  }));
}

module.exports = { SAVED_HINTS, isPlainJsonObject, preserveStoredSecrets, redactSecrets };
