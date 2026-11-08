#!/usr/bin/env node
'use strict';

/**
 * A month's fingerprint sheet into attendance, from the server's shell — the same reading and the same rules as HR's upload screen
 * (lib/attendanceSheet.js readDeviceSheet → lib/attendanceImport.js importAttendanceMonth). DRY RUN by default: it says what it would write.
 *
 *   node tools/import-attendance-sheet.cjs <sheet.xlsx|.csv|.dat> --month=2026-10 [--tenant=<id>]           # the report
 *   node tools/import-attendance-sheet.cjs <sheet> --month=2026-10 --apply [--tenant=<id>]                  # writes it
 *
 * What it never touches: a day HR entered or edited by hand (MANUAL_ENTRY) and a day of approved leave. What it writes: every other working
 * day of the month for each employee the sheet names or who has a device number — present, late or absent — replacing an earlier upload's
 * row and a night's automatic absence (AUTO_ABSENCE); and each weekly day off that was punched on, as overtime at the policy's rate.
 * --apply first saves the rows it is about to replace to ./attendance-before-<month>-<time>.json. Reads api/.env.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const APPLY = process.argv.includes('--apply');
const arg = name => (process.argv.find(value => value.startsWith(`--${name}=`)) || '').split('=')[1] || '';

async function main() {
  const file = process.argv.slice(2).find(value => !value.startsWith('--'));
  const month = arg('month');
  if (!file || !/^\d{4}-\d{2}$/.test(month)) {
    console.error('usage: node tools/import-attendance-sheet.cjs <sheet> --month=YYYY-MM [--apply] [--tenant=<id>]');
    process.exit(2);
  }
  const { pool } = require('../lib/db');
  const { readDeviceSheet } = require('../lib/attendanceSheet');
  const { importAttendanceMonth } = require('../lib/attendanceImport');
  const tenantId = arg('tenant') || process.env.DEFAULT_TENANT_ID || 'tenant-default';
  const sheet = readDeviceSheet(fs.readFileSync(path.resolve(file)), { filename: path.basename(file), month });
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${path.basename(file)} — ${sheet.punches.length} punches of ${month} (${sheet.rowsRead} rows read, ${sheet.skipped?.length ?? sheet.skipped ?? 0} skipped)`);

  const preview = await importAttendanceMonth(pool, { tenantId, month, punches: sheet.punches, filename: path.basename(file), dryRun: true });
  const [held] = await pool.query(
    `SELECT staff_id, DATE_FORMAT(date, '%Y-%m-%d') AS day, source, status, leave_id FROM attendance_logs
      WHERE tenant_id=? AND date BETWEEN ? AND LAST_DAY(?)`, [tenantId, `${month}-01`, `${month}-01`]);
  const heldBy = new Map(held.map(row => [`${row.staff_id}|${row.day}`, row]));
  let fresh = 0; let replaced = 0; let autoReplaced = 0; let overtime = 0; let saturdays = 0;
  for (const person of preview.days) {
    for (const day of person.days) {
      const row = heldBy.get(`${person.staffId}|${day.date}`);
      if (!row) fresh += 1; else if (row.source === 'AUTO_ABSENCE') autoReplaced += 1; else replaced += 1;
      if (day.overtimeDays > 0) overtime += 1;
      if (new Date(`${day.date}T12:00:00Z`).getUTCDay() === 6) saturdays += 1;
    }
  }
  const kept = held.filter(row => row.source === 'MANUAL_ENTRY' || row.leave_id).length;
  console.log(`employees: ${preview.employees.length} · new days ${fresh} (Saturdays among all days written: ${saturdays}) · replacing an earlier upload ${replaced} · replacing automatic absence ${autoReplaced} · Fridays worked (overtime) ${overtime}`);
  console.log(`kept as they are: ${kept} day(s) entered by hand or on approved leave`);
  for (const person of preview.employees) {
    console.log(`  ${person.biometricNo || '—'}\t${person.name}\tpresent ${person.present} · absent ${person.absent} · late days ${person.lateDays} · deduction ${person.deductionDays} · Fridays worked ${person.weekendWorked || 0}`);
  }
  if (preview.unmatched.length) {
    console.log(`device numbers in the sheet that match nobody: ${preview.unmatched.map(item => `${item.bioNo || item.name} (${item.punches})`).join(', ')}`);
  }
  if (!APPLY) { console.log('nothing was written. Re-run with --apply to write it.'); await pool.end(); return; }

  const before = held.filter(row => row.source !== 'MANUAL_ENTRY' && !row.leave_id);
  const [rows] = before.length ? await pool.query(
    `SELECT * FROM attendance_logs WHERE tenant_id=? AND date BETWEEN ? AND LAST_DAY(?) AND source <> 'MANUAL_ENTRY' AND leave_id IS NULL`,
    [tenantId, `${month}-01`, `${month}-01`]) : [[]];
  const backup = path.join(process.cwd(), `attendance-before-${month}-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(rows, null, 1));
  console.log(`rows it may replace saved to ${backup}`);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await importAttendanceMonth(conn, { tenantId, month, punches: sheet.punches, filename: path.basename(file), actorId: null });
    await conn.commit();
    console.log(`written: ${result.daysWritten} day(s), batch ${result.batchId}`);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); await pool.end(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });
