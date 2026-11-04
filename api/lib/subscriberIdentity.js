'use strict';
/**
 * Resolve "which subscriber is the signed-in client?" — one way, everywhere.
 *
 * Every /api/me/* route needs this, and until now each one open-coded it as
 *   SELECT id FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email))=?
 * That was correct while email was the only way to sign in. It is not correct
 * now: a client who signs in with a WhatsApp number and whose subscriber record
 * has no email gets `users.email = NULL`, so the token carries no email, so the
 * lookup matches nothing and the client sees an empty account — no courses, no
 * progress, no certificates — while their data sits untouched in the database.
 *
 * Resolution order, cheapest and most reliable first:
 *   1. subscribers.firebase_uid = users.id   (UNIQUE (tenant_id, firebase_uid)); a record with no course on it gives way to another of the same person that holds them
 *   2. email, only when the account actually has one
 *   3. the WhatsApp number, matched against the spellings a phone is stored in
 *
 * Steps 2 and 3 write the link back to firebase_uid on success, so a given
 * client falls through the fallbacks exactly once and every later request is a
 * single indexed hit.
 */
const { pool } = require('./db');
const logger = require('./logger');
const { toIdentity, matchingSpellings } = require('./phoneNumber');

/**
 * The literal spellings the same Egyptian number is stored in across imports,
 * signup forms and staff entry. Compared with `IN (...)` — an indexed equality —
 * rather than REGEXP_REPLACE(s.phone,...), which would turn every single
 * /api/me/* request into a full scan of subscribers.
 */
function phoneVariants(normalized) {
  if (!/^\d{9,15}$/.test(String(normalized || ''))) return [];
  const local = String(normalized);
  return [...new Set([
    local,
    `0${local}`,
    `20${local}`,
    `+20${local}`,
    `0020${local}`,
    `002${local}`,
    `+${local}`,
  ])];
}

/**
 * @returns {Promise<string|null>} the subscriber id for the caller, or null when
 *          the signed-in account has no subscriber record at all.
 */
async function resolveSubscriberId(req, db = pool) {
  const row = await resolveSubscriberRow(req, ['id'], db);
  return row?.id || null;
}

/**
 * Same resolution, but returns the columns the caller asks for so a route does
 * not have to issue a second query for the name/phone it also needs.
 * @param {string[]} columns unqualified subscriber column names
 */
