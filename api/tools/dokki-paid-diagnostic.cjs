#!/usr/bin/env node
'use strict';
// Read-only. Why does a Dokki client read «المدفوع 0»?
//
// Run on the server:  node api/tools/dokki-paid-diagnostic.cjs [tenant-id]
//
// The clients table counts a client's money per course from `payments` rows that
// are (1) status 'paid', (2) of type COURSE with a course or bundle id, and from
// `crm_json.priorPaid` (money paid before the system, written by the sheet
// import). Anything else reads as zero. This sorts every Dokki client into the
// first reason that applies, so the fix can be aimed at the real cause instead
// of at the screen.
require('dotenv').config();
const { pool } = require('../lib/db');

const TENANT = process.argv[2] || process.env.DEFAULT_TENANT_ID || 'tenant-default';

(async () => {
  const [subs] = await pool.query(
    `SELECT id, name, phone, client_code, crm_json FROM subscribers
      WHERE tenant_id=? AND deleted_at IS NULL AND UPPER(REPLACE(branch,'-','_'))='DAQQI'`, [TENANT]);
  const ids = subs.map(s => s.id);
  const pays = ids.length ? (await pool.query(
    `SELECT subscriber_id, status, payment_type, course_id, bundle_id, amount, currency, source, staff_name
       FROM payments WHERE tenant_id=? AND deleted_at IS NULL AND subscriber_id IN (?)`, [TENANT, ids]))[0] : [];
  const bySub = new Map();
  for (const p of pays) { if (!bySub.has(p.subscriber_id)) bySub.set(p.subscriber_id, []); bySub.get(p.subscriber_id).push(p); }

  const buckets = {
    counted: [], // reads a real, non-zero paid figure
    pendingOnly: [], // money recorded but still awaiting approval
    notCoursePayments: [], // paid, but typed OTHER/CARNEH/BOOK… or no course/bundle id
    refundedOnly: [],
    priorPaidOnly: [],
    noPaymentsAtAll: [],
  };
  const pendingBy = {};
  for (const s of subs) {
    const rows = bySub.get(s.id) || [];
    let crm = {}; try { crm = typeof s.crm_json === 'string' ? JSON.parse(s.crm_json || '{}') : (s.crm_json || {}); } catch { crm = {}; }
    const prior = Object.values(crm.priorPaid || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    const counted = rows.filter(p => p.status === 'paid' && Number(p.amount) > 0
      && String(p.payment_type || '').toUpperCase() === 'COURSE' && (p.course_id || p.bundle_id));
    const pending = rows.filter(p => p.status === 'pending');
    const paidOther = rows.filter(p => p.status === 'paid' && Number(p.amount) > 0 && !counted.includes(p));
    const refunded = rows.filter(p => p.status === 'refunded');
    if (counted.length) buckets.counted.push(s);
    else if (pending.length) { buckets.pendingOnly.push(s); pending.forEach(p => { pendingBy[p.staff_name || '—'] = (pendingBy[p.staff_name || '—'] || 0) + 1; }); }
    else if (paidOther.length) buckets.notCoursePayments.push(s);
    else if (refunded.length) buckets.refundedOnly.push(s);
    else if (prior > 0) buckets.priorPaidOnly.push(s);
    else buckets.noPaymentsAtAll.push(s);
  }

  // Where the Dokki data lives: the database, row counts as of now. (The code carries
  // none — admin/context/siteDataSeed.ts is empty arrays, and no migration inserts a client.)
  const [[where]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM subscribers WHERE tenant_id=? AND UPPER(REPLACE(branch,'-','_'))='DAQQI') AS subscribers_all,
       (SELECT COUNT(*) FROM subscribers WHERE tenant_id=? AND UPPER(REPLACE(branch,'-','_'))='DAQQI' AND deleted_at IS NULL AND is_active=1) AS subscribers_active,
       (SELECT COUNT(*) FROM subscribers WHERE tenant_id=? AND UPPER(REPLACE(branch,'-','_'))='DAQQI' AND (deleted_at IS NOT NULL OR is_active=0)) AS subscribers_archived,
       (SELECT COUNT(*) FROM daqqi_rounds WHERE tenant_id=?) AS rounds,
       (SELECT COUNT(*) FROM daqqi_attendees WHERE tenant_id=?) AS round_bookings,
       (SELECT COUNT(DISTINCT da.subscriber_id) FROM daqqi_attendees da
          JOIN subscribers s ON s.id=da.subscriber_id AND s.tenant_id=da.tenant_id
         WHERE da.tenant_id=? AND UPPER(REPLACE(COALESCE(s.branch,''),'-','_'))<>'DAQQI') AS booked_but_not_dokki_branch`,
    [TENANT, TENANT, TENANT, TENANT, TENANT, TENANT]);
  console.log('Rows in the database for the Dokki branch:', JSON.stringify(where));
  if (Number(where.booked_but_not_dokki_branch) > 0) {
    console.log(`NOTE: ${where.booked_but_not_dokki_branch} client(s) are booked into Dokki rounds but their branch is not DAQQI — they are on the rosters and NOT in «عملاء الدقي».`);
  }
  console.log(`Dokki clients (not deleted): ${subs.length}`);
  console.log(`  reads a paid figure          : ${buckets.counted.length}`);
  console.log(`  only PENDING (awaiting approval): ${buckets.pendingOnly.length}   ← recorded at the desk, not approved`);
  console.log(`  paid but not a COURSE payment   : ${buckets.notCoursePayments.length}   ← type/course missing on the row`);
  console.log(`  only refunded                   : ${buckets.refundedOnly.length}`);
  console.log(`  only «مدفوع قبل السيستم»          : ${buckets.priorPaidOnly.length}   (counts, via priorPaid)`);
  console.log(`  no money recorded at all        : ${buckets.noPaymentsAtAll.length}   ← money lives outside the system`);
  if (Object.keys(pendingBy).length) {
    console.log('\nPending payments by who recorded them:');
    Object.entries(pendingBy).sort((a, b) => b[1] - a[1]).forEach(([who, n]) => console.log(`  ${who}: ${n}`));
  }
  const [[sum]] = await pool.query(
    `SELECT COUNT(*) n, COALESCE(SUM(p.amount),0) total FROM payments p
       JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=p.tenant_id
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND p.status='pending' AND UPPER(REPLACE(s.branch,'-','_'))='DAQQI'`, [TENANT]);
  console.log(`\nPENDING Dokki payments: ${sum.n} rows, ${sum.total} total — approve them in النظام المحاسبي ← مراجعة المدفوعات.`);
  await pool.end().catch(() => {});
})().catch(error => { console.error('dokki-paid-diagnostic:', error.message); process.exit(2); });
