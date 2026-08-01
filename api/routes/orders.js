'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { resolveSubscriberRow } = require('../lib/subscriberIdentity');
const { parseLimit } = require('../lib/helpers');
const { logPaymentAudit } = require('../lib/finance');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { safeIsoString } = require('../lib/dates');
const { assertWritable } = require('../lib/periodLock');
const { confirmOrderPayment } = require('../lib/orderPaymentConfirmation');
const { financialRecordMatches, resolveFinancialScope } = require('../lib/financialScope');
const { normalizeJourneyState } = require('../lib/journeyStates');

function appendScope(sql, params, scope, recordAlias, subscriberAlias = 's') {
  if (scope.branchId) return [`${sql} AND ${recordAlias}.branch_id=?`, [...params, scope.branchId]];
  if (scope.kind === 'assigned_cs' || scope.kind === 'assigned_sales') {
    const column = scope.kind === 'assigned_cs' ? 'assigned_cs_id' : 'assigned_sales_id';
    return [`${sql} AND ${subscriberAlias}.${column}=?`, [...params, scope.staffId]];
  }
  return [sql, params];
}

// GET /api/admin/orders
router.get('/api/admin/orders', requireAuth, requireAdminOrStaff, requirePermission('view_orders'), async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 500, 2000);
    const scope = resolveFinancialScope(req, {
      requestedBranch: req.query.branch || null,
      allowAssigned: true,
    });
    let orderWhere = 'o.tenant_id=? AND o.deleted_at IS NULL';
    let orderParams = [req.tenantId];
    [orderWhere, orderParams] = appendScope(orderWhere, orderParams, scope, 'o');
    const [rows] = await pool.query(
      `SELECT o.id, o.type, o.item_id, o.item_title, o.amount, o.currency, o.payment_method, o.customer_name,
       o.customer_email, o.customer_phone, o.status, o.transaction_id, o.coupon_code, o.subscriber_id,
       o.course_id, o.bundle_id, o.notes, o.staff_id, o.staff_name, o.branch_id, o.created_at, o.paid_at, o.linked_transfer_id
       FROM orders o
       LEFT JOIN subscribers s ON s.id=o.subscriber_id AND s.tenant_id=o.tenant_id
       WHERE ${orderWhere} ORDER BY o.created_at DESC LIMIT ?`, [...orderParams, limit]);

    let paymentWhere = 'p.tenant_id=? AND p.deleted_at IS NULL AND p.amount > 0';
    let paymentParams = [req.tenantId];
    [paymentWhere, paymentParams] = appendScope(paymentWhere, paymentParams, scope, 'p');
    const [payRows] = await pool.query(
      `SELECT p.id, p.subscriber_id, p.course_id, p.bundle_id, p.amount, p.currency,
               p.payment_type, p.payment_method, p.transaction_id, p.is_installment, p.date, p.note,
               p.staff_id, p.status, p.branch_id,
               s.name AS customer_name, s.email AS customer_email, s.phone AS customer_phone,
               u.name AS staff_name
       FROM payments p
       LEFT JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=p.tenant_id
       LEFT JOIN users u ON u.id=p.staff_id AND u.tenant_id=p.tenant_id
       WHERE ${paymentWhere}
       ORDER BY p.date DESC LIMIT ?`,
      [...paymentParams, limit]
    );

    const existingTxnIds = new Set(rows.map(r => r.transaction_id).filter(Boolean));
    const existingIds = new Set(rows.map(r => r.id));

    const crmOrders = payRows
      .filter(p => !existingIds.has(p.id) && !(p.transaction_id && existingTxnIds.has(p.transaction_id)))
      .map(p => ({
        id: p.id,
        subscriber_id: p.subscriber_id,
        item_id: p.course_id || p.bundle_id || '',
        item_title: p.note ? `${(p.payment_type || '').toLowerCase()} — ${p.note}`.slice(0, 80) : (p.payment_type || 'دفعة يدوية'),
        type: (p.payment_type || 'course').toLowerCase(),
        status: p.status || 'paid',
        amount: Number(p.amount) || 0,
        currency: p.currency || 'EGP',
        payment_method: p.payment_method || 'MANUAL',
        customer_name: p.customer_name || '',
        customer_email: p.customer_email || '',
        customer_phone: p.customer_phone || '',
        transaction_id: p.transaction_id || null,
        staff_id: p.staff_id || null,
        staff_name: p.staff_name || null,
        branch_id: p.branch_id || null,
        notes: p.note || null,
        created_at: safeIsoString(p.date) || new Date().toISOString(),
        linked_transfer_id: null,
        source: 'crm',
      }));

    res.json([...rows, ...crmOrders]);
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/orders
router.post('/api/admin/orders', requireAuth, requireAdminOrStaff, requirePermission('manage_orders'), async (req, res) => {
  try {
    const o = req.body;
    // Validate the NOT-NULL columns so bad input returns a clear 400 instead of a
    // DB 500 (orders.item_id is NOT NULL). Status/type keep the app's existing
    // lowercase convention (the PATCH flow compares status === 'paid').
    const itemId = o.item_id || o.itemId || null;
    const itemTitle = o.item_title || o.itemTitle || '';
    const amount = Number(o.amount);
    if (!itemId) return res.status(400).json({ error: 'item_id مطلوب' });
    if (!itemTitle) return res.status(400).json({ error: 'item_title مطلوب' });
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'amount غير صالح' });
    // Same protection as PATCH (PAY-07): financial statuses need a real
    // payments row + journal entry via confirm-payment/refund, not a bare
    // status value on insert — otherwise this bypasses that guard entirely
    // and creates a "paid" order with no corresponding payment/journal.
    const requestedStatus = String(o.status || 'pending').toLowerCase();
    if (['paid', 'refunded'].includes(requestedStatus)) {
      return res.status(409).json({ error: 'Use payment approval/refund workflow for financial statuses' });
    }
    const id = o.id || uuidv4();
    const requestedBranch = o.branch || null;
    const scope = resolveFinancialScope(req, { requestedBranch, allowAssigned: true });
    if (o.subscriber_id) {
      const [[subscriber]] = await pool.query(
        `SELECT id, branch_id, assigned_sales_id, assigned_cs_id
         FROM subscribers WHERE tenant_id=? AND id=? LIMIT 1`,
        [req.tenantId, o.subscriber_id]
      );
      if (!subscriber || !financialRecordMatches(scope, subscriber)) {
        return res.status(403).json({ error: 'Subscriber is outside your financial scope' });
      }
    } else if (!['all', 'branch'].includes(scope.kind)) {
      return res.status(403).json({ error: 'Assigned staff must link the order to an assigned subscriber' });
    }
    let staffName = o.staff_name || null;
    if (!staffName && o.staff_id) {
      const [[u]] = await pool.query('SELECT name FROM staff WHERE id = ? AND tenant_id = ? LIMIT 1', [o.staff_id, req.tenantId]).catch(() => [[null]]);
      if (u) staffName = u.name || null;
    }
    await pool.query(
      `INSERT INTO orders (id, subscriber_id, item_id, item_title, type, status, amount,
         currency, payment_method, notes, staff_id, staff_name, tenant_id, branch_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE status=VALUES(status), notes=VALUES(notes), staff_id=VALUES(staff_id), staff_name=VALUES(staff_name), updated_at=CURRENT_TIMESTAMP`,
      [id, o.subscriber_id || null, itemId, itemTitle, o.type || 'course',
       requestedStatus, amount, o.currency || 'EGP', o.payment_method || 'CARD',
       o.notes || null, o.staff_id || null, staffName, req.tenantId,
       scope.branchId || o.branch_id || 'branch-other', o.created_at || new Date().toISOString()]
    );
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/orders/:id/confirm-payment — the real "confirm payment" /
// "link to transfer" workflow. PATCH deliberately rejects setting status to
// paid/refunded (financial statuses need a real payments row + journal
// entry, not a bare status flip) — but until this endpoint existed, the
// admin UI's "Confirm Payment" button and both transfer-linking modals still
// called the generic PATCH with status:'paid', so every one of them just
// received a 409 and silently did nothing (PAY-02). This creates the actual
// payment (ensuring a subscriber exists first, exactly like the Paymob/
// manual-transfer-proof paths — PAY-16/LMS-01's ensureSubscriberForOrder),
// posts the journal entry, grants enrollment for a course/bundle order, and
// — when linking to a recorded transfer — marks that transfer consumed so
// the same transfer can never confirm two different orders (closing PAY-06:
// a single transfer being reusable across multiple orders was never actually
// enforced despite migration 022's comment saying that was the intent).
router.post('/api/admin/orders/:id/confirm-payment', requireAuth, requireAdminOrStaff, requirePermission('manage_payments'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { linkedTransferId } = req.body || {};
    await conn.beginTransaction();

    const [[order]] = await conn.query(
      'SELECT * FROM orders WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!order) { await conn.rollback(); return res.status(404).json({ error: 'Order not found' }); }
    const [[subscriber]] = order.subscriber_id
      ? await conn.query(
        'SELECT id, branch_id, assigned_sales_id, assigned_cs_id FROM subscribers WHERE tenant_id=? AND id=? LIMIT 1',
        [req.tenantId, order.subscriber_id]
      )
      : [null];
    const scope = resolveFinancialScope(req, { allowAssigned: true });
    if (!financialRecordMatches(scope, subscriber || order)) {
      await conn.rollback();
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.staff_id && String(order.staff_id) === String(req.staffRecord?.id || '')) {
      await conn.rollback();
      return res.status(403).json({ error: 'The employee who recorded an order cannot approve its payment' });
    }
    if (String(order.status).toLowerCase() !== 'pending') {
      await conn.rollback();
      return res.status(409).json({ error: 'Order is not pending — it may already be confirmed' });
    }

    let transfer = null;
    if (linkedTransferId) {
      const [[existingLink]] = await conn.query(
        'SELECT id FROM orders WHERE linked_transfer_id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
        [linkedTransferId, req.tenantId]
      );
      if (existingLink) { await conn.rollback(); return res.status(409).json({ error: 'This transfer is already linked to another order' }); }
      [[transfer]] = await conn.query(
        `SELECT * FROM orders WHERE id=? AND tenant_id=? AND type='transfer' AND status='paid' LIMIT 1 FOR UPDATE`,
        [linkedTransferId, req.tenantId]
      );
      if (!transfer) { await conn.rollback(); return res.status(404).json({ error: 'Transfer not found' }); }
    }

    await assertWritable(new Date().toISOString().slice(0, 10), conn, req.tenantId);

    const { paymentId } = await confirmOrderPayment({
      order, transfer, linkedTransferId, tenantId: req.tenantId,
      staffId: req.staffRecord?.id, staffName: req.staffRecord?.name, actorEmail: req.user?.email,
    }, conn);

    await conn.commit();
    res.json({ ok: true, paymentId });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

// PATCH /api/admin/orders/:id
router.patch('/api/admin/orders/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_orders'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    let newStatus;
    try { newStatus = normalizeJourneyState('order', req.body.status || 'pending'); }
    catch (error) { return res.status(error.statusCode || 400).json({ error: error.message }); }
    if (['paid', 'refunded'].includes(newStatus)) {
      return res.status(409).json({ error: 'Use payment approval/refund workflow for financial statuses' });
    }
    // order.status and payments.status must never diverge — one transaction, all or nothing.
    await conn.beginTransaction();
    const [[order]] = await conn.query(
      `SELECT o.id,o.status,o.branch_id,o.subscriber_id,s.assigned_sales_id,s.assigned_cs_id
       FROM orders o
       LEFT JOIN subscribers s ON s.id=o.subscriber_id AND s.tenant_id=o.tenant_id
       WHERE o.id=? AND o.tenant_id=? AND o.deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [req.params.id, req.tenantId]
    );
    if (!order) { await conn.rollback(); return res.status(404).json({ error: 'Order not found' }); }
    const scope = resolveFinancialScope(req, { allowAssigned: true });
    if (!financialRecordMatches(scope, order)) {
      await conn.rollback();
      return res.status(404).json({ error: 'Order not found' });
    }
    const [[linkedPayment]] = await conn.query(
      `SELECT id FROM payments
       WHERE tenant_id=? AND deleted_at IS NULL
         AND (id=? OR id=(SELECT transaction_id FROM orders WHERE tenant_id=? AND id=?)
           OR transaction_id=(SELECT transaction_id FROM orders WHERE tenant_id=? AND id=?))
       LIMIT 1 FOR UPDATE`,
      [req.tenantId, req.params.id, req.tenantId, req.params.id, req.tenantId, req.params.id]
    );
    if (linkedPayment || ['paid', 'refunded'].includes(String(order.status || '').toLowerCase())) {
      await conn.rollback();
      return res.status(409).json({ error: 'Financial order status must change through payment or refund workflow' });
    }
    await conn.query(
      'UPDATE orders SET status=? WHERE id=? AND tenant_id=? AND deleted_at IS NULL',
      [newStatus, req.params.id, req.tenantId]
    );
    // Record the transfer↔payment reconciliation link when the accountant matches them.
    if (Object.prototype.hasOwnProperty.call(req.body, 'linked_transfer_id')) {
      await conn.query('UPDATE orders SET linked_transfer_id=? WHERE id=? AND tenant_id=?', [req.body.linked_transfer_id || null, req.params.id, req.tenantId]);
    }
    await conn.commit();
    logPaymentAudit(req.params.id, 'order_status', order.status, newStatus, null, order.subscriber_id || null, req.user?.email || req.user?.uid, req.tenantId).catch(() => {});
    // P1 CLOSED: the crm_json.paymentHistory status-mirror was removed — the
    // payments table (updated in the transaction above) is the single source of
    // truth and every reader rebuilds paymentHistory from it, so mirroring the
    // status into the stale crm_json copy only re-created divergence risk.
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

// DELETE /api/admin/orders/:id
router.delete('/api/admin/orders/:id', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query(
      'SELECT id, status FROM orders WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    const [[delPay]] = await conn.query(
      'SELECT id, status, amount, subscriber_id FROM payments WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    ).catch(() => [[null]]);
    if (!order && !delPay) { await conn.rollback(); return res.status(404).json({ error: 'Not found' }); }
    const hasFinancialHistory = ['PAID', 'REFUNDED'].includes(String(order?.status || '').toUpperCase())
      || ['paid', 'refunded'].includes(String(delPay?.status || '').toLowerCase());
    if (hasFinancialHistory) {
      await conn.rollback();
      return res.status(409).json({ error: 'لا يمكن حذف عملية مالية. استخدم الاسترداد أو قيد عكسي للحفاظ على الأثر المحاسبي.' });
    }
    await conn.query('UPDATE orders SET deleted_at=NOW() WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    if (delPay) await conn.query('UPDATE payments SET deleted_at=NOW() WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    await conn.commit();
    logPaymentAudit(req.params.id, 'archive', delPay?.status || order?.status || null, null, delPay?.amount || null, delPay?.subscriber_id || null, req.user?.email || req.user?.uid, req.tenantId).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

// ── Abandoned checkouts (marketing recovery) ─────────────────────────────────
// Orders that started checkout (status PENDING) older than N hours and were never paid —
// prime targets for a WhatsApp/email recovery nudge. Excludes carts later paid (same phone+item).
router.get('/api/admin/abandoned-checkouts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const hours = Math.min(720, Math.max(1, parseInt(req.query.hours, 10) || 2));
    const [rows] = await pool.query(
      `SELECT o.id, o.type, o.item_id, o.item_title, o.amount, o.currency,
              o.customer_name, o.customer_email, o.customer_phone, o.subscriber_id, o.created_at
       FROM orders o
       WHERE o.status = 'pending' AND o.tenant_id=? AND o.deleted_at IS NULL
         AND o.created_at <= DATE_SUB(NOW(), INTERVAL ? HOUR)
         AND o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         AND NOT EXISTS (
           SELECT 1 FROM orders p
           WHERE p.status = 'paid' AND p.tenant_id=o.tenant_id AND p.deleted_at IS NULL AND p.item_id = o.item_id
             AND (p.customer_phone = o.customer_phone OR p.customer_email = o.customer_email)
         )
       ORDER BY o.created_at DESC LIMIT 300`, [req.tenantId, hours]);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Customer-owned orders are the only valid source for manual payment proofs.
router.get('/api/me/orders', requireAuth, async (req, res) => {
  try {
    // A WhatsApp-only client has no email in the token; rejecting on that used to
    // hide their entire order history behind a 400.
    const subscriber = await resolveSubscriberRow(req, ['id', 'email']);
    const email = String(subscriber?.email || req.user?.email || '').toLowerCase().trim();
    if (!subscriber && !email) return res.json([]);
    // Two independent ownership proofs, either of which is sufficient. Both are
    // guarded so a null identity can never widen into "every unowned order".
    const clauses = [];
    const params = [req.tenantId];
    if (subscriber?.id) { clauses.push('o.subscriber_id=?'); params.push(subscriber.id); }
    if (email) { clauses.push("(o.subscriber_id IS NULL AND LOWER(TRIM(o.customer_email))=?)"); params.push(email); }
    const [rows] = await pool.query(
      `SELECT o.id, o.item_id, o.item_title, o.type, o.status, o.amount, o.currency,
              o.payment_method, o.created_at, o.paid_at
       FROM orders o
       WHERE o.tenant_id=? AND o.deleted_at IS NULL AND (${clauses.join(' OR ')})
       ORDER BY o.created_at DESC LIMIT 100`,
      params
    );
    res.json(rows);
  } catch (error) {
    logger.error('[me/orders]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
