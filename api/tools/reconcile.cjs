#!/usr/bin/env node
'use strict';
// Read-only data-integrity / money-model reconciliation checker.
// Foreign keys already guarantee referential integrity, so this asserts the
// invariants the DB CANNOT enforce: cross-row tenant consistency, the crm_json
// paymentHistory dual-write drift, and money data-quality. Run anytime
// (`npm run reconcile`) or from cron — it only ever SELECTs.
require('dotenv').config();
const { pool } = require('../lib/db');

const CHECKS = [
  {
    name: 'payments.tenant_id matches their subscriber',
    severity: 'critical',
    sql: `SELECT COUNT(*) AS n FROM payments p
          JOIN subscribers s ON s.id = p.subscriber_id
          WHERE p.tenant_id <> s.tenant_id`,
    hint: 'A payment tagged to a different tenant than its subscriber becomes invisible in tenant-scoped views.',
  },
  {
    name: 'enrollments.tenant_id matches their subscriber',
    severity: 'critical',
    sql: `SELECT COUNT(*) AS n FROM enrollments e
          JOIN subscribers s ON s.id = e.subscriber_id
          WHERE e.tenant_id <> s.tenant_id`,
    hint: 'A cross-tenant enrollment hides a paid course from the student.',
  },
  {
    name: 'crm_json.paymentHistory count == payments table count',
    severity: 'warn',
    sql: `SELECT COUNT(*) AS n FROM subscribers s
          WHERE JSON_LENGTH(JSON_EXTRACT(s.crm_json, '$.paymentHistory')) IS NOT NULL
            AND JSON_LENGTH(JSON_EXTRACT(s.crm_json, '$.paymentHistory'))
                <> (SELECT COUNT(*) FROM payments p WHERE p.subscriber_id = s.id AND p.amount > 0)`,
    hint: 'The crm_json blob and the payments table disagree — the dual-write drift. Payments table is the source of truth.',
  },
  {
    name: 'no paid payment with a non-positive amount',
    severity: 'warn',
    sql: `SELECT COUNT(*) AS n FROM payments WHERE status = 'paid' AND amount <= 0`,
    hint: 'A paid record for 0 or negative money is almost always bad data.',
  },
  {
    name: 'no duplicate transaction_id among payments',
    severity: 'warn',
    sql: `SELECT COUNT(*) AS n FROM (
            SELECT transaction_id FROM payments
            WHERE transaction_id IS NOT NULL AND transaction_id <> ''
            GROUP BY transaction_id HAVING COUNT(*) > 1
          ) d`,
    hint: 'The same gateway transaction recorded twice = double-counted revenue.',
  },
  {
    name: 'paid course/bundle orders that have no linkable payment',
    severity: 'info',
    sql: `SELECT COUNT(*) AS n FROM orders o
          WHERE LOWER(o.status) = 'paid' AND o.type IN ('course','bundle')
            AND NOT EXISTS (
              SELECT 1 FROM payments p
              WHERE p.id = o.id OR p.id = CONCAT('paymob-', o.id)
                 OR (o.transaction_id IS NOT NULL AND p.transaction_id = o.transaction_id)
            )`,
    hint: 'Informational: orders and payments are partly separate universes; some manual orders legitimately lack a payment row.',
  },
];

const C = { reset: '\x1b[0m', red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m' };

(async () => {
  let criticalFailures = 0;
  console.log(`${C.bold}── Reconciliation checks ──${C.reset}`);
  for (const chk of CHECKS) {
    let n, err;
    try { const [[row]] = await pool.query(chk.sql); n = Number(row.n); }
    catch (e) { err = e.message; }

    if (err) {
      console.log(`  ${C.dim}SKIP${C.reset}  ${chk.name} ${C.dim}(${err.slice(0, 60)})${C.reset}`);
      continue;
    }
    if (n === 0) {
      console.log(`  ${C.green}OK  ${C.reset}  ${chk.name}`);
    } else {
      const tag = chk.severity === 'critical' ? `${C.red}FAIL${C.reset}`
                : chk.severity === 'warn' ? `${C.yellow}WARN${C.reset}`
                : `${C.dim}INFO${C.reset}`;
      console.log(`  ${tag}  ${chk.name} ${C.bold}→ ${n} row(s)${C.reset}`);
      console.log(`        ${C.dim}${chk.hint}${C.reset}`);
      if (chk.severity === 'critical') criticalFailures++;
    }
  }
  console.log('───────────────────────────');
  console.log(criticalFailures === 0
    ? `${C.green}No critical integrity violations.${C.reset}`
    : `${C.red}${criticalFailures} critical check(s) failed.${C.reset}`);
  await pool.end().catch(() => {});
  process.exit(criticalFailures > 0 ? 1 : 0);
})().catch(e => { console.error('reconcile fatal:', e.message); process.exit(2); });
