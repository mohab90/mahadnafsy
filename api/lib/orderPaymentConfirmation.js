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
const { postPaymentJournal } = require('./finance');
const { ensureSubscriberForOrder } = require('./subscriberProvisioning');
const { transitionLead } = require('./leadState');
const { branchIdForBranch } = require('./branches');

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
    [[sub]] = await conn.query('SELECT id, tenant_id, lead_id, branch, branch_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [order.subscriber_id, tenantId]);
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
     transfer?.transaction_id || order.transaction_id || null, order.amount,
     `تأكيد يدوي من لوحة الطلبات${transfer ? ' — مربوط بتحويل ' + transfer.id : ''}`,
     staffId || null, staffName || actor,
     'manual_admin_confirm', order.item_title, sub?.branch || 'ONLINE_EGYPT', sub?.branch_id || branchIdForBranch(sub?.branch || 'ONLINE_EGYPT'),
     tenantId]
  );
  const journalId = await postPaymentJournal({
    paymentId: payId, amount: order.amount, currency: order.currency || 'EGP',
    payType: orderType.toUpperCase() || 'OTHER', actor, tenantId,
  }, conn);
  if (!journalId) throw new Error('Manual payment journal posting failed');

  if (sub?.id && (orderType === 'course' || orderType === 'bundle') && order.item_id) {
    let courseIds = [];
    if (orderType === 'bundle') {
      const [bundleRows] = await conn.query(
        `SELECT bc.course_id FROM bundle_courses bc
         JOIN bundles b ON b.id=bc.bundle_id AND b.tenant_id=?
         JOIN courses c ON c.id=bc.course_id AND c.tenant_id=? AND c.deleted_at IS NULL
         WHERE bc.bundle_id=?`,
        [tenantId, tenantId, order.item_id]
      );
      courseIds = bundleRows.map(r => r.course_id);
    } else {
      const [[course]] = await conn.query('SELECT id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [order.item_id, tenantId]);
      if (course) courseIds = [order.item_id];
    }
    for (const cid of courseIds) {
      await conn.query(
        `INSERT INTO enrollments (id, subscriber_id, course_id, enrolled_at, access_type, tenant_id, branch_id)
         VALUES (?,?,?,NOW(),'full',?,?) ON DUPLICATE KEY UPDATE access_type='full'`,
        [uuidv4(), sub.id, cid, tenantId, sub.branch_id || branchIdForBranch(sub.branch || 'ONLINE_EGYPT')]
      );
    }
  }

  await conn.query(
    `UPDATE orders SET status='paid', transaction_id=COALESCE(transaction_id, ?), paid_at=NOW(), linked_transfer_id=?
      WHERE id=? AND tenant_id=?`,
    [payId, linkedTransferId || null, order.id, tenantId]
  );

  if (sub?.lead_id) {
    await transitionLead({
      tenantId, leadId: sub.lead_id, toStatus: 'converted', db: conn,
      actor: actorEmail || staffName || 'admin',
      reason: 'Lead converted after manual order confirmation', metadata: { orderId: order.id, subscriberId: sub.id },
    }).catch(() => {});
  }

  return { paymentId: payId };
}

module.exports = { confirmOrderPayment };
