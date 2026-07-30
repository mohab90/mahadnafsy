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
    key: 'payment_without_invoice',
    name: 'paid/refunded payments have an immutable numbered invoice',
    severity: 'critical',
    sql: `SELECT COUNT(*) AS n FROM payments p
          WHERE p.status IN ('paid','refunded') AND p.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM financial_documents fd
               WHERE fd.tenant_id=p.tenant_id AND fd.document_type='invoice'
                 AND fd.source_type='payment' AND fd.source_id=p.id
            )`,
    hint: 'Every settled payment must have one tenant/branch-scoped invoice number.',
  },
  {
    key: 'refund_without_credit_note',
    name: 'refunded payments have a credit note linked to their invoice',
    severity: 'critical',
    sql: `SELECT COUNT(*) AS n FROM payments p
          WHERE p.status='refunded' AND p.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM financial_documents cn
              JOIN financial_documents inv
                ON inv.id=cn.related_document_id AND inv.tenant_id=cn.tenant_id
               WHERE cn.tenant_id=p.tenant_id AND cn.document_type='credit_note'
                 AND cn.source_type='payment_refund' AND cn.source_id=p.id
                 AND inv.document_type='invoice' AND inv.source_type='payment' AND inv.source_id=p.id
            )`,
    hint: 'A refund must preserve the original invoice and issue a linked credit note.',
  },
  {
    key: 'unlinkable_paid_orders',
    name: 'paid course/bundle orders have payment, journal, subscriber and enrollment',
    severity: 'critical',
    sql: `SELECT COUNT(*) AS n FROM orders o
          WHERE LOWER(o.status)='paid' AND LOWER(o.type) IN ('course','bundle')
            AND NOT EXISTS (
              SELECT 1 FROM payments p
               WHERE p.tenant_id=o.tenant_id AND p.status='paid'
                 AND (p.id=o.id OR p.id=CONCAT('paymob-',o.id)
                   OR p.id=o.transaction_id
                   OR (o.transaction_id IS NOT NULL AND p.transaction_id=o.transaction_id))
                 AND COALESCE(o.subscriber_id,p.subscriber_id) IS NOT NULL
                 AND EXISTS (
                   SELECT 1 FROM journal_entries je
                    WHERE je.tenant_id=o.tenant_id AND je.ref_type='payment' AND je.ref_id=p.id
                      AND je.total_debit=je.total_credit
                 )
                 AND (
                   (LOWER(o.type)='course' AND EXISTS (
                     SELECT 1 FROM enrollments e
                      WHERE e.tenant_id=o.tenant_id
                        AND e.subscriber_id=COALESCE(o.subscriber_id,p.subscriber_id)
                        AND e.course_id=COALESCE(o.course_id,o.item_id) AND e.status='active'
                   ))
                   OR
                   (LOWER(o.type)='bundle'
                    AND EXISTS (
                      SELECT 1 FROM bundle_courses bc
                       WHERE bc.tenant_id=o.tenant_id AND bc.bundle_id=COALESCE(o.bundle_id,o.item_id)
                    )
                    AND NOT EXISTS (
                      SELECT 1 FROM bundle_courses bc
                       WHERE bc.tenant_id=o.tenant_id AND bc.bundle_id=COALESCE(o.bundle_id,o.item_id)
                         AND NOT EXISTS (
                           SELECT 1 FROM enrollments e
                            WHERE e.tenant_id=o.tenant_id
                              AND e.subscriber_id=COALESCE(o.subscriber_id,p.subscriber_id)
                              AND e.course_id=bc.course_id AND e.status='active'
                         )
                    ))
                 )
            )`,
    hint: 'A paid learning order is incomplete unless customer, cash, balanced ledger and LMS access share the same tenant-owned IDs.',
  },
  {
    key: 'orphan_customer_users',
    name: 'active customer users are linked to a lead or subscriber',
    severity: 'critical',
    sql: `SELECT COUNT(*) AS n FROM users u
          WHERE LOWER(COALESCE(u.role,'user'))='user' AND u.is_active=1
            AND NOT EXISTS (
              SELECT 1 FROM subscribers s
               WHERE s.tenant_id=u.tenant_id AND LOWER(TRIM(s.email))=LOWER(TRIM(u.email))
            )
            AND NOT EXISTS (
              SELECT 1 FROM leads l
               WHERE l.tenant_id=u.tenant_id AND l.hidden=0
                 AND LOWER(TRIM(l.email))=LOWER(TRIM(u.email))
            )`,
    hint: 'A login identity without a CRM/customer projection disappears from every operational team.',
  },
  {
    key: 'converted_leads_without_subscriber',
    name: 'converted leads have a linked subscriber',
    severity: 'critical',
    sql: `SELECT COUNT(*) AS n FROM leads l
          WHERE l.status='converted' AND l.hidden=0
            AND NOT EXISTS (
              SELECT 1 FROM subscribers s
               WHERE s.tenant_id=l.tenant_id AND s.lead_id=l.id
            )`,
    hint: 'A converted lead without subscriber ownership breaks payment, portal and LMS continuity.',
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
