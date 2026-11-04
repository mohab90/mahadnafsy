#!/usr/bin/env node
'use strict';

/**
 * «الغي كل المكافات اللي انت حطيتها احنا هنحطها مانيول» (4 Nov 2026): the system no longer writes booking or retention bonuses (lib/paymentCompensation.js,
 * AUTOMATIC_BONUSES). This withdraws the ones it had ALREADY written and that no payroll run has taken yet:
 *
 *   node tools/void-booking-bonuses.cjs            # the report: how many, how much, by month — nothing is written
 *   node tools/void-booking-bonuses.cjs --apply    # withdraw them
 *
 *   - sales and desk booking bonuses are crm_commissions rows with payment_id 'booking:…', still PENDING        -> CANCELLED
 *   - the lecturer's booking bonus and the retention bonus are instructor_fees rows with source_key 'booking:…' / 'retention:…',
 *     still pending or approved (not yet in a payroll run)                                                      -> rejected
 * A row a payroll run already took (INCLUDED_IN_PAYROLL / included_in_payroll / PAID / paid) is counted and left alone: change it by recalculating or correcting that run.
 *
 * --apply writes a JSON backup of every row's old status first (in the working directory) and changes each row only while it still has that status. Reads the .env beside it.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-default';
const NOTE = ' | سُحبت: المكافآت بتتسجل يدويًا';
const money = value => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [commissions] = await db.query(
    `SELECT id, staff_id, status, commission_amount, month, year FROM crm_commissions WHERE tenant_id = ? AND payment_id LIKE 'booking:%'`, [TENANT]);
  const [fees] = await db.query(
    `SELECT id, staff_id, status, total_amount, period_month AS month, period_year AS year, source_key FROM instructor_fees
      WHERE tenant_id = ? AND (source_key LIKE 'booking:%' OR source_key LIKE 'retention:%')`, [TENANT]);

  const open = {
    commission: commissions.filter(row => row.status === 'PENDING'),
    fee: fees.filter(row => row.status === 'pending' || row.status === 'approved'),
  };
  const taken = [...commissions.filter(row => row.status !== 'PENDING' && row.status !== 'CANCELLED'), ...fees.filter(row => !['pending', 'approved', 'rejected'].includes(row.status))];

  const byMonth = new Map();
  for (const row of open.commission) { const key = `${row.year}-${String(row.month).padStart(2, '0')}`; const entry = byMonth.get(key) || { rows: 0, amount: 0 }; entry.rows += 1; entry.amount += Number(row.commission_amount); byMonth.set(key, entry); }
  for (const row of open.fee) { const key = `${row.year}-${String(row.month).padStart(2, '0')}`; const entry = byMonth.get(key) || { rows: 0, amount: 0 }; entry.rows += 1; entry.amount += Number(row.total_amount); byMonth.set(key, entry); }

  console.log(`sales / desk booking bonuses (crm_commissions) .. ${commissions.length}   still PENDING: ${open.commission.length}`);
  console.log(`lecturer booking + retention bonuses (fees) ..... ${fees.length}   not in a payroll run yet: ${open.fee.length}`);
  console.log(`already taken by a payroll run (left alone) ..... ${taken.length}`);
  for (const [month, entry] of [...byMonth].sort()) console.log(`  ${month}   ${String(entry.rows).padStart(5)} rows   ${money(entry.amount).padStart(12)} EGP`);
  console.log(`\nthis run ${APPLY ? 'WITHDRAWS' : 'would withdraw'} ${open.commission.length + open.fee.length} row(s)`);

  if (!APPLY || !(open.commission.length + open.fee.length)) { await db.end(); return; }
  const backup = path.join(process.cwd(), `void-booking-bonuses-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify({ commissions: open.commission, fees: open.fee }, null, 1));
  console.log(`backup of the old rows: ${backup}`);
  let done = 0;
  for (const row of open.commission) {
    const [result] = await db.query(
      "UPDATE crm_commissions SET status = 'CANCELLED', note = CONCAT(COALESCE(note, ''), ?) WHERE id = ? AND tenant_id = ? AND status = 'PENDING'", [NOTE, row.id, TENANT]);
    done += result.affectedRows;
  }
  for (const row of open.fee) {
    const [result] = await db.query(
      "UPDATE instructor_fees SET status = 'rejected', note = CONCAT(COALESCE(note, ''), ?) WHERE id = ? AND tenant_id = ? AND status = ?", [NOTE, row.id, TENANT, row.status]);
    done += result.affectedRows;
  }
  console.log(`withdrawn: ${done} of ${open.commission.length + open.fee.length}`);
  await db.end();
})().catch(error => { console.error(error.message); process.exit(1); });
