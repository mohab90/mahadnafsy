#!/usr/bin/env node
'use strict';

/**
 * Site accounts with no client record — «عملاء كتير بيظهر ليهم الموقع كأنهم مش مشتركين … بتعمل تسجيل دخول بيفتح كأنه حساب جديد … ويظهر على
 * السيستم كحساب مختلف (تسجيل دخول بالموقع)».
 *
 * A client who signs up on the site gets a `users` row. It is tied to the client record (subscribers.firebase_uid) by their number or
 * their email. Records imported from the sheets have a number and often no email, and a number stored with spaces or another country
 * prefix matched nobody, so the account stayed unlinked: the site showed an empty account and the admin search listed the sign-in as a
 * separate «تسجيل دخول بالموقع». The code now links such accounts at their next sign-in (lib/subscriberIdentity.js); this links the
 * ones that exist today, all at once.
 *
 *   node tools/link-site-accounts.cjs                      # the report; nothing is written
 *   node tools/link-site-accounts.cjs --apply              # link the sure ones: same number, or same (verified) email
 *   node tools/link-site-accounts.cjs --apply --include-name-match
 *                                                          # and the accounts whose NAME is the same as exactly one unlinked client
 *
 * Tiers, in order, each only against client records that no live account already holds:
 *   1. number   the account's number equals the client's number, whatever the spelling (subscribers.phone_digits)   — sure
 *   2. email    the account's email (proven, not pending) equals the client's email                                  — sure
 *   3. name     the same name after Arabic spelling is normalised, and exactly ONE such client, one such account  — a judgement:
 *               only with --include-name-match, and the report lists each pair for review
 * What is left, and the clients two accounts claim, are written to CSV files in the working directory.
 *
 * Linking sets subscribers.firebase_uid, and fills the client's EMPTY email/phone from the account so the desk sees them. Nothing is
 * merged or deleted. --apply writes a JSON backup of every client row it changes first, and each update only runs while the client is
 * still unlinked. Reads the .env beside it.
 */

const fs = require('fs');
const path = require('path');
const API_ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(API_ROOT, '.env') });
const mysql = require('mysql2/promise');
const { matchingSpellings } = require(path.join(API_ROOT, 'lib', 'phoneNumber.js'));
const { normalizeArabicName } = require(path.join(API_ROOT, 'lib', 'linkSiteAccounts.js'));

