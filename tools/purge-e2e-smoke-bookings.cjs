// Remove the lead-booking smoke test's leftovers from the live books.
//
// Four bookings were created on 17 and 20 June to prove the lead -> booking
// path worked. They were never cleaned up, so four fake customers sat in the
// customer list, four enrolments granted access to a real course, and 492 EGP
// of invented revenue sat in the totals.
//
// Matched on payment_method = 'qa_smoke', which nothing but the smoke test
// writes. Nothing is matched on amount or date, so a real payment cannot be
// caught by accident -- notably not the 700 EGP "اختبار دقي" booking, which
// carries an Orange Cash wallet and a transfer reference and is left alone.
//
// Payments and subscribers are soft-deleted, because that is what the app
// means by deleted and every financial query already honours it. Journal
// entries and enrolments are removed outright: leaving the journal behind
// would take the payments off the payment screens while the revenue total
// stayed wrong, and leaving the enrolments behind would keep four fake
// students holding access to altwazn-w-aldam-alnfsy.
//
//   node tools/purge-e2e-smoke-bookings.cjs          # dry run
//   node tools/purge-e2e-smoke-bookings.cjs --apply
require('dotenv').config({ path: '/var/www/mahad-api/.env' });
const fs = require('fs');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const MARKER = 'qa_smoke';

const money = value => Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [payments] = await db.query(
    `SELECT * FROM payments WHERE deleted_at IS NULL AND payment_method = ?`, [MARKER]);
  if (!payments.length) {
    console.log('nothing to do: no live payments with payment_method =', MARKER);
    await db.end();
    return;
  }

  const paymentIds = payments.map(p => p.id);
  const subscriberIds = [...new Set(payments.map(p => p.subscriber_id).filter(Boolean))];

  const [entries] = await db.query(
    `SELECT * FROM journal_entries WHERE ref_type = 'payment' AND ref_id IN (?)`, [paymentIds]);
  const entryIds = entries.map(e => e.id);
  const [lines] = entryIds.length
    ? await db.query(`SELECT * FROM journal_entry_lines WHERE entry_id IN (?)`, [entryIds])
    : [[]];
  const [subscribers] = subscriberIds.length
    ? await db.query(`SELECT * FROM subscribers WHERE id IN (?)`, [subscriberIds])
    : [[]];
  const [enrolments] = subscriberIds.length
    ? await db.query(`SELECT * FROM enrollments WHERE subscriber_id IN (?)`, [subscriberIds])
    : [[]];

  // Refuse anything that does not look like the smoke test all the way through.
  // The marker alone decides what is selected; this decides whether to trust it.
  const suspicious = payments.filter(p =>
    Number(p.amount_egp) !== 123 || !/e2e smoke/i.test(String(p.note || '')));
  const namedWrong = subscribers.filter(s => !/E2E Smoke/i.test(String(s.name || '')));
  if (suspicious.length || namedWrong.length) {
    console.error('ABORT: rows carry the marker but do not look synthetic.');
    console.error(JSON.stringify({ suspicious, namedWrong }, null, 1));
    process.exitCode = 1;
    await db.end();
    return;
  }

  const [[before]] = await db.query(
    `SELECT COUNT(*) n, COALESCE(SUM(amount_egp),0) total
       FROM payments WHERE deleted_at IS NULL AND status = 'paid'`);

  console.log(`payments      : ${payments.length} (${money(payments.reduce((s, p) => s + Number(p.amount_egp), 0))} EGP)`);
  console.log(`journal       : ${entries.length} entries, ${lines.length} lines`);
  console.log(`subscribers   : ${subscribers.length} -> ${subscribers.map(s => s.name).join(', ')}`);
  console.log(`enrolments    : ${enrolments.length} -> ${[...new Set(enrolments.map(e => e.course_id))].join(', ')}`);
  console.log(`live paid now : ${before.n} totalling ${money(before.total)} EGP`);

  if (!APPLY) {
    console.log('\ndry run -- nothing written. re-run with --apply');
    await db.end();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `/var/www/mahad-api/db-backups/e2e-smoke-bookings-${stamp}.json`;
  fs.mkdirSync('/var/www/mahad-api/db-backups', { recursive: true });
  fs.writeFileSync(backup, JSON.stringify(
    { payments, journal_entries: entries, journal_entry_lines: lines, subscribers, enrollments: enrolments },
    null, 2));
  console.log('\nbackup written:', backup);

  await db.beginTransaction();
  try {
    const [p] = await db.query(
      `UPDATE payments SET deleted_at = NOW() WHERE id IN (?)`, [paymentIds]);

    let removedLines = 0, removedEntries = 0;
    if (entryIds.length) {
      [{ affectedRows: removedLines }] = await db.query(
        `DELETE FROM journal_entry_lines WHERE entry_id IN (?)`, [entryIds]);
      [{ affectedRows: removedEntries }] = await db.query(
        `DELETE FROM journal_entries WHERE id IN (?)`, [entryIds]);
    }

    let removedEnrolments = 0, removedSubscribers = 0;
    if (subscriberIds.length) {
      [{ affectedRows: removedEnrolments }] = await db.query(
        `DELETE FROM enrollments WHERE subscriber_id IN (?)`, [subscriberIds]);
      [{ affectedRows: removedSubscribers }] = await db.query(
        `UPDATE subscribers SET deleted_at = NOW(), is_active = 0 WHERE id IN (?)`, [subscriberIds]);
    }

    // The removal is itself a change to a payment, so it leaves a trail.
    for (const payment of payments) {
      await db.query(
        `INSERT INTO payment_audit_log
           (id, tenant_id, payment_id, action, old_status, new_status, amount, subscriber_id, actor, created_at)
         VALUES (?, ?, ?, 'deleted', ?, 'deleted', ?, ?, ?, NOW())`,
        [crypto.randomUUID(), payment.tenant_id, payment.id, payment.status,
          payment.amount_egp, payment.subscriber_id, 'cleanup:e2e-smoke-bookings']);
    }

    await db.commit();
    console.log(`payments soft-deleted : ${p.affectedRows}`);
    console.log(`journal removed       : ${removedEntries} entries, ${removedLines} lines`);
    console.log(`enrolments removed    : ${removedEnrolments}`);
    console.log(`subscribers hidden    : ${removedSubscribers}`);
    console.log(`audit rows written    : ${payments.length}`);
  } catch (error) {
    await db.rollback();
    console.error('rolled back, nothing changed:', error.message);
    process.exitCode = 1;
    await db.end();
    return;
  }

  const [[after]] = await db.query(
    `SELECT COUNT(*) n, COALESCE(SUM(amount_egp),0) total
       FROM payments WHERE deleted_at IS NULL AND status = 'paid'`);
  console.log(`\nlive paid : ${before.n} -> ${after.n}`);
  console.log(`revenue   : ${money(before.total)} -> ${money(after.total)} EGP`);
  await db.end();
})().catch(error => { console.error('ERR', error.message); process.exit(1); });
