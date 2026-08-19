'use strict';

/**
 * One way to find the lead behind a customer's contact details.
 *
 * Four places needed this — subscriber save, the Paymob callback's fallback
 * path, its deal-value sync, and lib/leadDealValue.js — and all four carried the
 * same copy of the same query, with the same two defects:
 *
 *   1. The phone was matched with `LIKE '%' + last 9 digits`. A trailing
 *      wildcard does not mean "this number", it means "ends with these digits",
 *      and it will happily return a different customer's lead. What these
 *      callers then do with the result is write a paid total onto it, or mark it
 *      converted — so matching the wrong lead moves one customer's money and
 *      pipeline status onto another customer's record.
 *
 *   2. The email was passed as `email || ''`, so a customer with no email
 *      searched for `email = ''` and matched any lead stored with a blank one.
 *      With `ORDER BY created_at DESC` that resolved to whichever such lead was
 *      newest — an arbitrary stranger.
 *
 * Each also normalised the phone by hand, a third spelling of the rule that
 * lib/phoneNumber.js exists to own.
 *
 * Both terms are exact here, and a term is only included when there is a real
 * value behind it. No value on either side means no match, which is the honest
 * answer — the callers all treat null as "leave it unlinked".
 */

const { identitySpellings } = require('./phoneNumber');

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'tenant-default';

/**
 * @param {{query: Function}} db  pool or an open connection (so callers inside a
 *   transaction stay inside it)
 * @param {{tenantId?: string, phone?: string, email?: string}} contact
 * @returns {Promise<{id: string, status: string}|null>}
 */
async function findLeadByContact(db, { tenantId, phone, email } = {}) {
  const spellings = identitySpellings(phone);
  const cleanEmail = String(email || '').trim();

  const match = [];
  const params = [];
  if (spellings.length) {
    match.push(`REGEXP_REPLACE(phone,'[^0-9]','') IN (${spellings.map(() => '?').join(',')})`);
    params.push(...spellings);
  }
  if (cleanEmail) {
    match.push('email = ?');
    params.push(cleanEmail);
  }
  if (!match.length) return null;

  // Mirrors appendTenantScope: rows written before tenanting existed carry a
  // NULL or empty tenant_id and belong to the default tenant. Narrowing that
  // here would orphan them from every caller at once.
  const effectiveTenantId = tenantId || DEFAULT_TENANT_ID;
  const tenantClause = effectiveTenantId === DEFAULT_TENANT_ID
    ? "(tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')"
    : 'tenant_id = ?';

  const [[row]] = await db.query(
    `SELECT id, status FROM leads
      WHERE ${tenantClause} AND (${match.join(' OR ')}) AND hidden=0
      ORDER BY created_at DESC LIMIT 1`,
    [effectiveTenantId, ...params]
  );
  return row || null;
}

/**
 * A WHERE fragment that means "this column holds this exact number".
 *
 * For the dedup lookups that decide whether an incoming submission is an
 * existing customer. Those compared `RIGHT(digits,10) = RIGHT(?,10)`, which is
 * only safe while every number is a 10-digit Egyptian national one. It is not:
 * the institute sells through ONLINE_SAUDI and ONLINE_ABROAD branches, and
 * truncating a foreign identity to its last 10 digits makes genuinely different
 * numbers equal — Egyptian 201012345678 and UK 441012345678 both reduce to
 * 1012345678. Two unrelated people then dedup onto one lead, and the second one
 * inherits the first one's id, client_code and sales assignment.
 *
 * Returns null when there is no usable number, so callers can skip the term
 * rather than match everything.
 *
 * @returns {{sql: string, params: string[]}|null}
 */
function phoneIdentityClause(phone, column = 'phone') {
  const spellings = identitySpellings(phone);
  if (!spellings.length) return null;
  return {
    sql: `REGEXP_REPLACE(${column},'[^0-9]','') IN (${spellings.map(() => '?').join(',')})`,
    params: spellings,
  };
}

module.exports = { findLeadByContact, phoneIdentityClause, DEFAULT_TENANT_ID };
