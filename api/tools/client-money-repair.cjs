#!/usr/bin/env node
'use strict';

/**
 * Puts the two copies of one price back together (7 Nov 2026). DRY RUN by default: it prints what it would change and writes nothing.
 *
 *   node tools/client-money-repair.cjs [--tenant=<id>]            # the report
 *   node tools/client-money-repair.cjs --apply [--tenant=<id>]    # does it
 *
 * The price the client agreed (client_item_money — what the client's page shows) is the one kept:
 *   - course/track: course_expected on every live COURSE/BUNDLE payment for the item becomes the agreed price;
 *   - certificate: certificate_requests.price and the course_expected of its payments become the agreed price.
 * --apply first collects the old values of every row it will change, writes them to ./client-money-repair-<time>.json, then updates in one transaction.
 * Run tools/client-money-diagnose.cjs first. Reads api/.env — point it at the database you mean to change.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { findDisagreements } = require('./client-money-diagnose.cjs');

const APPLY = process.argv.includes('--apply');
const arg = name => (process.argv.find(value => value.startsWith(`--${name}=`)) || '').split('=')[1] || '';

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    const { courses, certificates } = await findDisagreements(db, { tenant: arg('tenant'), limit: 100000 });
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${courses.length} items and ${certificates.length} certificates to put together`);
    for (const row of courses) console.log(`  ${row.subscriber_id} ${row.item_key}: payments ${row.payment_prices} -> ${row.agreed_price}`);
    for (const row of certificates) console.log(`  ${row.subscriber_id} certificate ${row.request_id}: ${row.request_price} -> ${row.agreed_price}`);
    if (!APPLY) { console.log('nothing was written. Re-run with --apply to change it.'); return; }
    if (!courses.length && !certificates.length) return;

    const backup = [];
    await db.beginTransaction();
    try {
      for (const row of courses) {
        const bundleId = row.item_key.startsWith('bundle:') ? row.item_key.slice(7) : null;
        const where = `tenant_id=? AND subscriber_id=? AND deleted_at IS NULL AND payment_type IN ('COURSE','BUNDLE') AND status IN ('paid','pending') AND ${bundleId ? 'bundle_id=?' : 'course_id=? AND bundle_id IS NULL'} AND ABS(COALESCE(course_expected,0) - ?) > 0.009`;
        const params = [row.tenant_id, row.subscriber_id, bundleId || row.item_key, row.agreed_price];
        const [old] = await db.query(`SELECT id, course_expected FROM payments WHERE ${where}`, params);
        backup.push(...old.map(payment => ({ table: 'payments', id: payment.id, tenant_id: row.tenant_id, course_expected: payment.course_expected })));
        await db.query(`UPDATE payments SET course_expected=? WHERE ${where}`, [row.agreed_price, ...params]);
      }
      for (const row of certificates) {
        backup.push({ table: 'certificate_requests', id: row.request_id, tenant_id: row.tenant_id, price: row.request_price });
        await db.query('UPDATE certificate_requests SET price=? WHERE id=? AND tenant_id=?', [row.agreed_price, row.request_id, row.tenant_id]);
        const [old] = await db.query('SELECT id, course_expected FROM payments WHERE certificate_request_id=? AND tenant_id=? AND deleted_at IS NULL', [row.request_id, row.tenant_id]);
        backup.push(...old.map(payment => ({ table: 'payments', id: payment.id, tenant_id: row.tenant_id, course_expected: payment.course_expected })));
        await db.query('UPDATE payments SET course_expected=? WHERE certificate_request_id=? AND tenant_id=? AND deleted_at IS NULL', [row.agreed_price, row.request_id, row.tenant_id]);
      }
      const file = path.join(process.cwd(), `client-money-repair-${Date.now()}.json`);
      fs.writeFileSync(file, JSON.stringify(backup, null, 2));
      await db.commit();
      console.log(`done. backup of the old values: ${file}`);
    } catch (error) { await db.rollback(); throw error; }
  } finally { await db.end(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });
