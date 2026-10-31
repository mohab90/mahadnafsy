#!/usr/bin/env node
'use strict';

/**
 * «اي عميل اعمله سنه صلاحيه الكورسات من تاريخ اشتراكه» (31 Oct 2026): a year of access from the subscription day, for the enrollments that
 * already exist. New subscriptions get it from the code (lib/entitlements.js DEFAULT_ACCESS_MONTHS); this converts what is there.
 *
 *   node tools/set-year-access.cjs                       # the report: nothing is written
 *   node tools/set-year-access.cjs --apply               # extend the ones that expire earlier than a year from their subscription day
 *   node tools/set-year-access.cjs --apply --include-open-ended
 *                                                        # and give the ones with NO expiry a year from their subscription day
 *   node tools/set-year-access.cjs --apply --reinstate-revoked-by="<who>"
 *                                                        # and re-open the enrollments THAT actor revoked, while their year is still ahead
 *
 * The expiry becomes enrolled_at + the course's own months (courses.access_months) or 12; an expiry that is already LATER is never
 * shortened (an admin's extension stands). Only enrollments with status 'active' are touched.
 *
 * READ THE REPORT BEFORE --include-open-ended. An enrollment with no expiry whose subscription day is more than a year ago has a "year from
 * subscription" that is already in the past: converting it ends that client's access at once. The report counts them, and lists the first
 * ones. The default leaves them open.
 *
 * --apply writes a JSON backup of every changed row's old expiry first (next to this tool's working directory) and updates each row only
 * while its expiry is still what was read, so a run cannot overwrite a change made meanwhile. Reads the .env beside it.
 */

const fs = require('fs');
const path = require('path');
const API_ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(API_ROOT, '.env') });
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const INCLUDE_OPEN = process.argv.includes('--include-open-ended');
const REINSTATE_BY = (process.argv.find(arg => arg.startsWith('--reinstate-revoked-by=')) || '').slice('--reinstate-revoked-by='.length) || null;
const DEFAULT_MONTHS = 12;
const TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-default';

