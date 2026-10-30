'use strict';

// Signing in with a code sent to the email — the second step that replaced the authenticator app.
//
// «محتاج الغي فكرة تطبيق المصادقه دا تماما واخلي الدخول علي السسيتم بكود بيروح للايميل فقط ودا في الحسابات المهمه». The accounts the
// security policy names (lib/mfaPolicy.js: the owner, the managers, finance, HR, and whoever holds a financial or staff-management
// permission) prove the password and then the mailbox: a six-digit code goes to the address the account signs in with, and the session
// is issued once it comes back. Everyone else signs in with the password alone, as before.
//
// Only a hash of the code is stored, a code lives ten minutes, and five wrong tries burn it. The step between the password and the code
// is a short-lived signed token. It is not bound to the network: the code is read in a mailbox, often on the same phone, and a phone that
// moves from WiFi to data on the way would lose its sign-in for nothing.

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const logger = require('./logger');
const { uuidv4 } = require('./id');
const { generateNumericCode } = require('./secureCredentials');
const { JWT_SECRET } = require('./token');
const { getMfaPolicy, accountRequiresMfa } = require('./mfaPolicy');

const CODE_TTL_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;
// A new code is not sent more often than this: the mailbox is not a way to flood someone, and each resend burns the one before it.
const RESEND_AFTER_SECONDS = 45;
const PENDING_PURPOSE = 'login_email_code';

const hashCode = (tenantId, userId, code) => crypto.createHash('sha256')
  .update(`mahad-login-email-code:v1:${tenantId}:${userId}:${String(code || '').replace(/\D/g, '')}`).digest('hex');

const refuse = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, code });

/** «ah***@gmail.com» — enough to know which mailbox, not enough to learn the address. */
function maskEmail(email) {
  const [name = '', domain = ''] = String(email || '').split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
}

/**
 * Whether signing in as this account needs the emailed code: the policy is on and the account is the owner, or a staff member the policy names.
 * @param {{ id: string, email?: string|null }} user a users row
 */
async function accountNeedsEmailCode({ tenantId, user, db = null }) {
  const policy = await getMfaPolicy(tenantId);
  if (!policy.enabled) return false;
  const email = String(user?.email || '').toLowerCase().trim();
  const { isInstituteOwner } = require('../middleware/auth');
  const isOwner = isInstituteOwner({ email, uid: user?.id, tenantId });
  const conn = db || require('./db').pool;
  const [[staff]] = email ? await conn.query(
    'SELECT role, permissions_json FROM staff WHERE tenant_id=? AND LOWER(TRIM(email))=? AND is_active=1 LIMIT 1',
    [tenantId, email]
  ) : [[null]];
  return accountRequiresMfa(policy, { isOwner, staff: staff || null });
}

/**
 * A fresh code for the account, mailed to `email`; earlier ones stop working. Refused (429) when one was sent a moment ago, and when the mail
 * could not be sent — the row is burned then, so nobody is left waiting for a message that was never sent.
 */
async function sendLoginCode(db, { tenantId, userId, email, name = '' }) {
  const address = String(email || '').trim().toLowerCase();
  if (!address) throw refuse(409, 'الحساب ده مالوش بريد إلكتروني مسجّل — اطلب من الإدارة تضيفه علشان كود الدخول يوصلك', 'EMAIL_CODE_NO_EMAIL');
  const [[recent]] = await db.query(
    `SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age FROM login_email_codes
      WHERE tenant_id=? AND user_id=? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`, [tenantId, userId]);
  if (recent && Number(recent.age) < RESEND_AFTER_SECONDS) {
    throw refuse(429, `استنى ${RESEND_AFTER_SECONDS - Number(recent.age)} ثانية قبل ما تطلب كود جديد`, 'EMAIL_CODE_TOO_SOON');
  }
  const id = uuidv4();
  const code = generateNumericCode();
  await db.query('UPDATE login_email_codes SET used_at=NOW() WHERE tenant_id=? AND user_id=? AND used_at IS NULL', [tenantId, userId]);
  await db.query(
    `INSERT INTO login_email_codes (id, tenant_id, user_id, email, code_hash, expires_at)
     VALUES (?,?,?,?,?, NOW() + INTERVAL ? MINUTE)`,
    [id, tenantId, userId, address, hashCode(tenantId, userId, code), CODE_TTL_MINUTES]);
  try {
    const sent = await require('./email').sendEmail(address, 'كود الدخول إلى النظام',
      `<p>أهلاً ${String(name || '').replace(/[<>&"]/g, '')}،</p>
       <p>كود الدخول بتاعك:</p>
       <div class="otp-box">${code}</div>
       <p style="color:#888;font-size:13px;text-align:center;">صالح ${CODE_TTL_MINUTES} دقايق ولمرة واحدة. لو مش إنت اللي بتحاول تدخل، متقولش الكود لأي حد وغيّر كلمة المرور.</p>`,
      { tenantId, category: 'otp' });
    if (sent?.suppressed) throw new Error('email category suppressed');
  } catch (error) {
    await db.query('UPDATE login_email_codes SET used_at=NOW() WHERE id=?', [id]).catch(() => {});
    logger.error('[login-email-code] the code could not be sent', { err: error.message });
    throw refuse(503, 'تعذّر إرسال الكود على البريد دلوقتي — جرّب بعد شوية أو كلّم الإدارة', 'EMAIL_CODE_SEND_FAILED');
  }
  return { id, email: address };
}

