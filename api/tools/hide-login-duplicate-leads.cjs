#!/usr/bin/env node
'use strict';

/**
 * «ليه أي عميل بيعمل تسجيل دخول السيستم بيحسبه كأنه عميل جديد وبيظهر كأنه مكرر» (2 Nov 2026). Until this release, a client the institute already had who signed in
 * for the first time was filed again as a new lead with the source «تسجيل دخول» (lib/registrationLead.js compared 1XXXXXXXXX with the 01XXXXXXXXX that
 * 7,114 of the 14,241 clients are stored under). On production that left roughly 290 such leads: a client who existed BEFORE the lead, by the number or the email.
 *
 *   node tools/hide-login-duplicate-leads.cjs            # the report: how many, a sample. Writes nothing.
 *   node tools/hide-login-duplicate-leads.cjs --apply    # hides them (leads.hidden = 1), after writing a JSON backup of the rows it changes
 *
 * Only a lead that is still «new» and visible, whose source is «تسجيل دخول», and whose client is older than the lead. Nothing is deleted: a hidden lead is
 * brought back with  UPDATE leads SET hidden=0 WHERE id IN (…)  from the ids in the backup. Reads the .env beside it.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { matchingSpellings } = require('../lib/phoneNumber');

const APPLY = process.argv.includes('--apply');
const TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-default';

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const [leads] = await db.query(
    `SELECT id, client_code, name, phone, email, created_at FROM leads
      WHERE tenant_id=? AND source='تسجيل دخول' AND status='new' AND (hidden IS NULL OR hidden=0)`, [TENANT]);
  const duplicates = [];
  for (const lead of leads) {
    const spellings = matchingSpellings(lead.phone).filter(Boolean);
    const email = String(lead.email || '').trim().toLowerCase();
    const terms = [];
    const params = [TENANT];
    if (spellings.length) { terms.push(`phone_digits IN (${spellings.map(() => '?').join(',')})`); params.push(...spellings); }
    if (email) { terms.push('LOWER(TRIM(email))=?'); params.push(email); }
    if (!terms.length) continue;
    const [[client]] = await db.query(
      `SELECT id, client_code, name, created_at FROM subscribers
        WHERE tenant_id=? AND deleted_at IS NULL AND (${terms.join(' OR ')}) AND created_at < ? ORDER BY created_at ASC LIMIT 1`,
      [...params, lead.created_at]);
    if (client) duplicates.push({ lead, client });
  }
  console.log(`sign-in leads still new: ${leads.length}; of them a client existed before the lead: ${duplicates.length}`);
  for (const { lead, client } of duplicates.slice(0, 8)) {
    console.log(`  lead ${String(lead.client_code || '').padEnd(10)} ${String(lead.name || '').slice(0, 22).padEnd(22)} ← client ${String(client.client_code || '').padEnd(10)} ${String(client.name || '').slice(0, 22)}`);
  }
  if (!APPLY) { console.log('\nreport only — nothing was written. Add --apply to hide them.'); await db.end(); return; }
  if (!duplicates.length) { await db.end(); return; }
  const backup = path.join(process.cwd(), `login-duplicate-leads-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(duplicates.map(({ lead, client }) => ({ lead_id: lead.id, client_id: client.id })), null, 1));
  let hidden = 0;
  for (const { lead } of duplicates) {
    const [result] = await db.query("UPDATE leads SET hidden=1 WHERE id=? AND tenant_id=? AND status='new' AND (hidden IS NULL OR hidden=0)", [lead.id, TENANT]);
    hidden += result.affectedRows;
  }
  console.log(`\nhidden: ${hidden} of ${duplicates.length}\nbackup (the ids; to bring them back: UPDATE leads SET hidden=0 WHERE id IN (…)): ${backup}`);
  await db.end();
})().catch(error => { console.error(error.message); process.exit(1); });
