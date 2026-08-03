'use strict';

// Sign-in by WhatsApp number + one-time code.
//
// Runs ALONGSIDE email/password rather than replacing it. This path can't be
// exercised against a live database or a real WhatsApp send before release, and
// an auth change that turns out wrong locks every user out — so email sign-in
// stays as the fallback until this is proven in production.
//
// Security properties kept identical to the email OTP flow already in auth.js:
//  - only an HMAC of the code is stored, never the code itself
//  - any previous unused code for the same number is invalidated on each request
//  - a wrong code is counted, and the code dies after too many attempts
//  - the response never reveals whether a number belongs to an account

const crypto = require('crypto');
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { describeReason, sendWhatsApp } = require('./whatsapp');
const { toIdentity, isPlausible } = require('./phoneNumber');
const { resolveSecret } = require('./secretResolver');
const logger = require('./logger');

const CODE_TTL_MINUTES = Math.max(1, Number(process.env.WA_OTP_TTL_MINUTES || 10));
const MAX_ATTEMPTS = Math.max(1, Number(process.env.WA_OTP_MAX_ATTEMPTS || 5));
// Codes an unregistered number may be sent per hour, from any source.
const SIGNUP_CODES_PER_HOUR = Math.max(1, Number(process.env.WA_SIGNUP_CODES_PER_HOUR || 3));

/**
 * Reduce anything a user might type to comparable digits.
 * Egyptian numbers arrive as 01012345678, +2010…, 002010… or with spaces and
 * dashes; all of those are the same person, so they must normalise to one value
 * or a number would fail to match the account it belongs to.
 */
// Both delegate to lib/phoneNumber.js — the identity key here and the delivery
// address used by lib/whatsapp.js have to come from one place, or a number can
// identify an account and still be unreachable (which is exactly what happened).
const normalizeWhatsAppNumber = toIdentity;
const isPlausibleNumber = isPlausible;

function generateCode() {
  // 6 digits from a CSPRNG. Math.random() is predictable enough to be guessable
  // when an attacker can observe a few codes.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashCode({ tenantId, phone, code }) {
  const secret = String(resolveSecret('OTP_HMAC_SECRET') || resolveSecret('JWT_SECRET') || '');
  if (secret.length < 16) throw new Error('OTP signing secret is not configured');
  return crypto.createHmac('sha256', secret)
    .update(`${tenantId}\0${phone}\0login\0${String(code).trim()}`)
    .digest('hex');
}

/**
 * Issue a login code to a WhatsApp number.
 * Returns { ok, delivered } and never reveals whether the number is registered.
 */