async function resolveSubscriberRow(req, columns = ['id'], db = pool) {
  const tenantId = req.tenantId;
  const uid = req.user?.uid || null;
  if (!tenantId || !uid) return null;

  // `id` is always selected: the link-back below needs it even when the caller
  // did not ask for it.
  const wanted = [...new Set(['id', ...columns])];
  const select = wanted.map(c => `s.\`${c}\``).join(', ');

  // 1. Already linked — the steady state.
  const [[linked]] = await db.query(
    `SELECT ${select} FROM subscribers s
      WHERE s.tenant_id=? AND s.firebase_uid=? AND s.deleted_at IS NULL LIMIT 1`,
    [tenantId, uid]
  );
  // A login tied to a record with no course on it, while another record of the same person (the same number or proven e-mail) holds the courses, is
  // the client who sees «لم تنضم بعد إلى أي كورس» on an account the desk shows full (4 Nov 2026). The login moves to the record that holds them.
  if (linked && await holdsCourses(db, tenantId, linked.id)) return linked;

  // The token is not a trustworthy source for the phone (it carries only uid and
  // email), so read the account's own identity columns.
  const [[account]] = await db.query(
    'SELECT email, phone, email_unverified FROM users WHERE id=? AND tenant_id=? LIMIT 1',
    [uid, tenantId]
  );
  // An address given at sign-up and not proven yet matches nobody
  // (lib/emailVerification.js): typing a client's email must not make you them.
  const email = Number(account?.email_unverified) === 1
    ? ''
    : String(account?.email || req.user?.email || '').trim().toLowerCase();
  const variants = phoneVariants(account?.phone);
  const digitSpellings = account?.phone ? matchingSpellings(account.phone).map(value => String(value).replace(/D/g, '')).filter(Boolean) : [];
  const spellings = [...new Set([...digitSpellings, ...variants.map(value => value.replace(/D/g, ''))])];

  // The NUMBER never takes a client already linked to another LIVE account (a number typed at sign-up proves nothing). The e-mail does: it reaches this point
  // only once proven (an unproven one is '' above), it is unique per account, and it is the address on the record — so a client who also signs in another way
  // (a WhatsApp number, an older account) is the same person on both logins and sees the same courses (4 Nov 2026: the second login saw «لم تنضم بعد»).
  // Among the candidates, the record that holds courses first, then the newest.
  const free = `(s.firebase_uid IS NULL OR s.firebase_uid = '' OR s.firebase_uid = ?
               OR NOT EXISTS (SELECT 1 FROM users lu WHERE lu.id = s.firebase_uid AND lu.tenant_id = s.tenant_id))`;
  const heldFirst = `(EXISTS (SELECT 1 FROM enrollments en WHERE en.tenant_id = s.tenant_id AND en.subscriber_id = s.id AND en.status = 'active')) DESC`;
  const find = async (onlyHolders) => {
    const holding = onlyHolders ? ` AND EXISTS (SELECT 1 FROM enrollments en WHERE en.tenant_id = s.tenant_id AND en.subscriber_id = s.id AND en.status = 'active')` : '';
    // 2. Email — skipped entirely when empty, because `LOWER(TRIM(email))=''` would be a wildcard across every subscriber stored with a blank email.
    if (email) {
      const [[byEmail]] = await db.query(
        `SELECT ${select} FROM subscribers s
          WHERE s.tenant_id=? AND s.email=? AND s.deleted_at IS NULL${holding}
          ORDER BY ${heldFirst}, s.created_at DESC LIMIT 1`,
        [tenantId, email]
      );
      if (byEmail) return byEmail;
    }
    // 3. WhatsApp number — by the digits, so a number stored with spaces, dashes, a + or another country prefix is still the same number
    // (subscribers.phone_digits, migration 352).
    if (spellings.length) {
      const [[byPhone]] = await db.query(
        `SELECT ${select} FROM subscribers s
          WHERE s.tenant_id=? AND s.phone_digits IN (${spellings.map(() => '?').join(',')}) AND s.deleted_at IS NULL AND ${free}${holding}
          ORDER BY ${heldFirst}, s.created_at DESC LIMIT 1`,
        [tenantId, ...spellings, uid]
      );
      if (byPhone) return byPhone;
    }
    return null;
  };

  if (linked) {
    const holder = await find(true);
    if (!holder || holder.id === linked.id) return linked;
    // Held by another login already: the two logins share it, nothing is moved.
    const [[available]] = await db.query(`SELECT 1 AS ok FROM subscribers s WHERE s.id=? AND s.tenant_id=? AND s.deleted_at IS NULL AND ${free}`, [holder.id, tenantId, uid]);
    if (!available) return holder;
    // Free the old record first (UNIQUE (tenant_id, firebase_uid)), then take the new one; if that fails the old link is put back.
    await db.query('UPDATE subscribers SET firebase_uid=NULL, updated_at=updated_at WHERE id=? AND tenant_id=? AND firebase_uid=?', [linked.id, tenantId, uid]);
    try {
      const [moved] = await db.query(
        `UPDATE subscribers SET firebase_uid=?, updated_at=updated_at
          WHERE id=? AND tenant_id=?
            AND (firebase_uid IS NULL OR firebase_uid = '' OR NOT EXISTS (SELECT 1 FROM users lu WHERE lu.id = subscribers.firebase_uid AND lu.tenant_id = subscribers.tenant_id))`,
        [uid, holder.id, tenantId]);
      if (!moved?.affectedRows) throw new Error('record taken meanwhile');
    } catch (error) {
      await db.query('UPDATE subscribers SET firebase_uid=?, updated_at=updated_at WHERE id=? AND tenant_id=? AND firebase_uid IS NULL', [uid, linked.id, tenantId]).catch(() => {});
      logger.warn('[subscriber-identity] move to the record holding the courses failed:', error.message);
      return linked;
    }
    logger.info('[subscriber-identity] login moved to the record that holds the courses', { tenantId, from: linked.id, to: holder.id });
    return holder;
  }

  const found = await find(false);
  if (!found) return null;

  // Link it so the next request takes path 1. UNIQUE (tenant_id, firebase_uid)
  // means a concurrent request racing us here loses harmlessly; the row it
  // already read is the same row. `updated_at = updated_at` keeps this internal
  // repair from looking like a client edit to anything watching that column.
  db.query(
    `UPDATE subscribers SET firebase_uid=?, updated_at=updated_at
      WHERE id=? AND tenant_id=?
        AND (firebase_uid IS NULL OR firebase_uid = ''
             OR NOT EXISTS (SELECT 1 FROM users lu WHERE lu.id = subscribers.firebase_uid AND lu.tenant_id = subscribers.tenant_id))`,
    [uid, found.id, tenantId]
  ).catch(e => logger.warn('[subscriber-identity] link-back failed:', e.message));

  return found;
}

/** True when the client record has at least one active enrollment. */
async function holdsCourses(db, tenantId, subscriberId) {
  const [[row]] = await db.query(
    "SELECT 1 AS held FROM enrollments WHERE tenant_id=? AND subscriber_id=? AND status='active' LIMIT 1", [tenantId, subscriberId]);
  return Boolean(row);
}

/**
 * Which of these phone identities (lib/phoneNumber.js toIdentity) belong to a
 * client on the system — an event's registrations, to put the institute's own
 * students first.
 */
async function clientPhoneIdentities(tenantId, identities, db = pool) {
  const wanted = new Set((identities || []).filter(Boolean));
  if (!wanted.size) return new Set();
  const [rows] = await db.query(
    'SELECT phone FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL AND phone IS NOT NULL', [tenantId]);
  return new Set(rows.map(row => toIdentity(row.phone)).filter(identity => wanted.has(identity)));
}

module.exports = { clientPhoneIdentities, resolveSubscriberId, resolveSubscriberRow, phoneVariants };
