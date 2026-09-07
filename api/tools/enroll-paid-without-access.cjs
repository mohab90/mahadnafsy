#!/usr/bin/env node
'use strict';
/**
 * Enrol customers who paid for a course and hold no enrolment at all.
 *
 * The reconcile check `paid_course_no_access_at_all` names them: a paid,
 * undeleted course payment, and not a single active enrolment anywhere. They
 * paid and can open nothing.
 *
 * The access level is not a judgement made here. A payment that is not an
 * instalment grants `full` at the moment it is recorded — see
 * routes/subscriber-payments.js, where the proportional resolution runs only
 * for instalments — so that is what these get. This restores what the system
 * would have done at payment time, and the tool refuses any row where that
 * assumption does not hold rather than guessing.
 *
 * The grant goes through grantCourseEntitlement, the same path the payment
 * routes use, so prerequisites, ownership and the audit trail behave normally.
 *
 * Dry by default:
 *   node tools/enroll-paid-without-access.cjs           # report only
 *   node tools/enroll-paid-without-access.cjs --commit  # apply
 */
require('dotenv').config();
const { pool } = require('../lib/db');
const { grantCourseEntitlement } = require('../lib/entitlements');

const commit = process.argv.includes('--commit');
const TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-default';

(async () => {
  const [rows] = await pool.query(
    `SELECT p.id AS payment_id, p.subscriber_id, p.course_id, p.amount, p.currency,
            p.is_installment, DATE_FORMAT(p.date,'%Y-%m-%d') AS paid_on,
            s.name, s.client_code, s.branch_id,
            c.title AS course_title, c.price_egp
       FROM payments p
       JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=p.tenant_id
       JOIN courses c ON c.id=p.course_id AND c.tenant_id=p.tenant_id
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND p.status='paid'
        AND p.course_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM enrollments e
           WHERE e.subscriber_id=p.subscriber_id AND e.tenant_id=p.tenant_id
             AND e.status='active'
        )
        AND NOT EXISTS (
          SELECT 1 FROM payments b
           JOIN bundle_courses bc ON bc.bundle_id=b.bundle_id AND bc.tenant_id=b.tenant_id
           WHERE b.subscriber_id=p.subscriber_id AND b.deleted_at IS NULL
             AND b.status='paid' AND bc.course_id=p.course_id
        )
      ORDER BY p.date`,
    [TENANT]
  );

  console.log(`[enroll] ${rows.length} customer(s) paid for a course and hold no active enrolment`);
  if (!rows.length) return;

  const doable = [];
  for (const row of rows) {
    console.log(`  ${row.client_code}  ${row.name}`);
    console.log(`      paid ${row.amount} ${row.currency} on ${row.paid_on} for «${row.course_title}»`
      + (row.price_egp ? ` (listed ${Math.round(row.price_egp)} EGP)` : ''));
    if (row.is_installment) {
      console.log('      SKIPPED — recorded as an instalment, so the access level is not simply full');
      continue;
    }
    doable.push(row);
  }

  if (!commit) {
    console.log(`\n[enroll] dry run — ${doable.length} would be granted full access. Pass --commit to apply.`);
    return;
  }

  for (const row of doable) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await grantCourseEntitlement({
        tenantId: TENANT,
        subscriberId: row.subscriber_id,
        courseId: row.course_id,
        accessType: 'full',
        branchId: row.branch_id || 'branch-other',
        source: 'reconcile_paid_without_access',
        actor: 'reconcile-repair',
      }, conn);
      await conn.commit();
      console.log(`  granted: ${row.client_code} → «${row.course_title}»`);
    } catch (error) {
      await conn.rollback().catch(() => {});
      console.error(`  FAILED: ${row.client_code} — ${error.message}`);
    } finally {
      conn.release();
    }
  }

  const [[left]] = await pool.query(
    `SELECT COUNT(*) AS n FROM payments p
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND p.status='paid' AND p.course_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM enrollments e
          WHERE e.subscriber_id=p.subscriber_id AND e.tenant_id=p.tenant_id AND e.status='active')`,
    [TENANT]
  );
  console.log(`\n[enroll] done — ${left.n} still without any active enrolment`);
})()
  .catch(error => { console.error('[enroll]', error.message); process.exitCode = 1; })
  .finally(() => pool.end().catch(() => {}));
