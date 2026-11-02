#!/usr/bin/env node
'use strict';

/**
 * «ليه في عملاء كتير حصلهم وقف؟» (2 Nov 2026). On production 460 of the 465 clients in the «متوقف» tab were put there by the data
 * distributions of 21 Oct (online old data) and 28-29 Oct (Dokki): a client of 2023-24 (online) or 2024 (Dokki) whose remaining balance is 100 EGP or
 * more was filed as paused, with the reason «عليه متبقي X جنيه — توزيع …» written beside it (transferAnswers.pauseReason). It is a label
 * for the team, not a lock: the client's access is the enrollments', and subscribers.is_active is 1 for all but one of them.
 *
 *   node tools/restore-paused-clients.cjs                          # the report: who, from which batch, how much they owe. Writes nothing.
 *   node tools/restore-paused-clients.cjs --apply                  # clientStatus «paused» -> «active» for every one with that reason
 *   node tools/restore-paused-clients.cjs --apply --source="داتا الدقي 30-9-2026"   # only one source
 *   node tools/restore-paused-clients.cjs --apply --branch=DAQQI                     # only one branch
 *
 * Only a client whose clientStatus is still «paused» and whose reason is the distribution's is touched (a client a person paused by hand, with no
 * such reason, stays). --apply writes a JSON backup of every changed row's old crm_json first and updates each row only while it is still what
 * was read. The «pauseReason» note is removed with the pause. Reads the .env beside it.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const arg = name => (process.argv.find(item => item.startsWith(`--${name}=`)) || '').slice(name.length + 3) || null;
const SOURCE = arg('source');
const BRANCH = arg('branch');
const TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-default';

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const where = ["tenant_id=?", 'deleted_at IS NULL', "JSON_VALID(crm_json)", "JSON_UNQUOTE(JSON_EXTRACT(crm_json,'$.clientStatus'))='paused'",
    "JSON_UNQUOTE(JSON_EXTRACT(crm_json,'$.transferAnswers.pauseReason')) LIKE 'عليه متبقي%'"];
  const params = [TENANT];
  if (SOURCE) { where.push('source=?'); params.push(SOURCE); }
  if (BRANCH) { where.push('branch=?'); params.push(BRANCH); }
  const [rows] = await db.query(`SELECT id, name, branch, source, crm_json, DATE(updated_at) AS day FROM subscribers WHERE ${where.join(' AND ')}`, params);
  const [[all]] = await db.query("SELECT COUNT(*) AS n FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL AND JSON_VALID(crm_json) AND JSON_UNQUOTE(JSON_EXTRACT(crm_json,'$.clientStatus'))='paused'", [TENANT]);

  const byBatch = new Map();
  let owed = 0;
  for (const row of rows) {
    const reason = String(JSON.parse(row.crm_json)?.transferAnswers?.pauseReason || '');
    const amount = Number((reason.match(/متبقي\s+(\d+)/) || [])[1]) || 0;
    owed += amount;
    const key = `${row.source || '—'} · ${row.branch} · ${new Date(row.day).toISOString().slice(0, 10)}`;
    const cell = byBatch.get(key) || { n: 0, owed: 0 };
    cell.n += 1; cell.owed += amount;
    byBatch.set(key, cell);
  }
  console.log(`paused clients in all: ${all.n}; paused by a distribution («عليه متبقي»): ${rows.length}; what they owe in all: ${owed.toLocaleString('en')} EGP`);
  for (const [key, cell] of [...byBatch.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${String(cell.n).padStart(4)}  owe ${String(cell.owed).padStart(9)}  ${key}`);
  if (!APPLY) { console.log('\nreport only — nothing was written. Add --apply to put them back to «active».'); await db.end(); return; }

  const backup = path.join(process.cwd(), `restore-paused-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(rows.map(row => ({ id: row.id, crm_json: row.crm_json })), null, 1));
  let changed = 0;
  let skipped = 0;
  for (const row of rows) {
    const [result] = await db.query(
      `UPDATE subscribers SET crm_json=JSON_REMOVE(JSON_SET(crm_json,'$.clientStatus','active'),'$.transferAnswers.pauseReason'), updated_at=NOW()
        WHERE id=? AND tenant_id=? AND crm_json=?`, [row.id, TENANT, row.crm_json]);
    if (result.affectedRows) changed += 1; else skipped += 1;
  }
  console.log(`\nput back to active: ${changed}; changed meanwhile and left alone: ${skipped}\nbackup of the old rows: ${backup}`);
  await db.end();
})().catch(error => { console.error(error.message); process.exit(1); });
