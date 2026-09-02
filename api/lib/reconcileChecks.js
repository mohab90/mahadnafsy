'use strict';
// Shared money-model / journey integrity checks — the invariants foreign keys
// can't enforce. Used by both the `npm run reconcile` CLI and the periodic
// boot-time monitor (lib/reconcileJob). Every query is read-only.

/**
 * "This lead has a live customer behind it", written once.
 *
 * There were two copies of this rule and they disagreed in both directions.
 * The nightly job matched on lead_id alone and ignored whether the subscriber
 * was deleted, so it over-reported customers who exist under a different link
 * and under-reported leads whose customer had been removed. The dashboard
 * matched on lead_id, email or phone and required the subscriber to be live.
 * Two numbers for the same question, and the smaller one was believed.
 *
 * `l` is the leads alias the caller must use.
 */
const LIVE_SUBSCRIBER_FOR_LEAD = `
  EXISTS (
    SELECT 1 FROM subscribers s
     WHERE s.tenant_id=l.tenant_id AND s.deleted_at IS NULL
       AND (s.lead_id=l.id
         OR (l.email<>'' AND LOWER(TRIM(s.email))=LOWER(TRIM(l.email)))
         OR (l.phone<>'' AND s.phone=l.phone))
  )`;

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
          WHERE o.status='paid' AND o.type IN ('course','bundle')
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
                   (o.type='course' AND EXISTS (
                     SELECT 1 FROM enrollments e
                      WHERE e.tenant_id=o.tenant_id
                        AND e.subscriber_id=COALESCE(o.subscriber_id,p.subscriber_id)
                        AND e.course_id=COALESCE(o.course_id,o.item_id) AND e.status='active'
                   ))
                   OR
                   (o.type='bundle'
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
    // Matched on email or phone, and on archived leads as well as live ones.
    //
    // Comparing only the email address, and only against leads with hidden=0,
    // this counted 173 while the true figure was 53: 102 of them had a lead that
    // had simply been archived, and 24 more were reachable by their phone number.
    // A critical that is two-thirds false stops being read, which costs the
    // alert exactly the attention it exists to buy. An archived lead is still a
    // CRM projection — the person is known to the business, just not in the
    // active queue — so it settles this check.
    // The phone comparison costs about nine seconds: REGEXP_REPLACE on the
    // stored column cannot use an index, so it scans. Splitting the OR into
    // separate NOT EXISTS clauses, hoping the cheap email tests would filter
    // first, measured the same — the optimiser reaches the regexp either way.
    //
    // Kept as it is. This runs once a day on a background timer against a
    // server that idles at zero load, and the alternative is a check that is
    // two-thirds wrong. If it ever needs to be fast, the shape that works is
    // the one routes/registrations.js uses: load the identifiers once and
    // match them in memory, which needs the runner to accept a function here
    // rather than a SQL string.
    sql: `SELECT COUNT(*) AS n FROM users u
          WHERE LOWER(COALESCE(u.role,'user'))='user' AND u.is_active=1
            AND NOT EXISTS (
              SELECT 1 FROM subscribers s
               WHERE s.tenant_id=u.tenant_id
                 AND (LOWER(TRIM(s.email))=LOWER(TRIM(u.email))
                      OR (u.phone IS NOT NULL AND TRIM(u.phone)<>''
                          AND REGEXP_REPLACE(s.phone,'[^0-9]','')=REGEXP_REPLACE(u.phone,'[^0-9]','')))
            )
            AND NOT EXISTS (
              SELECT 1 FROM leads l
               WHERE l.tenant_id=u.tenant_id
                 AND (LOWER(TRIM(l.email))=LOWER(TRIM(u.email))
                      OR (u.phone IS NOT NULL AND TRIM(u.phone)<>''
                          AND REGEXP_REPLACE(l.phone,'[^0-9]','')=REGEXP_REPLACE(u.phone,'[^0-9]','')))
            )`,
    hint: 'A login identity without a CRM/customer projection disappears from every operational team.',
  },
  {
    key: 'converted_leads_without_subscriber',
    name: 'converted leads have a linked subscriber',
    severity: 'critical',
    sql: `SELECT COUNT(*) AS n FROM leads l
          WHERE l.status='converted' AND l.hidden=0
            AND NOT ${LIVE_SUBSCRIBER_FOR_LEAD}`,
    hint: 'A converted lead without subscriber ownership breaks payment, portal and LMS continuity.',
  },
  {
    key: 'full_access_below_price',
    name: 'full course access is covered by what the customer paid',
    // A warning, not a critical: granting access on a deposit may be exactly
    // what the desk decided. What is wrong is that nothing said so. The
    // collections view reads course_expected, which defaulted to the payment
    // itself — so a customer who paid anything at all looked settled and
    // dropped off every list that would have chased them.
    severity: 'warning',
    // Compared against the catalogue price rather than course_expected, which
    // is the field that could not be trusted. Someone enrolled on a lower
    // agreed price shows here too; that is the point — an agreed discount
    // belongs in the discount column, where a report can see it, and none of
    // these carry one.
    // Only where a payment exists and falls short. An enrolment with no payment
    // at all is a different question with a known answer: 1,783 of them came
    // from the April migration of who-was-in-which-course, and those customers
    // paid the old system. Counting them here would make this 2,109 on the day
    // it shipped, and a check that is mostly noise is one people stop reading —
    // which is the failure orphan_customer_users already demonstrated.
    sql: `SELECT COUNT(*) AS n FROM enrollments e
           JOIN courses c ON c.id=e.course_id AND c.tenant_id=e.tenant_id
          WHERE e.access_type='full' AND e.status='active'
            AND c.deleted_at IS NULL AND COALESCE(c.price_egp,0) > 0
            AND COALESCE((
              SELECT SUM(p.amount) FROM payments p
               WHERE p.subscriber_id=e.subscriber_id AND p.deleted_at IS NULL
                 AND p.status='paid' AND p.tenant_id=e.tenant_id
                 AND (p.course_id=e.course_id
                      OR (p.bundle_id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM bundle_courses bc
                         WHERE bc.bundle_id=p.bundle_id AND bc.course_id=e.course_id
                           AND bc.tenant_id=e.tenant_id)))
            ), 0) BETWEEN 0.01 AND c.price_egp - 0.01`,
    hint: 'Full access granted for less than the course price, with no discount recorded to explain it.',
  },
  {
    key: 'paid_course_without_enrollment',
    name: 'a paid course payment has an enrolment to go with it',
    severity: 'critical',
    // The other direction from full_access_below_price, and the one that hurts
    // a customer rather than the books: they paid for a named course and have
    // no enrolment in it, so nothing they bought will open. Three exist. One of
    // them paid 1,000 in May and is enrolled in nothing at all; the other two
    // paid for one course and hold enrolments in different ones.
    //
    // A bundle payment counts, because a bundle enrols its courses.
    sql: `SELECT COUNT(*) AS n FROM payments p
          WHERE p.deleted_at IS NULL AND p.status='paid'
            AND p.course_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM enrollments e
               WHERE e.subscriber_id=p.subscriber_id AND e.course_id=p.course_id
                 AND e.tenant_id=p.tenant_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM payments b
               JOIN bundle_courses bc ON bc.bundle_id=b.bundle_id AND bc.tenant_id=b.tenant_id
               WHERE b.subscriber_id=p.subscriber_id AND b.deleted_at IS NULL
                 AND b.status='paid' AND bc.course_id=p.course_id
            )`,
    hint: 'Someone paid for a course they were never enrolled in — they cannot open what they bought.',
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

module.exports = { CHECKS, runReconcile, LIVE_SUBSCRIBER_FOR_LEAD };
