'use strict';
/**
 * Core logic for POST /api/admin/orders/:id/confirm-payment (PAY-02/PAY-06).
 *
 * Extracted out of api/routes/orders.js so it can be exercised with a mock
 * connection the same way applyRefundReversal() and ensureSubscriberForOrder()
 * already are — the route itself keeps the row-locking/404/409 checks (order
 * must be pending, a linked transfer must exist and not already be claimed)
 * since those decide the HTTP response shape; this function only does the
 * part that actually creates the payment.
 *
 * Must run inside an existing transaction on `conn`, after the caller has
 * already locked `order` (and `transfer`, if linking one) with FOR UPDATE and
 * called assertWritable(). Returns { paymentId }.
 */
const { uuidv4 } = require('./id');
const { logPaymentAudit, postPaymentJournal } = require('./finance');
const { ensureSubscriberForOrder } = require('./subscriberProvisioning');
const { transitionLead } = require('./leadState');
const { branchIdForBranch } = require('./branches');
const { grantCourseSelections } = require('./entitlements');
const { recordPaymentCompensation } = require('./paymentCompensation');

async function confirmOrderPayment({ order, transfer, linkedTransferId, tenantId, staffId, staffName, actorEmail }, conn) {
  const orderType = String(order.type || '').toLowerCase();
  const actor = actorEmail || 'admin';

  let sub = null;
  if (order.customer_email) {
    sub = await ensureSubscriberForOrder(conn, {
      tenantId, email: order.customer_email, name: order.customer_name, phone: order.customer_phone,
      fallbackBranch: 'ONLINE_EGYPT',
    });
  } else if (order.subscriber_id) {
    [[sub]] = await conn.query('SELECT id, tenant_id, lead_id, branch, branch_id, assigned_sales_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [order.subscriber_id, tenantId]);
  }
  if (['course', 'bundle'].includes(orderType) && !sub) {
    const error = new Error('Course and bundle orders require a tenant-owned subscriber');
    error.statusCode = 409;
    throw error;
  }

  const paymentMethod = transfer?.payment_method || order.payment_method || 'transfer';
  const payId = `manual-${uuidv4()}`;
  await conn.query(
    `INSERT INTO payments
       (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method,
        transaction_id, is_installment, course_expected, note, date, status, staff_id, staff_name,
        source, item_title, branch, branch_id, tenant_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,0,?,?,NOW(),'paid',?,?,?,?,?,?,?,NOW())`,
    [payId, sub?.id || null, orderType === 'course' ? order.item_id : null, orderType === 'bundle' ? order.item_id : null,
     order.amount, order.currency || 'EGP', orderType.toUpperCase() || 'OTHER', paymentMethod,
     transfer?.transaction_id || order.transaction_id || payId, order.amount,
     `تأكيد يدوي من لوحة الطلبات${transfer ? ' — مربوط بتحويل ' + transfer.id : ''}`,
     staffId || null, staffName || actor,
     'manual_admin_confirm', order.item_title, sub?.branch || 'ONLINE_EGYPT', sub?.branch_id || branchIdForBranch(sub?.branch || 'ONLINE_EGYPT'),
     tenantId]
  );
  const journalId = await postPaymentJournal({
    paymentId: payId, amount: order.amount, currency: order.currency || 'EGP',
    payType: orderType.toUpperCase() || 'OTHER', actor, tenantId,
    branch: sub?.branch || 'ONLINE_EGYPT',
    branchId: sub?.branch_id || branchIdForBranch(sub?.branch || 'ONLINE_EGYPT'),
  }, conn);
  if (!journalId) throw new Error('Manual payment journal posting failed');
  await logPaymentAudit(
    payId, 'create', null, 'paid', order.amount, sub?.id || null,
    actor, tenantId, conn, true,
  );
  await recordPaymentCompensation({
    paymentId: payId,
    tenantId,
    commissionStaffId: sub?.assigned_sales_id || staffId || null,
    actor: staffId || actor,
  }, conn);

  if (sub?.id && (orderType === 'course' || orderType === 'bundle') && order.item_id) {
    await grantCourseSelections({
      tenantId,
      subscriberId: sub.id,
      selections: [{ courseId: orderType === 'bundle' ? `bundle:${order.item_id}` : order.item_id, accessType: 'full' }],
      branchId: sub.branch_id || branchIdForBranch(sub.branch || 'ONLINE_EGYPT'),
      source: 'manual_order_payment',
      actor,
    }, conn);
  }

  await conn.query(
    `UPDATE orders SET status='paid', subscriber_id=COALESCE(subscriber_id, ?),
        course_id=CASE WHEN ?='course' THEN COALESCE(course_id,item_id) ELSE course_id END,
        bundle_id=CASE WHEN ?='bundle' THEN COALESCE(bundle_id,item_id) ELSE bundle_id END,
        transaction_id=COALESCE(transaction_id, ?), paid_at=NOW(), linked_transfer_id=?
      WHERE id=? AND tenant_id=?`,
    [sub?.id || null, orderType, orderType, payId, linkedTransferId || null, order.id, tenantId]
  );

  if (sub?.lead_id) {
    await transitionLead({
      tenantId, leadId: sub.lead_id, toStatus: 'converted', db: conn,
      actor: actorEmail || staffName || 'admin',
      reason: 'Lead converted after manual order confirmation', metadata: { orderId: order.id, subscriberId: sub.id },
    });
  }

  return { paymentId: payId };
}

module.exports = { confirmOrderPayment };
