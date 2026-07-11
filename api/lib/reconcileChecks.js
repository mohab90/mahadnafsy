'use strict';
// Shared money-model / journey integrity checks — the invariants foreign keys
// can't enforce. Used by both the `npm run reconcile` CLI and the periodic
// boot-time monitor (lib/reconcileJob). Every query is read-only.

const CHECKS = [
  {
    key: 'payment_tenant_match',
    name: 'payments.tenant_id matches their subscriber',
    severity: 'critical',
    sql: `SELECT COUNT(*) AS n FROM payments p
          JOIN subscribers s ON s.id = p.subscriber_id
          WHERE p.tenant_id <> s.tenant_id`,
    hint: 'A payment tagged to a different tenant than its subscriber becomes invisible in tenant-scoped views.',
  },
  {
    key: 'enrollment_tenant_match',
    name: 'enrollments.tenant_id matches their subscriber',
    severity: 'critical',
    sql: `SELECT COUNT(*) AS n FROM enrollments e
          JOIN subscribers s ON s.id = e.subscriber_id
          WHERE e.tenant_id <> s.tenant_id`,
    hint: 'A cross-tenant enrollment hides a paid course from the student.',
  },
  {
    key: 'crmjson_payment_ahead_of_table',
    name: 'no subscriber whose crm_json has MORE payments than the payments table',
    severity: 'warn',
    // The payments table is the sole source of truth now, so table >= crm_json is
    // expected (crm_json is a lagging backup). Only the REVERSE — crm_json ahead of
    // the table — is a real problem: it means a payment never reached the canonical
    // table. Backfill (POST /api/admin/backfill-payments) resolves it.
    sql: `SELECT COUNT(*) AS n FROM subscribers s
          WHERE JSON_LENGTH(JSON_EXTRACT(s.crm_json, '$.paymentHistory'))
                > (SELECT COUNT(*) FROM payments p WHERE p.subscriber_id = s.id AND p.amount > 0)`,
    hint: 'crm_json holds a payment the canonical payments table is missing — run backfill-payments.',
  },
  {
    key: 'nonpositive_paid',
    name: 'no paid payment with a non-positive amount',
    severity: 'warn',
    sql: `SELECT COUNT(*) AS n FROM payments WHERE status = 'paid' AND amount <= 0`,
    hint: 'A paid record for 0 or negative money is almost always bad data.',
  },
  {
    key: 'dup_transaction',
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
    key: 'unlinkable_paid_orders',
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

// Runs every check against the pool; returns [{ key, name, severity, n, error }].
async function runReconcile(pool) {
  const out = [];
  for (const chk of CHECKS) {
    try {
      const [[row]] = await pool.query(chk.sql);
      out.push({ ...chk, n: Number(row.n) });
    } catch (e) {
      out.push({ ...chk, n: null, error: e.message });
    }
  }
  return out;
}

module.exports = { CHECKS, runReconcile };