/**
 * Check the code the person typed against the newest one issued. Five wrong tries burn it. The row is burned in the same statement that
 * accepts it, so two requests with the right code cannot both get in.
 * @returns {Promise<{ ok: boolean, reason?: 'expired'|'wrong_code' }>}
 */
async function checkLoginCode(db, { tenantId, userId, code }) {
  const clean = String(code || '').replace(/\D/g, '');
  const [[row]] = await db.query(
    `SELECT id, code_hash FROM login_email_codes
      WHERE tenant_id=? AND user_id=? AND used_at IS NULL AND expires_at > NOW() AND attempts < ?
      ORDER BY created_at DESC LIMIT 1`, [tenantId, userId, MAX_CODE_ATTEMPTS]);
  if (!row) return { ok: false, reason: 'expired' };
  if (clean.length !== 6 || hashCode(tenantId, userId, clean) !== row.code_hash) {
    await db.query(
      'UPDATE login_email_codes SET attempts=attempts+1, used_at=IF(attempts+1 >= ?, NOW(), used_at) WHERE id=?', [MAX_CODE_ATTEMPTS, row.id]);
    return { ok: false, reason: 'wrong_code' };
  }
  const [burned] = await db.query('UPDATE login_email_codes SET used_at=NOW() WHERE id=? AND used_at IS NULL', [row.id]);
  return Number(burned?.affectedRows) === 1 ? { ok: true } : { ok: false, reason: 'expired' };
}

/** The step between the password and the code: who, and by which door (password or WhatsApp). */
function signPendingToken({ user, tenantId, via }) {
  return jwt.sign(
    { uid: user.id, email: user.email, tid: tenantId, sv: Number(user.session_version), via, purpose: PENDING_PURPOSE, jti: uuidv4() },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: `${CODE_TTL_MINUTES + 5}m` });
}

function readPendingToken(token) {
  let payload;
  try {
    payload = jwt.verify(String(token || ''), JWT_SECRET, { algorithms: ['HS256'] });
  } catch (_) {
    throw refuse(401, 'انتهت مهلة تسجيل الدخول — ابدأ من الأول', 'EMAIL_CODE_PENDING_EXPIRED');
  }
  if (payload.purpose !== PENDING_PURPOSE) throw refuse(400, 'رمز غير صالح', 'EMAIL_CODE_PENDING_INVALID');
  return payload;
}

/**
 * The answer to a sign-in that has proved the password (or the WhatsApp code) and now owes the emailed one: sends the code and returns the body
 * for the screen — a pendingToken to come back with, and where the code went. Throws the refusal (no email on file, mail down, asked too soon).
 */
async function startEmailCodeStep(req, { user, tenantId, via = 'password' }) {
  const { pool } = require('./db');
  const { logLoginAttempt } = require('./loginAudit');
  try {
    await sendLoginCode(pool, { tenantId, userId: user.id, email: user.email, name: user.name });
  } catch (error) {
    // The password entered again inside the resend window (a refresh, the back button, a second tab) keeps the code already in the
    // mailbox: it is still good. Refusing here left a person holding a valid code with no screen to type it on.
    if (error.code !== 'EMAIL_CODE_TOO_SOON') throw error;
  }
  await logLoginAttempt({ userId: user.id, email: user.email, req, tenantId, status: '2fa_pending' });
  return {
    ok: false,
    emailCodeRequired: true,
    pendingToken: signPendingToken({ user, tenantId, via }),
    emailHint: maskEmail(user.email),
    expiresInMinutes: CODE_TTL_MINUTES,
    resendAfterSeconds: RESEND_AFTER_SECONDS,
  };
}

module.exports = {
  CODE_TTL_MINUTES,
  MAX_CODE_ATTEMPTS,
  RESEND_AFTER_SECONDS,
  accountNeedsEmailCode,
  checkLoginCode,
  maskEmail,
  readPendingToken,
  sendLoginCode,
  signPendingToken,
  startEmailCodeStep,
};
