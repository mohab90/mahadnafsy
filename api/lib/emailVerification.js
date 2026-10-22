'use strict';

// Proving the email given at sign-up.
//
// A sign-up's email was trusted the moment it was typed: the account was
// matched to the client record with that address (lib/subscriberIdentity.js),
// could sign in with it, and had password-reset codes sent to it. Typing a
// client's address was enough to be taken for them. Now a sign-up with an email
// is marked users.email_unverified=1 and sent a link and a six-digit code;
// until one of them comes back, the address is not an identity anywhere —
// middleware/auth.js leaves it out of req.user, login and password reset do not
// look it up, and the client-record match skips it. Phone and WhatsApp sign-in
// are untouched: the number is how these accounts get in.

const crypto = require('node:crypto');
const logger = require('./logger');
const { uuidv4 } = require('./id');
const { generateNumericCode } = require('./secureCredentials');

const TOKEN_TTL_HOURS = 48;
const MAX_CODE_ATTEMPTS = 5;
// An address claimed and never proven stops blocking its real owner after
// this long: their own sign-up takes it (routes/auth/registration.js).
const UNPROVEN_CLAIM_HOURS = 48;

function hashSecret(kind, tenantId, value) {
  return crypto.createHash('sha256').update(`mahad-email-verify:${kind}:${tenantId}:${String(value || '').trim()}`).digest('hex');
}

const siteBase = () => String(process.env.CLIENT_URL || 'https://mahadnafsy.com').replace(/\/+$/, '');

function verificationLink(token) {
  return `${siteBase()}/api/auth/verify-email?t=${encodeURIComponent(token)}`;
}

/**
 * A fresh link and code for the account's current address; earlier ones stop
 * working. The email goes out after the rows are written; a failed send is
 * logged and the person can ask again (POST /api/auth/email/resend).
 */
async function issueEmailVerification(db, { tenantId, userId, email, name = '', send = null }) {
  const address = String(email || '').trim().toLowerCase();
  if (!address) return { issued: false };
  const token = crypto.randomBytes(32).toString('base64url');
  const code = generateNumericCode();
  await db.query(
    'UPDATE email_verifications SET used_at=NOW() WHERE tenant_id=? AND user_id=? AND used_at IS NULL',
    [tenantId, userId]
  );
  await db.query(
    `INSERT INTO email_verifications (id, tenant_id, user_id, email, token_hash, code_hash, expires_at)
     VALUES (?,?,?,?,?,?, NOW() + INTERVAL ? HOUR)`,
    [uuidv4(), tenantId, userId, address, hashSecret('token', tenantId, token), hashSecret('code', `${tenantId}:${userId}`, code), TOKEN_TTL_HOURS]
  );
  const sender = send || ((to, subject, html) => require('./email').sendEmail(to, subject, html, { tenantId, category: 'otp' }));
  try {
    await sender(address, 'أكّد بريدك الإلكتروني',
      `<p>أهلاً ${String(name || '').replace(/[<>&"]/g, '')}،</p>
       <p>علشان نربط البريد ده بحسابك، اضغط على الرابط:</p>
       <p style="text-align:center"><a href="${verificationLink(token)}">تأكيد البريد الإلكتروني</a></p>
       <p>أو اكتب الكود ده في حسابك:</p>
       <div class="otp-box">${code}</div>
       <p style="color:#888;font-size:13px;text-align:center;">صالح ${TOKEN_TTL_HOURS} ساعة. لو مش إنت اللي سجّلت، تجاهل الرسالة.</p>`);
    return { issued: true, sent: true, token, code };
  } catch (error) {
    logger.warn('[email-verify] could not send the verification email', { err: error.message });
    return { issued: true, sent: false, token, code };
  }
}

// The address is proven only if it is still the one the account holds.
async function markVerified(db, { tenantId, userId, email }) {
  const [result] = await db.query(
    `UPDATE users SET email_unverified=0, email_verified_at=NOW()
      WHERE tenant_id=? AND id=? AND LOWER(TRIM(email))=?`,
    [tenantId, userId, email]
  );
  return Number(result?.affectedRows) === 1;
}

/** From the link. @returns {Promise<{ok:boolean, tenantId?:string, userId?:string}>} */
async function verifyEmailToken(db, { tenantId, token }) {
  if (!token || String(token).length < 20) return { ok: false };
  const [[row]] = await db.query(
    `SELECT id, tenant_id, user_id, email FROM email_verifications
      WHERE token_hash=? AND tenant_id=? AND used_at IS NULL AND expires_at > NOW() LIMIT 1`,
    [hashSecret('token', tenantId, token), tenantId]
  );
  if (!row) return { ok: false };
  const [burned] = await db.query('UPDATE email_verifications SET used_at=NOW() WHERE id=? AND used_at IS NULL', [row.id]);
  if (Number(burned?.affectedRows) !== 1) return { ok: false };
  const ok = await markVerified(db, { tenantId: row.tenant_id, userId: row.user_id, email: row.email });
  return { ok, tenantId: row.tenant_id, userId: row.user_id };
}

/** From the code, typed by the signed-in account. Five wrong tries burn it. */
async function verifyEmailCode(db, { tenantId, userId, code }) {
  const clean = String(code || '').replace(/\D/g, '');
  const [[row]] = await db.query(
    `SELECT id, email, code_hash, attempts FROM email_verifications
      WHERE tenant_id=? AND user_id=? AND used_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, userId]
  );
  if (!row) return { ok: false, reason: 'expired' };
  if (clean.length !== 6 || hashSecret('code', `${tenantId}:${userId}`, clean) !== row.code_hash) {
    await db.query(
      'UPDATE email_verifications SET attempts=attempts+1, used_at=IF(attempts+1 >= ?, NOW(), used_at) WHERE id=?',
      [MAX_CODE_ATTEMPTS, row.id]
    );
    return { ok: false, reason: 'wrong_code' };
  }
  const [burned] = await db.query('UPDATE email_verifications SET used_at=NOW() WHERE id=? AND used_at IS NULL', [row.id]);
  if (Number(burned?.affectedRows) !== 1) return { ok: false, reason: 'expired' };
  return { ok: await markVerified(db, { tenantId, userId, email: row.email }) };
}

module.exports = {
  MAX_CODE_ATTEMPTS,
  TOKEN_TTL_HOURS,
  UNPROVEN_CLAIM_HOURS,
  issueEmailVerification,
  verificationLink,
  verifyEmailCode,
  verifyEmailToken,
};
