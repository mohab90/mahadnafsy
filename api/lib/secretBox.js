'use strict';
/**
 * Encryption at rest for third-party credentials.
 *
 * The existing pattern (provider tokens in site_config as plain JSON, redacted
 * on read) is tolerable for one company-wide token an admin pasted. It is not
 * tolerable for what this now stores: one WhatsApp credential per employee,
 * dozens of them, each granting the ability to send as that person. A dump of
 * one table would hand over every staff member's messaging identity at once.
 *
 * AES-256-GCM, so a tampered ciphertext fails to decrypt rather than silently
 * yielding altered credentials.
 */
const crypto = require('node:crypto');
const { resolveSecret } = require('./secretResolver');

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;   // GCM standard
const TAG_BYTES = 16;
const VERSION = 'v1';

let cachedKey = null;

/**
 * The key comes from CHANNEL_SECRET_KEY, falling back to JWT_SECRET so an
 * existing deployment works without new configuration. Derived with scrypt so a
 * short or low-entropy env value still produces a full-length key.
 */
function getKey() {
  if (cachedKey) return cachedKey;
  const raw = String(
    (() => { try { return resolveSecret('CHANNEL_SECRET_KEY'); } catch (_) { return ''; } })()
    || (() => { try { return resolveSecret('JWT_SECRET'); } catch (_) { return ''; } })()
    || ''
  );
  if (raw.length < 16) {
    throw new Error('CHANNEL_SECRET_KEY (or JWT_SECRET) must be set and at least 16 characters to store channel credentials');
  }
  // Fixed salt: the key must be reproducible across restarts and across the
  // several processes that read these rows. Secrecy lives in the env value.
  cachedKey = crypto.scryptSync(raw, 'mahad-channel-credentials', 32);
  return cachedKey;
}

/** @returns {string} "v1:<iv>:<tag>:<ciphertext>", all base64url */
function seal(value) {
  const plaintext = Buffer.from(JSON.stringify(value ?? null), 'utf8');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

/**
 * @returns the original value, or null when the input is empty.
 * @throws when the ciphertext was tampered with or the key changed — callers
 *         must treat that as "this channel is unusable", never as "no creds".
 */
function open(sealed) {
  if (!sealed) return null;
  const parts = String(sealed).split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Unrecognised credential format');
  const [, ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('Malformed credential envelope');
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

/** True when a credential store is configured at all — for startup diagnostics. */
function isConfigured() {
  try { getKey(); return true; } catch (_) { return false; }
}

/** Test seam: forget the derived key so a changed env value takes effect. */
function _resetKeyCache() { cachedKey = null; }

module.exports = { seal, open, isConfigured, _resetKeyCache };
