#!/usr/bin/env node
'use strict';

/**
 * READ-ONLY. Lists the clients whose two copies of one price disagree (7 Nov 2026: «سعر الكورس رقم في صفحة العميل ورقم تاني عند زر دفع وحجز»):
 *   - a course/track where the price the client agreed (client_item_money.agreed_price — what the client's page shows) is not the course_expected on
 *     one of their live payments for it (what the receipt, the collections list and the access ratio read);
 *   - a certificate whose agreed price (client_item_money cert:<id>) is not certificate_requests.price.
 *
 *   node tools/client-money-diagnose.cjs [--tenant=<id>] [--limit=200]
 *
 * Writes nothing. The same rows are what tools/client-money-repair.cjs fixes (dry run by default). Reads api/.env — point it at the database you mean to read.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const arg = name => (process.argv.find(value => value.startsWith(`--${name}=`)) || '').split('=')[1] || '';
const COLLATE = 'COLLATE utf8mb4_unicode_ci';

async function findDisagreements(db, { tenant = '', limit = 200 } = {}) {
  const tenantSql = tenant ? 'AND m.tenant_id = ?' : '';
  const params = tenant ? [tenant] : [];
  const [courses] = await db.query(
    `SELECT m.tenant_id, m.subscriber_id, m.item_key, m.agreed_price,
            GROUP_CONCAT(DISTINCT p.course_expected ORDER BY p.course_expected SEPARATOR ',') AS payment_prices, COUNT(*) AS payments
       FROM client_item_money m
       JOIN payments p ON p.tenant_id = m.tenant_id ${COLLATE} AND p.subscriber_id = m.subscriber_id ${COLLATE}
        AND p.deleted_at IS NULL AND p.payment_type IN ('COURSE','BUNDLE') AND p.status IN ('paid','pending')
        AND m.item_key = IF(p.bundle_id IS NULL, p.course_id, CONCAT('bundle:', p.bundle_id)) ${COLLATE}
      WHERE m.agreed_price > 0 AND m.item_key NOT LIKE 'cert:%' ${tenantSql}
        AND ABS(COALESCE(p.course_expected, 0) - m.agreed_price) > 0.009
      GROUP BY m.tenant_id, m.subscriber_id, m.item_key, m.agreed_price
      ORDER BY m.tenant_id, m.subscriber_id LIMIT ${Number(limit) || 200}`, params);
  const [certificates] = await db.query(
    `SELECT m.tenant_id, m.subscriber_id, r.id AS request_id, m.agreed_price, r.price AS request_price
       FROM client_item_money m
       JOIN certificate_requests r ON r.tenant_id = m.tenant_id ${COLLATE} AND r.id = SUBSTRING(m.item_key, 6) ${COLLATE}
      WHERE m.item_key LIKE 'cert:%' AND m.agreed_price > 0 ${tenantSql} AND ABS(COALESCE(r.price, 0) - m.agreed_price) > 0.009
      ORDER BY m.tenant_id, m.subscriber_id LIMIT ${Number(limit) || 200}`, params);
  return { courses, certificates };
}

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    const { courses, certificates } = await findDisagreements(db, { tenant: arg('tenant'), limit: arg('limit') });
    console.log(`courses / tracks whose payments carry another price than the client agreed: ${courses.length}`);
    for (const row of courses) console.log(`  ${row.tenant_id} ${row.subscriber_id} ${row.item_key}: agreed ${row.agreed_price}, payments say ${row.payment_prices} (${row.payments} payments)`);
    console.log(`certificates whose request carries another price than the client agreed: ${certificates.length}`);
    for (const row of certificates) console.log(`  ${row.tenant_id} ${row.subscriber_id} ${row.request_id}: agreed ${row.agreed_price}, request says ${row.request_price}`);
    console.log('nothing was written.');
  } finally { await db.end(); }
}

module.exports = { findDisagreements };
if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });
