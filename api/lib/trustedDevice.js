'use strict';

// «This browser already proved the mailbox this week.» 4 Nov 2026, «كل اما بفتح حسابي لازم يطلب كود … انا عاوز لما انسى الباسورد او لما ادخل الباسورد 3 مرات غلط او لما اقعد
// تبقى كل اسبوع … مينفعش كل مرة»: the emailed code (lib/loginEmailCode.js) is asked for when it means something, not at every sign-in.
//
// A right code leaves a signed cookie on that browser for seven days (counted from the code, not renewed by using it, so the code comes back weekly). While it is good, the
// password alone signs the account in — and the session still counts as verified (`mfa: true`), because the mailbox was proved on this very browser. It stops being good when:
//   - the password changed (a forgotten password was reset): the cookie carries a fingerprint of the password hash it was issued under;
//   - the password was typed wrong three times in the last hour for this account: whoever is trying is not necessarily the person the cookie was given to;
//   - it is another account, another tenant, or past its seven days.
// The cookie is HttpOnly and scoped to /api/auth; it holds no secret beyond the signature.

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./token');

const COOKIE = 'mahadTrustedDevice';
const PURPOSE = 'trusted_device';
const TRUST_DAYS = 7;
const WRONG_PASSWORDS_THAT_REVOKE = 3;

const fingerprint = passwordHash => crypto.createHash('sha256').update(`trusted-device:v1:${String(passwordHash || '')}`).digest('base64url').slice(0, 22);

function carried(req) {
  return String(req?.headers?.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_.-]+)`))?.[1] || null;
}

async function passwordHashOf(db, { tenantId, user }) {
  if (user?.password_hash) return user.password_hash;
  const [[row]] = await db.query('SELECT password_hash FROM users WHERE tenant_id=? AND id=? LIMIT 1', [tenantId, user.id]);
  return row?.password_hash || '';
}

/** Leave the cookie on the response of a sign-in that has just proved the mailbox. */
async function rememberTrustedDevice(res, { db, tenantId, user }) {
  if (typeof res?.append !== 'function') return;
  const token = jwt.sign(
    { purpose: PURPOSE, uid: user.id, tid: tenantId, pw: fingerprint(await passwordHashOf(db, { tenantId, user })) },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: `${TRUST_DAYS}d` });
  res.append('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/api/auth; Max-Age=${TRUST_DAYS * 24 * 3600}; SameSite=None; Secure`);
}

/** Whether this browser proved the mailbox for this account within the week, with this password, and nobody has been guessing since. */
async function isTrustedDevice(req, { db, tenantId, user }) {
  const token = carried(req);
  if (!token) return false;
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (_) {
    return false;
  }
  if (payload.purpose !== PURPOSE || payload.uid !== user.id || payload.tid !== tenantId) return false;
  if (payload.pw !== fingerprint(await passwordHashOf(db, { tenantId, user }))) return false;
  const [[guesses]] = await db.query(
    `SELECT COUNT(*) AS n FROM login_history
      WHERE tenant_id=? AND user_id=? AND status='failed' AND failure_reason='wrong_password' AND created_at > NOW() - INTERVAL 1 HOUR`,
    [tenantId, user.id]);
  return Number(guesses?.n) < WRONG_PASSWORDS_THAT_REVOKE;
}

module.exports = { isTrustedDevice, rememberTrustedDevice, TRUST_COOKIE: COOKIE, TRUST_DAYS, WRONG_PASSWORDS_THAT_REVOKE };