const APPLY = process.argv.includes('--apply');
const NAMES = process.argv.includes('--include-name-match');
const TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-default';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const csv = rows => rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  // Accounts nobody claims: no client holds them, and they are not staff.
  const [accounts] = await db.query(
    `SELECT u.id, u.name, u.email, u.phone, u.email_unverified, u.created_at
       FROM users u
      WHERE u.tenant_id = ? AND u.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM subscribers s WHERE s.tenant_id = u.tenant_id AND s.firebase_uid = u.id AND s.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM staff st WHERE st.tenant_id = u.tenant_id AND st.deleted_at IS NULL AND st.email <> '' AND st.email = u.email)`,
    [TENANT]);
  // Clients no live account holds.
  const [clients] = await db.query(
    `SELECT s.id, s.name, s.email, s.phone, s.phone_digits, s.client_code, s.firebase_uid
       FROM subscribers s
      WHERE s.tenant_id = ? AND s.deleted_at IS NULL
        AND (s.firebase_uid IS NULL OR s.firebase_uid = ''
             OR NOT EXISTS (SELECT 1 FROM users lu WHERE lu.id = s.firebase_uid AND lu.tenant_id = s.tenant_id))`, [TENANT]);

  const byDigits = new Map();
  const byEmail = new Map();
  const byName = new Map();
  for (const client of clients) {
    if (client.phone_digits) byDigits.set(client.phone_digits, [...(byDigits.get(client.phone_digits) || []), client]);
    const email = String(client.email || '').trim().toLowerCase();
    if (email) byEmail.set(email, [...(byEmail.get(email) || []), client]);
    const name = normalizeArabicName(client.name);
    if (name) byName.set(name, [...(byName.get(name) || []), client]);
  }
  const accountsByName = new Map();
  for (const account of accounts) {
    const name = normalizeArabicName(account.name);
    if (name) accountsByName.set(name, [...(accountsByName.get(name) || []), account]);
  }

  const taken = new Set();
  const links = { number: [], email: [], name: [] };
  const unresolved = [];
  const contested = [];
  const claim = (tier, account, client) => { taken.add(client.id); links[tier].push({ account, client }); };

  for (const account of accounts) {
    const digitMatches = account.phone ? [...new Map(matchingSpellings(account.phone).flatMap(value => byDigits.get(String(value).replace(/\D/g, '')) || []).map(c => [c.id, c])).values()].filter(c => !taken.has(c.id)) : [];
    if (digitMatches.length === 1) { claim('number', account, digitMatches[0]); continue; }
    const email = Number(account.email_unverified) === 1 ? '' : String(account.email || '').trim().toLowerCase();
    const emailMatches = email ? (byEmail.get(email) || []).filter(c => !taken.has(c.id)) : [];
    if (emailMatches.length === 1) { claim('email', account, emailMatches[0]); continue; }
    const name = normalizeArabicName(account.name);
    const nameMatches = name ? (byName.get(name) || []).filter(c => !taken.has(c.id)) : [];
    if (nameMatches.length === 1 && (accountsByName.get(name) || []).length === 1) {
      if (NAMES) claim('name', account, nameMatches[0]);
      else links.name.push({ account, client: nameMatches[0], pending: true });
      continue;
    }
    if (digitMatches.length > 1 || emailMatches.length > 1) contested.push({ account, matches: digitMatches.length > 1 ? digitMatches : emailMatches });
    else unresolved.push(account);
  }

  const sure = links.number.length + links.email.length;
  const named = links.name.filter(link => !link.pending).length;
  console.log(`accounts with no client record ....... ${accounts.length}`);
  console.log(`clients no live account holds ........ ${clients.length}`);
  console.log(`  1. same number ..................... ${links.number.length}`);
  console.log(`  2. same proven email ............... ${links.email.length}`);
  console.log(`  3. same name, exactly one client ... ${links.name.length}${NAMES ? ' (will be linked)' : ' (listed only: add --include-name-match)'}`);
  console.log(`  several clients match ............. ${contested.length}`);
  console.log(`  nothing matches ................... ${unresolved.length}`);
  for (const [label, list] of [['number', links.number], ['email', links.email], ['name', links.name]]) {
    if (!list.length) continue;
    console.log(`\n  first ${label} links:`);
    for (const { account, client } of list.slice(0, 6)) console.log(`    ${String(account.name || '').slice(0, 22).padEnd(22)} ${String(account.email || account.phone || '').padEnd(30)} -> ${client.client_code || ''} ${String(client.name || '').slice(0, 22)} ${client.phone || ''}`);
  }

  fs.writeFileSync(`unlinked-accounts-${stamp}.csv`, `﻿${csv([['account_id', 'name', 'email', 'phone', 'created_at'], ...unresolved.map(a => [a.id, a.name, a.email, a.phone, a.created_at])])}`);
  fs.writeFileSync(`name-match-review-${stamp}.csv`, `﻿${csv([['account_id', 'account_name', 'account_email', 'account_phone', 'client_code', 'client_name', 'client_phone'], ...links.name.map(({ account, client }) => [account.id, account.name, account.email, account.phone, client.client_code, client.name, client.phone])])}`);
  fs.writeFileSync(`contested-${stamp}.csv`, `﻿${csv([['account_id', 'account_name', 'candidates'], ...contested.map(({ account, matches }) => [account.id, account.name, matches.map(c => `${c.client_code}:${c.phone}`).join(' | ')])])}`);
  console.log(`\nwritten here: unlinked-accounts-${stamp}.csv, name-match-review-${stamp}.csv, contested-${stamp}.csv`);

  const toLink = [...links.number, ...links.email, ...links.name.filter(link => !link.pending)];
  console.log(`\nthis run ${APPLY ? 'LINKS' : 'would link'} ${toLink.length} client(s)` + (NAMES ? ` (${named} by name)` : ` (${sure} sure)`));
  if (!APPLY || !toLink.length) { await db.end(); return; }

  const backup = `link-site-accounts-backup-${stamp}.json`;
  fs.writeFileSync(backup, JSON.stringify(toLink.map(({ client }) => ({ id: client.id, firebase_uid: client.firebase_uid || null, email: client.email || null, phone: client.phone || null })), null, 1));
  console.log(`backup of the client rows: ${backup}`);
  let written = 0;
  for (const { account, client } of toLink) {
    const [result] = await db.query(
      `UPDATE subscribers
          SET firebase_uid = ?,
              email = COALESCE(NULLIF(email, ''), ?),
              phone = COALESCE(NULLIF(phone, ''), ?),
              updated_at = updated_at
        WHERE id = ? AND tenant_id = ?
          AND (firebase_uid IS NULL OR firebase_uid = ''
               OR NOT EXISTS (SELECT 1 FROM users lu WHERE lu.id = firebase_uid AND lu.tenant_id = subscribers.tenant_id))`,
      [account.id, Number(account.email_unverified) === 1 ? null : (account.email || null), account.phone || null, client.id, TENANT]);
    written += result.affectedRows;
  }
  console.log(`linked: ${written} of ${toLink.length}`);
  await db.end();
})().catch(error => { console.error(error.message); process.exit(1); });
