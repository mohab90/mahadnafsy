'use strict';

// A client's site account is their client record: the same number or the same (proven) e-mail is the same person (3 Nov 2026, «ارجوك اربط اي عميل بيدخل بنفس الايميل او نفس
// رقم التليفون اتوماتك … متخليش في عميل تسجيل دخول لوحده»). lib/subscriberIdentity.js links them the moment the account calls the site; this links them everywhere else —
// right after a client record is saved or an account is made, and once an hour for every tenant — so a person never sits in the system twice, as a client and as a login.
//
// The same two tiers as tools/link-site-accounts.cjs, which is how the ones that existed were linked by hand: (1) the account's number equals the client's, in whatever
// spelling; (2) the account's e-mail, once proven, equals the client's. Only against a client no LIVE account holds, and only when exactly one client matches. A name alone
// never links (anyone could sign up with a client's name and be given their courses and payments); that stays a decision of the staff (lib/siteAccountLink.js).

const logger = require('./logger');
const { matchingSpellings } = require('./phoneNumber');

const digitsOf = value => String(value || '').replace(/\D/g, '');

/**
 * Links what can be linked. `userIds` / `subscriberIds` narrow it to the accounts or clients just touched; with neither it covers the tenant.
 * @returns {Promise<{ number: number, email: number, contested: number }>}
 */
async function autoLinkAccounts(db, { tenantId, userIds = null, subscriberIds = null }) {
  const accountFilter = userIds ? ' AND u.id IN (?)' : '';
  const [accounts] = await db.query(
    `SELECT u.id, u.email, u.phone, u.email_unverified FROM users u
      WHERE u.tenant_id = ? AND u.is_active = 1${accountFilter}
        AND NOT EXISTS (SELECT 1 FROM subscribers s WHERE s.tenant_id = u.tenant_id AND s.firebase_uid = u.id AND s.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM staff st WHERE st.tenant_id = u.tenant_id AND st.deleted_at IS NULL AND st.email <> '' AND st.email = u.email)`,
    [tenantId, ...(userIds ? [userIds] : [])]);
  if (!accounts.length) return { number: 0, email: 0, contested: 0 };

  const emails = [...new Set(accounts.filter(a => Number(a.email_unverified) !== 1 && a.email).map(a => String(a.email).trim().toLowerCase()))];
  const spellings = [...new Set(accounts.filter(a => a.phone).flatMap(a => matchingSpellings(a.phone).map(digitsOf)).filter(Boolean))];
  if (!emails.length && !spellings.length) return { number: 0, email: 0, contested: 0 };

  const clientFilter = subscriberIds ? ' AND s.id IN (?)' : '';
  const matches = [];
  if (spellings.length) matches.push('s.phone_digits IN (?)');
  if (emails.length) matches.push('LOWER(TRIM(s.email)) IN (?)');
  const [clients] = await db.query(
    `SELECT s.id, s.email, s.phone, s.phone_digits FROM subscribers s
      WHERE s.tenant_id = ? AND s.deleted_at IS NULL${clientFilter}
        AND (s.firebase_uid IS NULL OR s.firebase_uid = '' OR NOT EXISTS (SELECT 1 FROM users lu WHERE lu.id = s.firebase_uid AND lu.tenant_id = s.tenant_id))
        AND (${matches.join(' OR ')})`,
    [tenantId, ...(subscriberIds ? [subscriberIds] : []), ...(spellings.length ? [spellings] : []), ...(emails.length ? [emails] : [])]);
  if (!clients.length) return { number: 0, email: 0, contested: 0 };

  const byDigits = new Map();
  const byEmail = new Map();
  for (const client of clients) {
    if (client.phone_digits) byDigits.set(client.phone_digits, [...(byDigits.get(client.phone_digits) || []), client]);
    const email = String(client.email || '').trim().toLowerCase();
    if (email) byEmail.set(email, [...(byEmail.get(email) || []), client]);
  }

  const taken = new Set();
  const done = { number: 0, email: 0, contested: 0 };
  for (const account of accounts) {
    const byNumber = account.phone
      ? [...new Map(matchingSpellings(account.phone).flatMap(value => byDigits.get(digitsOf(value)) || []).map(client => [client.id, client])).values()].filter(client => !taken.has(client.id))
      : [];
    const email = Number(account.email_unverified) === 1 ? '' : String(account.email || '').trim().toLowerCase();
    const byAddress = email ? (byEmail.get(email) || []).filter(client => !taken.has(client.id)) : [];
    const [tier, found] = byNumber.length === 1 ? ['number', byNumber] : byAddress.length === 1 ? ['email', byAddress] : [null, null];
    if (!tier) { if (byNumber.length > 1 || byAddress.length > 1) done.contested += 1; continue; }
    const client = found[0];
    const [result] = await db.query(
      // Fills the client's EMPTY e-mail / number from the account, so the desk sees them; nothing is merged or removed.
      `UPDATE subscribers SET firebase_uid = ?, email = COALESCE(NULLIF(email, ''), ?), phone = COALESCE(NULLIF(phone, ''), ?), updated_at = updated_at
        WHERE id = ? AND tenant_id = ?
          AND (firebase_uid IS NULL OR firebase_uid = '' OR NOT EXISTS (SELECT 1 FROM users lu WHERE lu.id = firebase_uid AND lu.tenant_id = subscribers.tenant_id))`,
      [account.id, Number(account.email_unverified) === 1 ? null : (account.email || null), account.phone || null, client.id, tenantId]);
    if (result.affectedRows) { taken.add(client.id); done[tier] += 1; }
  }
  if (done.number || done.email) logger.info('[auto-link-accounts]', { tenantId, ...done });
  return done;
}

module.exports = { autoLinkAccounts };
