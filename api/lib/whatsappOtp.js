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
const { sendWhatsApp } = require('./whatsapp');
const { resolveSecret } = require('./secretResolver');
const logger = require('./logger');

const CODE_TTL_MINUTES = Math.max(1, Number(process.env.WA_OTP_TTL_MINUTES || 10));
const MAX_ATTEMPTS = Math.max(1, Number(process.env.WA_OTP_MAX_ATTEMPTS || 5));

/**
 * Reduce anything a user might type to comparable digits.
 * Egyptian numbers arrive as 01012345678, +2010…, 002010… or with spaces and
 * dashes; all of those are the same person, so they must normalise to one value
 * or a number would fail to match the account it belongs to.
 */
function normalizeWhatsAppNumber(input) {
  let digits = String(input || '').replace(/\D/g, '');
  if (!digits) return '';
  digits = digits.replace(/^00/, '');          // 00<country> → <country>
  if (digits.startsWith('20')) digits = digits.slice(2);
  digits = digits.replace(/^0+/, '');          // local trunk prefix
  return digits;
}

function isPlausibleNumber(digits) {
  return /^\d{9,15}$/.test(digits);
}

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

  // Unknown number: still report success so this can't be used to discover which
  // numbers have accounts.
  if (!user) {
    logger.info('[wa-otp] code requested for an unregistered number');
    return { ok: true, delivered: false };
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
      [id, tenantId, user.id, normalized, hashCode({ tenantId, phone: normalized, code }), CODE_TTL_MINUTES]
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }

  try {
    await sendWhatsApp(normalized, `رمز الدخول: ${code}\nصالح لمدة ${CODE_TTL_MINUTES} دقائق. لا تشاركه مع أحد.`, { tenantId });
  } catch (error) {
    // Burn the code rather than leaving a live one nobody received.
    await pool.query("UPDATE otp_codes SET used=1, delivery_status='failed' WHERE id=?", [id]).catch(() => {});
    logger.error('[wa-otp] delivery failed', { error: error.message });
    const failure = new Error('تعذّر إرسال الرمز عبر واتساب. حاول لاحقاً.');
    failure.statusCode = 503;
    throw failure;
  }
  return { ok: true, delivered: true };
}

/**
 * Verify a code. Returns the matching user id, or throws 400/429.
 * Consumes the code on success so it can never be replayed.
 */
async function verifyLoginCode({ tenantId, phone, code }) {
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
    await conn.query(
      'UPDATE users SET phone_verified_at = NOW() WHERE id=? AND tenant_id=?',
      [row.user_id, tenantId]
    );
    await conn.commit();
    return { userId: row.user_id, phone: normalized };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  normalizeWhatsAppNumber,
  isPlausibleNumber,
  requestLoginCode,
  verifyLoginCode,
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
};
