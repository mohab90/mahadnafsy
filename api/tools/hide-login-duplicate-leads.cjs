#!/usr/bin/env node
'use strict';

/**
 * «مينفعش أبداً إيميل أو رقم تليفون يكون مكرر» (2 Nov 2026). A lead whose number or email is a client's we already have is a second record of the
 * same person — for a client who signs in for the first time it was filed again as a lead «تسجيل دخول» (lib/registrationLead.js compared
 * 1XXXXXXXXX with the 01XXXXXXXXX that half the clients are stored under), and for a lead who booked and paid the client was made and the lead
 * stayed, visible, under a rep or none.
 *
 *   node tools/hide-login-duplicate-leads.cjs            # the report: how many, a sample. Writes nothing.
 *   node tools/hide-login-duplicate-leads.cjs --apply    # hides them (leads.hidden = 1), after writing a JSON backup of the ids it changes
 *   node tools/hide-login-duplicate-leads.cjs --only-login-source   # only the leads whose source is «تسجيل دخول» (the narrow, first version)
 *
 * Only a lead that is visible and not already converted or won. Nothing is deleted and no status changes (a converted status credits a rep with a
 * sale in the reports): a hidden lead is brought back with  UPDATE leads SET hidden=0 WHERE id IN (…)  from the ids in the backup.
 * A lead with a rep working it (assigned) is listed apart in the report, and hidden too: the client's own record carries the rep.
 * Reads the .env beside it.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const ONLY_LOGIN = process.argv.includes('--only-login-source');
const TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-default';

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const base = `l.tenant_id=? AND (l.hidden IS NULL OR l.hidden=0) AND l.status NOT IN ('converted','won')${ONLY_LOGIN ? " AND l.source='تسجيل دخول'" : ''}`;
  // By the number in the three spellings it is stored under (leads hold 1XXXXXXXXX, clients 01XXXXXXXXX or 201XXXXXXXXX), then by the email.
  const queries = [
    `SELECT l.id, l.client_code, l.name, l.status, l.source, l.assigned_sales_name, l.created_at, s.client_code AS client_code_of, s.name AS client_name
       FROM leads l JOIN subscribers s ON s.tenant_id=l.tenant_id AND s.deleted_at IS NULL AND s.phone_digits = l.phone_digits
      WHERE ${base} AND l.phone_digits <> ''`,
    `SELECT l.id, l.client_code, l.name, l.status, l.source, l.assigned_sales_name, l.created_at, s.client_code AS client_code_of, s.name AS client_name
       FROM leads l JOIN subscribers s ON s.tenant_id=l.tenant_id AND s.deleted_at IS NULL AND s.phone_digits = CONCAT('0', l.phone_digits)
      WHERE ${base} AND l.phone_digits <> ''`,
    `SELECT l.id, l.client_code, l.name, l.status, l.source, l.assigned_sales_name, l.created_at, s.client_code AS client_code_of, s.name AS client_name
       FROM leads l JOIN subscribers s ON s.tenant_id=l.tenant_id AND s.deleted_at IS NULL AND s.phone_digits = CONCAT('20', l.phone_digits)
      WHERE ${base} AND l.phone_digits <> ''`,
    `SELECT l.id, l.client_code, l.name, l.status, l.source, l.assigned_sales_name, l.created_at, s.client_code AS client_code_of, s.name AS client_name
       FROM leads l JOIN subscribers s ON s.tenant_id=l.tenant_id AND s.deleted_at IS NULL AND s.email = l.email
      WHERE ${base} AND l.email IS NOT NULL AND l.email <> ''`,
  ];
  const found = new Map();
  for (const sql of queries) {
    const [rows] = await db.query(sql, [TENANT]);
    for (const row of rows) if (!found.has(row.id)) found.set(row.id, row);
  }
  const duplicates = [...found.values()];
  const bySource = new Map();
  for (const row of duplicates) bySource.set(row.source || '—', (bySource.get(row.source || '—') || 0) + 1);
  const worked = duplicates.filter(row => row.assigned_sales_name).length;
  console.log(`visible leads of a person who is already a client: ${duplicates.length} (with a rep: ${worked}, without: ${duplicates.length - worked})`);
  for (const [source, count] of [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(count).padStart(5)}  ${source}`);
  for (const row of duplicates.slice(0, 8)) {
    console.log(`  lead ${String(row.client_code || '').padEnd(10)} ${String(row.name || '').slice(0, 22).padEnd(22)} [${row.status}] ← client ${String(row.client_code_of || '').padEnd(10)} ${String(row.client_name || '').slice(0, 22)}`);
  }
  if (!APPLY) { console.log('\nreport only — nothing was written. Add --apply to hide them.'); await db.end(); return; }
  if (!duplicates.length) { await db.end(); return; }
  const backup = path.join(process.cwd(), `duplicate-leads-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(duplicates.map(row => ({ lead_id: row.id, status: row.status, client_code: row.client_code_of })), null, 1));
  let hidden = 0;
  for (const row of duplicates) {
    const [result] = await db.query("UPDATE leads SET hidden=1 WHERE id=? AND tenant_id=? AND (hidden IS NULL OR hidden=0) AND status NOT IN ('converted','won')", [row.id, TENANT]);
    hidden += result.affectedRows;
  }
  console.log(`\nhidden: ${hidden} of ${duplicates.length}\nbackup (the ids; to bring them back: UPDATE leads SET hidden=0 WHERE id IN (…)): ${backup}`);
  await db.end();
})().catch(error => { console.error(error.message); process.exit(1); });