const day = value => (value ? new Date(value).toISOString().slice(0, 10) : '—');
const addMonths = (value, months) => {
  const date = new Date(value);
  const targetMonth = date.getUTCMonth() + months;
  const result = new Date(Date.UTC(date.getUTCFullYear(), targetMonth, 1, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return result;
};

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: false, timezone: 'Z',
  });
  const [rows] = await db.query(
    `SELECT e.id, e.subscriber_id, e.course_id, e.enrolled_at, e.expiry_date, c.access_months, s.name, s.client_code
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id AND c.tenant_id = e.tenant_id
       LEFT JOIN subscribers s ON s.id = e.subscriber_id AND s.tenant_id = e.tenant_id
      WHERE e.tenant_id = ? AND e.status = 'active' AND e.enrolled_at IS NOT NULL`, [TENANT]);
  const now = Date.now();
  const groups = { already: [], extend: [], longer: [], openEnded: [], openEndedLapsed: [] };
  const changes = [];
  for (const row of rows) {
    const months = Number(row.access_months) > 0 ? Number(row.access_months) : DEFAULT_MONTHS;
    const target = addMonths(row.enrolled_at, months);
    if (!row.expiry_date) {
      (target.getTime() <= now ? groups.openEndedLapsed : groups.openEnded).push({ row, target });
      if (INCLUDE_OPEN) changes.push({ row, target });
    } else if (new Date(row.expiry_date).getTime() > target.getTime()) groups.longer.push({ row, target });
    else if (new Date(row.expiry_date).getTime() === target.getTime()) groups.already.push({ row, target });
    else { groups.extend.push({ row, target }); changes.push({ row, target }); }
  }

  console.log(`enrollments active: ${rows.length}`);
  console.log(`  already a year from subscription ............ ${groups.already.length}`);
  console.log(`  expire EARLIER than that (will be extended) .. ${groups.extend.length}`);
  console.log(`  expire LATER than that (left alone) .......... ${groups.longer.length}`);
  console.log(`  no expiry, a year from subscription still ahead ${groups.openEnded.length}`);
  console.log(`  no expiry, a year from subscription ALREADY PAST ${groups.openEndedLapsed.length}  <- converting these ends their access now`);
  if (groups.openEndedLapsed.length) {
    console.log('\n  first open-ended enrollments that would end at once:');
    for (const { row, target } of groups.openEndedLapsed.slice(0, 10)) {
      console.log(`    ${String(row.client_code || '').padEnd(10)} ${String(row.name || '').slice(0, 24).padEnd(24)} subscribed ${day(row.enrolled_at)} -> would end ${day(target)}`);
    }
  }
  // Revoked enrollments whose year from subscription is still ahead. A refund revokes too, so they are only counted by who revoked them, and
  // re-opened for the one actor the owner names (a script that revoked by the old per-year rule, for example).
  const [revoked] = await db.query(
    `SELECT e.id, e.enrolled_at, e.revoked_by, c.access_months
       FROM enrollments e JOIN courses c ON c.id = e.course_id AND c.tenant_id = e.tenant_id
      WHERE e.tenant_id = ? AND e.status = 'revoked' AND e.enrolled_at IS NOT NULL`, [TENANT]);
  const actorOf = row => row.revoked_by || '(nobody named)';
  const stillAhead = revoked
    .map(row => ({ row, target: addMonths(row.enrolled_at, Number(row.access_months) > 0 ? Number(row.access_months) : DEFAULT_MONTHS) }))
    .filter(item => item.target.getTime() > now);
  const byActor = new Map();
  for (const { row } of stillAhead) byActor.set(actorOf(row), (byActor.get(actorOf(row)) || 0) + 1);
  console.log(`\nrevoked enrollments whose year is still ahead: ${stillAhead.length}`);
  for (const [actor, count] of [...byActor].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    revoked by ${String(actor).padEnd(30)} ${count}`);
  const reinstate = REINSTATE_BY ? stillAhead.filter(({ row }) => actorOf(row) === REINSTATE_BY) : [];
  if (REINSTATE_BY) console.log(`  --reinstate-revoked-by="${REINSTATE_BY}": ${reinstate.length} to re-open`);

  console.log(`\nthis run ${APPLY ? 'WRITES' : 'would write'} ${changes.length + reinstate.length} row(s)` + (INCLUDE_OPEN ? ' (open-ended included)' : ' (open-ended left open)'));

  if (!APPLY) { await db.end(); return; }
  if (!changes.length && !reinstate.length) { await db.end(); return; }
  const backup = path.join(process.cwd(), `year-access-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify([
    ...changes.map(({ row, target }) => ({ id: row.id, old: row.expiry_date ? new Date(row.expiry_date).toISOString() : null, next: target.toISOString() })),
    ...reinstate.map(({ row, target }) => ({ id: row.id, was: 'revoked', revoked_by: row.revoked_by || null, next: target.toISOString() })),
  ], null, 1));
  console.log(`backup of the old values: ${backup}`);
  let written = 0;
  for (const { row, target } of changes) {
    const sql = row.expiry_date
      ? 'UPDATE enrollments SET expiry_date = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ? AND status = \'active\' AND expiry_date = ?'
      : 'UPDATE enrollments SET expiry_date = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ? AND status = \'active\' AND expiry_date IS NULL';
    const params = row.expiry_date ? [target, row.id, TENANT, row.expiry_date] : [target, row.id, TENANT];
    const [result] = await db.query(sql, params);
    written += result.affectedRows;
  }
  console.log(`written: ${written} of ${changes.length}`);
  let reopened = 0;
  for (const { row, target } of reinstate) {
    const [result] = await db.query(
      "UPDATE enrollments SET status = 'active', revoked_at = NULL, revoked_by = NULL, expiry_date = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ? AND status = 'revoked'",
      [target, row.id, TENANT]);
    reopened += result.affectedRows;
  }
  if (REINSTATE_BY) console.log(`re-opened: ${reopened} of ${reinstate.length}`);
  await db.end();
})().catch(error => { console.error(error.message); process.exit(1); });