async function requestLoginCode({ tenantId, phone }) {
  const normalized = normalizeWhatsAppNumber(phone);
  if (!isPlausibleNumber(normalized)) {
    const error = new Error('رقم واتساب غير صالح');
    error.statusCode = 400;
    throw error;
  }

  let [[user]] = await pool.query(
    'SELECT id FROM users WHERE tenant_id=? AND phone=? AND is_active=1 LIMIT 1',
    [tenantId, normalized]
  );

  // A paying client added by staff lives in `subscribers` and may have no users
  // row at all — they never signed up on the site. Without this they'd be
  // permanently unable to log in now that WhatsApp is the way in. Same recovery
  // the email reset flow already performs: adopt the subscriber as an account,
  // keyed on their number. The password hash is deliberately random and
  // unguessable — this account can only ever be entered by OTP.
  if (!user) {
    const [[sub]] = await pool.query(
      `SELECT id, name, email FROM subscribers
        WHERE tenant_id=? AND REGEXP_REPLACE(phone,'[^0-9]','') LIKE ?
          AND is_active=1 LIMIT 1`,
      [tenantId, `%${normalized}`]
    );
    if (sub) {
      const newId = uuidv4();
      const lockedHash = crypto.randomBytes(32).toString('hex');
      await pool.query(
        `INSERT IGNORE INTO users
           (id, tenant_id, email, phone, password_hash, name, role, is_active)
         VALUES (?,?,?,?,?,?, 'user', 1)`,
        [newId, tenantId, sub.email || null, normalized, lockedHash, sub.name || '']
      );
      [[user]] = await pool.query(
        'SELECT id FROM users WHERE tenant_id=? AND phone=? AND is_active=1 LIMIT 1',
        [tenantId, normalized]
      );
      if (user) {
        // Link the two records immediately. Every /api/me/* route resolves the
        // client through subscribers.firebase_uid; a subscriber with no email
        // has nothing else to match on, so without this the adopted account
        // signs in successfully to an empty dashboard.
        await pool.query(
          `UPDATE subscribers SET firebase_uid=?, updated_at=updated_at
            WHERE id=? AND tenant_id=? AND firebase_uid IS NULL`,
          [user.id, sub.id, tenantId]
        ).catch(e => logger.warn('[wa-otp] subscriber link failed:', e.message));
        logger.info('[wa-otp] adopted an existing subscriber as a WhatsApp account');
      }
    }
  }

  // A number with no account still gets a code — that IS registration. The
  // account is created on verification, not here, so an unanswered code leaves
  // nothing behind.
  //
  // This also closes a leak: the old branch returned without sending, so the
  // response told anyone watching whether a number was registered. Now both
  // paths do the same work and answer the same way.
  const isNewAccount = !user;
  if (isNewAccount) {
    // The IP limiter cannot carry this alone: once codes reach numbers with no
    // account, rotating IPs would turn the institute's own WhatsApp into a way
    // to message strangers. This caps a single number regardless of source.
    const [[recent]] = await pool.query(
      `SELECT COUNT(*) AS n FROM otp_codes
        WHERE tenant_id=? AND phone=? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [tenantId, normalized]
    );
    if (Number(recent?.n || 0) >= SIGNUP_CODES_PER_HOUR) {
      logger.warn('[wa-otp] per-number signup throttle hit');
      // Reported as success so the throttle itself cannot be used to probe.
      return { ok: true, delivered: false, isNewAccount: true };
    }
  }

  const code = generateCode();
  const id = uuidv4();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "UPDATE otp_codes SET used=1 WHERE tenant_id=? AND phone=? AND type='login' AND used=0",
      [tenantId, normalized]
    );
    await conn.query(
      `INSERT INTO otp_codes (id, tenant_id, user_id, phone, code, type, expires_at)
       VALUES (?,?,?,?,?,'login', DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
      [id, tenantId, user?.id || null, normalized, hashCode({ tenantId, phone: normalized, code }), CODE_TTL_MINUTES]
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }

  // sendWhatsApp reports failure by RETURNING { ok:false, reason } — it throws
  // only on a bug in its own call frame. Awaiting it inside a try/catch and
  // acting on the throw therefore caught almost nothing: a dead channel, a
  // rejected number, an exhausted daily budget or an unreachable provider all
  // came back as a resolved promise, the code stayed live and unsent, and the
  // caller was told it had been delivered. The user then waits for a message
  // that does not exist and burns their hourly quota retrying.
  let result;
  try {
    // A first-time recipient has no idea why a code just arrived, so the message
    // says where it came from before it says the number.
    const opening = isNewAccount
      ? 'أهلاً بك في معهد الدراسات النفسية 🌿\nرمز إنشاء حسابك'
      : 'رمز الدخول';
    result = await sendWhatsApp(
      normalized,
      `${opening}: ${code}\nصالح لمدة ${CODE_TTL_MINUTES} دقائق. لا تشاركه مع أحد.`,
      { tenantId }
    );
  } catch (error) {
    result = { ok: false, reason: error.message };
  }

  if (!result?.ok) {
    // Burn the code rather than leaving a live one nobody received.
    const reason = String(describeReason(result?.reason)).slice(0, 80);
    await pool.query(
      "UPDATE otp_codes SET used=1, delivery_status='failed', delivery_error_code=? WHERE id=?",
      [reason, id]
    ).catch(() => {});
    logger.error('[wa-otp] delivery failed', { reason });
    const failure = new Error('تعذّر إرسال الرمز عبر واتساب. حاول لاحقاً.');
    failure.statusCode = 503;
    throw failure;
  }

  // Recorded on success too, so a code that never arrived can be told apart
  // from one that did. Nothing wrote these before, which left every delivery
  // question unanswerable from the row itself.
  await pool.query(
    "UPDATE otp_codes SET delivery_status='accepted', provider_message_id=?, sent_at=NOW() WHERE id=?",
    [result.idMessage || null, id]
  ).catch(() => {});
  return { ok: true, delivered: true, isNewAccount };
}

/**
 * Verify a code. Returns the matching user id, or throws 400/429.
 * Consumes the code on success so it can never be replayed.
 */
async function verifyLoginCode({ tenantId, phone, code, name = null }) {
  const normalized = normalizeWhatsAppNumber(phone);
  const digits = String(code || '').replace(/\D/g, '');
  if (!isPlausibleNumber(normalized) || digits.length !== 6) {
    const error = new Error('رقم أو رمز غير صالح');
    error.statusCode = 400;
    throw error;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      `SELECT id, user_id, code, attempts FROM otp_codes
        WHERE tenant_id=? AND phone=? AND type='login' AND used=0 AND expires_at > NOW()
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [tenantId, normalized]
    );
    if (!row) {
      await conn.commit();
      const error = new Error('الرمز غير صحيح أو منتهي الصلاحية');
      error.statusCode = 400;
      throw error;
    }
    if (Number(row.attempts || 0) >= MAX_ATTEMPTS) {
      await conn.query('UPDATE otp_codes SET used=1 WHERE id=?', [row.id]);
      await conn.commit();
      const error = new Error('تم تجاوز عدد المحاولات. اطلب رمزاً جديداً.');
      error.statusCode = 429;
      throw error;
    }

    const expected = hashCode({ tenantId, phone: normalized, code: digits });
    const supplied = Buffer.from(expected, 'hex');
    const stored = Buffer.from(String(row.code || ''), 'hex');
    // Constant-time compare so a wrong code can't be narrowed down by timing.
    const match = supplied.length === stored.length && crypto.timingSafeEqual(supplied, stored);

    if (!match) {
      await conn.query('UPDATE otp_codes SET attempts = COALESCE(attempts,0) + 1 WHERE id=?', [row.id]);
      await conn.commit();
      const error = new Error('الرمز غير صحيح');
      error.statusCode = 400;
      throw error;
    }

    await conn.query('UPDATE otp_codes SET used=1 WHERE id=?', [row.id]);

    // A code with no user behind it is a signup. The account is created here,
    // inside the same transaction that consumes the code, so a verified number
    // and an account either both exist or neither does.
    let userId = row.user_id;
    let created = false;
    if (!userId) {
      userId = uuidv4();
      // No password is ever set: this account can only be entered by OTP. A
      // random hash is stored rather than NULL so nothing downstream can treat
      // an empty hash as "no password required".
      const lockedHash = crypto.randomBytes(32).toString('hex');
      await conn.query(
        `INSERT INTO users
           (id, tenant_id, email, phone, phone_verified_at, password_hash, name, role, is_active)
         VALUES (?,?, NULL, ?, NOW(), ?, ?, 'user', 1)`,
        [userId, tenantId, normalized, lockedHash, String(name || '').trim().slice(0, 200) || '']
      );
      created = true;
      logger.info('[wa-otp] created an account from a verified WhatsApp number');
    } else {
      await conn.query(
        'UPDATE users SET phone_verified_at = NOW() WHERE id=? AND tenant_id=?',
        [userId, tenantId]
      );
    }
    await conn.commit();
    return { userId, phone: normalized, created };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Work out the WhatsApp identity to store on a new account.
 *
 * Every path that creates a login has to do this now: WhatsApp is the way in, so
 * an account written without a phone cannot sign in at all — not by number
 * (there isn't one) and not by email (that path is off). Three of the four
 * account-creating paths were doing exactly that.
 *
 * Returns null when there is no usable number, which is a recoverable state:
 * staff can attach one later. Refusing the whole operation is not — it would
 * block creating the account at all.
 *
 * @returns {Promise<string|null>} the normalised number to store, or null
 */
async function claimWhatsAppIdentity(db, { tenantId, phone }) {
  const normalized = toIdentity(phone);
  if (!isPlausible(normalized)) return null;
  // users.phone is UNIQUE per tenant. A number already linked to someone else
  // (a family sharing a phone, a duplicate left by an old import) must not be
  // claimed here or the INSERT takes the whole registration down with it.
  const [taken] = await db.query(
    'SELECT id FROM users WHERE tenant_id=? AND phone=? LIMIT 1', [tenantId, normalized]
  );
  if (taken.length) {
    logger.warn('[identity] WhatsApp number already linked to another account — leaving this one without a number');
    return null;
  }
  return normalized;
}

module.exports = {
  claimWhatsAppIdentity,
  normalizeWhatsAppNumber,
  isPlausibleNumber,
  requestLoginCode,
  verifyLoginCode,
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
};
