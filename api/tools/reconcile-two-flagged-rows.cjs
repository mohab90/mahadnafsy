'use strict';
/**
 * The two rows the reconciliation job has been reporting as CRITICAL every day.
 * Both were investigated first; neither was what its label suggested.
 *
 * 1. unlinkable_paid_orders — order a89ab671…, "walid", 100 EGP, «كورس تجريبي».
 *    A live Paymob test checkout (txn 517751559). It is flagged because the
 *    course it names, kwrs-tjryby, has since been deleted, so no enrollment can
 *    exist for it and the check's last condition can never be met.
 *
 *    Only the ORDER row is retired here. Its payment carries a balanced journal
 *    entry (100 debit / 100 credit), and deleting a payment out from under a
 *    posted entry unbalances the books — which is why the app's own delete
 *    refuses to touch a paid payment at all. Taking the 100 EGP back out of
 *    revenue is a reversal, and a reversal is the accountant's call, not a
 *    script's. It is left in place and reported.
 *
 * 2. converted_leads_without_subscriber — lead-gs-1786360874425-4358,
 *    "Sally Goher", a Facebook lead with no email.
 *
 *    Not an orphan: the subscriber attached to her lead is a different person
 *    entirely — «عفاف على محمد أحمد», created 2026-08-10 11:26 and archived the
 *    same afternoon at 14:53. So the conversion recorded against Sally Goher
 *    was a mis-link, and nothing was ever logged against Sally herself (zero
 *    communications). 'converted' has to mean a customer exists; for her it
 *    never did. She goes back to the working pool.
 *
 *    عفاف's own record is left exactly as it is: her 900 EGP payment and three
 *    full enrollments are live while she is archived, and untangling that is a
 *    decision about a real customer's money and access.
 *
 * Dry run:  node api/tools/reconcile-two-flagged-rows.cjs
 * Apply:    node api/tools/reconcile-two-flagged-rows.cjs --apply
 */

require('dotenv').config();

const TEST_ORDER_ID = 'a89ab671-a00a-4508-96a5-8ce93949dc5a';
const MISLINKED_LEAD_ID = 'lead-gs-1786360874425-4358';

async function main() {
  const apply = process.argv.includes('--apply');
  const { pool } = require('../lib/db');
  const { transitionLead } = require('../lib/leadState');

  const [[order]] = await pool.query(
    'SELECT id, tenant_id, customer_name, amount, currency, status, course_id, deleted_at FROM orders WHERE id=? LIMIT 1',
    [TEST_ORDER_ID]
  );
  const [[lead]] = await pool.query(
    'SELECT id, tenant_id, name, status, phone FROM leads WHERE id=? LIMIT 1',
    [MISLINKED_LEAD_ID]
  );

  console.log('order :', order
    ? `${order.customer_name} ${order.amount} ${order.currency} ${order.status}` +
      ` — course ${order.course_id} — deleted_at ${order.deleted_at || 'null'}`
    : 'not found (already handled)');
  console.log('lead  :', lead ? `${lead.name} — status ${lead.status}` : 'not found');

  if (!apply) {
    console.log('\ndry run — pass --apply to write');
    process.exit(0);
  }

  if (order && !order.deleted_at) {
    // Soft delete: the row stays for audit, and every read filters deleted_at.
    await pool.query('UPDATE orders SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL', [TEST_ORDER_ID]);
    console.log('order retired (payment and its journal entry untouched)');
  }

  if (lead && String(lead.status).toLowerCase() === 'converted') {
    // Through the one service that owns lead status, so the timeline records it.
    // force: the pipeline has no configured path back out of converted, and this
    // is a correction of a fact that was never true rather than a sales move.
    const result = await transitionLead({
      tenantId: lead.tenant_id,
      leadId: MISLINKED_LEAD_ID,
      toStatus: 'new',
      actor: 'reconcile-fix',
      reason: 'التحويل كان مرتبط بعميل مختلف تمامًا — رجعت لقائمة العمل',
      metadata: { correctedBy: 'reconcile-two-flagged-rows', mislinkedSubscriberName: 'عفاف على محمد أحمد' },
      force: true,
    });
    console.log('lead transitioned:', JSON.stringify(result));
  }

  process.exit(0);
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exit(1); });
}
