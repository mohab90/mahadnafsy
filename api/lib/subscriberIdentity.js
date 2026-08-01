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
 *   1. subscribers.firebase_uid = users.id   (UNIQUE (tenant_id, firebase_uid))
 *   2. email, only when the account actually has one
 *   3. the WhatsApp number, matched against the spellings a phone is stored in
 *
 * Steps 2 and 3 write the link back to firebase_uid on success, so a given
 * client falls through the fallbacks exactly once and every later request is a
 * single indexed hit.
 */
const { pool } = require('./db');
const logger = require('./logger');

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
  if (linked) return linked;

  // The token is not a trustworthy source for the phone (it carries only uid and
  // email), so read the account's own identity columns.
  const [[account]] = await db.query(
    'SELECT email, phone FROM users WHERE id=? AND tenant_id=? LIMIT 1',
    [uid, tenantId]
  );
  const email = String(account?.email || req.user?.email || '').trim().toLowerCase();
  const variants = phoneVariants(account?.phone);

  // 2. Email — skipped entirely when empty, because `LOWER(TRIM(email))=''`
  // would be a wildcard across every subscriber stored with a blank email.
  let found = null;
  if (email) {
    const [[byEmail]] = await db.query(
      `SELECT ${select} FROM subscribers s
        WHERE s.tenant_id=? AND LOWER(TRIM(s.email))=? AND s.deleted_at IS NULL
        ORDER BY s.created_at DESC LIMIT 1`,
      [tenantId, email]
    );
    found = byEmail || null;
  }

  // 3. WhatsApp number.
  if (!found && variants.length) {
    const placeholders = variants.map(() => '?').join(',');
    const [[byPhone]] = await db.query(
      `SELECT ${select} FROM subscribers s
        WHERE s.tenant_id=? AND s.phone IN (${placeholders}) AND s.deleted_at IS NULL
        ORDER BY s.created_at DESC LIMIT 1`,
      [tenantId, ...variants]
    );
    found = byPhone || null;
  }

  if (!found) return null;

  // Link it so the next request takes path 1. UNIQUE (tenant_id, firebase_uid)
  // means a concurrent request racing us here loses harmlessly; the row it
  // already read is the same row. `updated_at = updated_at` keeps this internal
  // repair from looking like a client edit to anything watching that column.
  db.query(
    `UPDATE subscribers SET firebase_uid=?, updated_at=updated_at
      WHERE id=? AND tenant_id=? AND firebase_uid IS NULL`,
    [uid, found.id, tenantId]
  ).catch(e => logger.warn('[subscriber-identity] link-back failed:', e.message));

  return found;
}

module.exports = { resolveSubscriberId, resolveSubscriberRow, phoneVariants };
