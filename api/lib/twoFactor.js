'use strict';

// Two-factor sign-in: the authenticator secret at rest, and the recovery codes
// that stand in for the phone when it is lost.
//
// The secret used to sit in users.totp_secret and staff.totp_secret as the raw
// base32 string. Anyone holding a copy of either table — a backup, a dump, a
// read-only replica — could generate every employee's codes, which is the one
// thing the second factor exists to prevent. It is sealed now with the same
// AES-256-GCM box the messaging credentials use (lib/secretBox.js), and a value
// written before this change is still read as it is, then sealed the next time
// its owner signs in with it.
//
// There were no recovery codes either, and the only way back for someone who
// lost their phone was HR offboarding them. Ten one-time codes are issued when
// 2FA is switched on, shown once, and only their hashes are kept.

const crypto = require('node:crypto');
const { seal, open } = require('./secretBox');

const SEALED_PREFIX = 'v1:';
const RECOVERY_CODE_COUNT = 10;
// No I, O, 0 or 1: these get read off paper and typed in a hurry.
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_CODE_LENGTH = 12; // 60 bits; shown as XXXX-XXXX-XXXX

function isSealedSecret(stored) {
  return String(stored || '').startsWith(SEALED_PREFIX);
}

/** What goes into totp_secret. */
function sealTotpSecret(secret) {
  return seal(String(secret));
}

/**
 * The authenticator secret from what totp_secret holds.
 * @returns {{ secret: string|null, legacy: boolean, unreadable: boolean }}
 *   legacy — it was stored in plain text and should be sealed now;
 *   unreadable — sealed, but not with this server's key (the key changed), so
 *   only a recovery code or an owner reset gets this person in.
 */
function readTotpSecret(stored) {
  const value = String(stored || '').trim();
  if (!value) return { secret: null, legacy: false, unreadable: false };
  if (!isSealedSecret(value)) return { secret: value, legacy: true, unreadable: false };
  try {
    const secret = open(value);
    return typeof secret === 'string' && secret
      ? { secret, legacy: false, unreadable: false }
      : { secret: null, legacy: false, unreadable: true };
  } catch (_) {
    return { secret: null, legacy: false, unreadable: true };
  }
}

/**
 * Seal a secret that was found in plain text, in both tables. Only rows still
 * holding that same plain value are touched, so a concurrent re-enrolment is
 * never overwritten with the old secret.
 */
async function sealLegacySecret(db, { tenantId, userId, email, secret }) {
  const sealed = sealTotpSecret(secret);
  await db.query(
    'UPDATE users SET totp_secret=? WHERE id=? AND tenant_id=? AND totp_secret=?',
    [sealed, userId, tenantId, secret]
  );
  const key = String(email || '').toLowerCase().trim();
  if (key) {
    await db.query(
      'UPDATE staff SET totp_secret=? WHERE tenant_id=? AND LOWER(TRIM(email))=? AND totp_secret=?',
      [sealed, tenantId, key, secret]
    ).catch(() => {});
  }
}

function formatRecoveryCode(raw) {
  return raw.match(/.{1,4}/g).join('-');
}

/** Upper-cased, separators dropped; '' when it cannot be one of ours. */
function normalizeRecoveryCode(input) {
  const code = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== RECOVERY_CODE_LENGTH) return '';
  return [...code].every(ch => RECOVERY_ALPHABET.includes(ch)) ? code : '';
}

function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const codes = new Set();
  while (codes.size < count) {
    let raw = '';
    for (let i = 0; i < RECOVERY_CODE_LENGTH; i += 1) raw += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
    codes.add(formatRecoveryCode(raw));
  }
  return [...codes];
}

/**
 * The stored form. Not keyed with a server secret on purpose: recovery codes
 * are what someone uses when the sealed secret cannot be opened, so they must
 * not depend on the same key. Sixty random bits, salted with the account, is
 * past brute force for a one-time code.
 */
function hashRecoveryCode({ tenantId, userId, code }) {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return '';
  return crypto.createHash('sha256')
    .update(`mahad-mfa-recovery:v1:${tenantId}:${userId}:${normalized}`)
    .digest('hex');
}

/** A fresh set replaces whatever the account had. Returns the codes, to show once. */
async function replaceRecoveryCodes(db, { tenantId, userId }) {
  const codes = generateRecoveryCodes();
  await db.query('DELETE FROM user_mfa_recovery_codes WHERE tenant_id=? AND user_id=?', [tenantId, userId]);
  await db.query(
    'INSERT INTO user_mfa_recovery_codes (tenant_id, user_id, code_hash) VALUES ?',
    [codes.map(code => [tenantId, userId, hashRecoveryCode({ tenantId, userId, code })])]
  );
  return codes;
}

/**
 * Burn a code. One UPDATE that matches only an unused one, so two requests
 * racing with the same code cannot both get in.
 */
async function consumeRecoveryCode(db, { tenantId, userId, code }) {
  const hash = hashRecoveryCode({ tenantId, userId, code });
  if (!hash) return false;
  const [result] = await db.query(
    `UPDATE user_mfa_recovery_codes SET used_at=NOW()
      WHERE tenant_id=? AND user_id=? AND code_hash=? AND used_at IS NULL`,
    [tenantId, userId, hash]
  );
  return Number(result?.affectedRows) === 1;
}

async function recoveryCodesLeft(db, { tenantId, userId }) {
  const [[row]] = await db.query(
    'SELECT COUNT(*) AS n FROM user_mfa_recovery_codes WHERE tenant_id=? AND user_id=? AND used_at IS NULL',
    [tenantId, userId]
  );
  return Number(row?.n || 0);
}

async function clearRecoveryCodes(db, { tenantId, userIds }) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean);
  if (!ids.length) return;
  await db.query('DELETE FROM user_mfa_recovery_codes WHERE tenant_id=? AND user_id IN (?)', [tenantId, ids]);
}

module.exports = {
  RECOVERY_CODE_COUNT,
  clearRecoveryCodes,
  consumeRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  isSealedSecret,
  normalizeRecoveryCode,
  readTotpSecret,
  recoveryCodesLeft,
  replaceRecoveryCodes,
  sealLegacySecret,
  sealTotpSecret,
};
