'use strict';
/**
 * The client's own payments, from their dashboard and the page Paymob returns to.
 *
 *   GET  /api/me/installments                              the client's plans, each entry with what it still owes
 *   POST /api/me/installments/:planId/entries/:index/checkout
 *                                                          an order for exactly that entry — paid by card through
 *                                                          /api/payments/paymob-init, or by a receipt through
 *                                                          /api/me/payment-proof (lib/planEntryPayment.js)
 *   GET  /api/me/orders/:id/status                         one of the client's orders, for /success to follow
 *
 * The second and third instalments were paid by writing on WhatsApp and waiting
 * for the desk: «ادفع القسط» opened a chat with the amount typed in. The amount
 * is the plan's — what the entry still owes — and only the plan's own client
 * can open an order for it.
 */
const express = require('express');
const router = express.Router();
const logger = require('../lib/logger').child({ module: 'me-payments-route' });
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { requireAuth } = require('../middleware/auth');
const { resolveSubscriberRow } = require('../lib/subscriberIdentity');
const { planEntries } = require('../lib/installmentMath');
const { PLAN_ENTRY_MODE, entryDue } = require('../lib/planEntryPayment');
const { branchIdForBranch } = require('../lib/branches');
const { attributionFromRequest, attributionValues } = require('../lib/visitAttribution');
const { adContextFromRequest } = require('../lib/metaCapi');

const PLAN_COLUMNS = `ip.id, ip.subscriber_id, ip.course_id, ip.bundle_id, ip.title, ip.total_amount, ip.currency,
  ip.installments_count, ip.installment_amounts, ip.due_dates, ip.paid_dates, ip.paid_amounts, ip.status,
  COALESCE(c.title_ar, c.title, b.title, ip.title) AS course_title`;

// The pending orders this client opened for plan entries, keyed «plan:index»,
// with the receipt waiting on each (its review is «قيد المراجعة»).
async function pendingEntryOrders(db, { tenantId, subscriberId }) {
  const [rows] = await db.query(
    `SELECT o.id, o.amount, o.currency, o.notes, o.created_at,
            (SELECT pp.status FROM payment_proofs pp WHERE pp.order_id=o.id AND pp.tenant_id=o.tenant_id
               AND pp.status IN ('PENDING','APPROVED') ORDER BY pp.submitted_at DESC LIMIT 1) AS proof_status,
            (SELECT pp.review_due_at FROM payment_proofs pp WHERE pp.order_id=o.id AND pp.tenant_id=o.tenant_id
               AND pp.status='PENDING' ORDER BY pp.submitted_at DESC LIMIT 1) AS review_due_at
       FROM orders o
      WHERE o.tenant_id=? AND o.subscriber_id=? AND o.status='pending' AND o.deleted_at IS NULL
        AND JSON_VALID(o.notes) AND JSON_VALUE(o.notes, '$.payMode')=?
      ORDER BY o.created_at DESC`,
    [tenantId, subscriberId, PLAN_ENTRY_MODE]
  );
  const byEntry = new Map();
  for (const row of rows) {
    let notes = {};
    try { notes = JSON.parse(row.notes); } catch { notes = {}; }
    const key = `${notes.planId}:${notes.entryIndex}`;
    if (!byEntry.has(key)) byEntry.set(key, row);
  }
  return byEntry;
}

router.get('/api/me/installments', requireAuth, async (req, res) => {
  try {
    const sub = await resolveSubscriberRow(req, ['id']);
    if (!sub) return res.json({ plans: [] });
    const [rows] = await pool.query(
      `SELECT ${PLAN_COLUMNS}
         FROM installment_plans ip
         LEFT JOIN courses c ON c.id=ip.course_id AND c.tenant_id=ip.tenant_id
         LEFT JOIN bundles b ON b.id=ip.bundle_id AND b.tenant_id=ip.tenant_id
        WHERE ip.tenant_id=? AND ip.subscriber_id=? AND COALESCE(ip.status,'active')<>'cancelled'
        ORDER BY ip.created_at DESC`,
      [req.tenantId, sub.id]
    );
    const pending = await pendingEntryOrders(pool, { tenantId: req.tenantId, subscriberId: sub.id });
    const plans = rows.map(plan => ({
      id: plan.id,
      courseId: plan.course_id || null,
      bundleId: plan.bundle_id || null,
      title: plan.course_title || plan.title || '',
      totalAmount: Number(plan.total_amount) || 0,
      currency: plan.currency || 'EGP',
      entries: planEntries(plan).map((entry, index) => {
        let due = 0;
        try { due = entryDue(plan, index).amount; } catch { due = 0; }
        const order = pending.get(`${plan.id}:${index}`);
        return {
          index, amount: entry.amount, dueDate: entry.dueDate, paidAt: entry.paidAt || null,
          partialPaid: entry.partialPaid || 0, due,
          // A receipt the accounts have not reviewed yet: no second payment for it.
          underReview: order?.proof_status === 'PENDING',
          reviewDueAt: order?.review_due_at || null,
        };
      }),
    }));
    res.json({ plans });
  } catch (e) {
    logger.error('[me/installments]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/me/installments/:planId/entries/:index/checkout', requireAuth, async (req, res) => {
  let conn;
  let transactionStarted = false;
  try {
    const index = Number.parseInt(req.params.index, 10);
    const method = req.body?.method === 'transfer' ? 'transfer' : 'card';
    const sub = await resolveSubscriberRow(req, ['id', 'name', 'email', 'phone', 'branch', 'branch_id']);
    if (!sub) return res.status(404).json({ error: 'مش لاقيين حسابك كعميل — كلمنا على واتساب', code: 'NOT_A_CLIENT' });
    conn = await pool.getConnection();
    await conn.beginTransaction();
    transactionStarted = true;
    // Only the client's own plan: anybody else's reads as not there.
    const [[plan]] = await conn.query(
      `SELECT ${PLAN_COLUMNS}
         FROM installment_plans ip
         LEFT JOIN courses c ON c.id=ip.course_id AND c.tenant_id=ip.tenant_id
         LEFT JOIN bundles b ON b.id=ip.bundle_id AND b.tenant_id=ip.tenant_id
        WHERE ip.id=? AND ip.tenant_id=? AND ip.subscriber_id=? LIMIT 1 FOR UPDATE`,
      [req.params.planId, req.tenantId, sub.id]
    );
    if (!plan) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'الخطة دي مش موجودة في حسابك', code: 'PLAN_NOT_FOUND' });
    }
    const due = entryDue(plan, index);
    if (!['EGP', 'SAR', 'USD'].includes(due.currency)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'عملة الخطة مش مدعومة للدفع من الموقع — كلمنا على واتساب', code: 'PLAN_CURRENCY_UNSUPPORTED' });
    }

    const pending = await pendingEntryOrders(conn, { tenantId: req.tenantId, subscriberId: sub.id });
    const open = pending.get(`${plan.id}:${index}`);
    if (open?.proof_status === 'PENDING') {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({
        error: 'إيصال القسط ده قيد المراجعة — هنأكده ونبلغك', code: 'ENTRY_UNDER_REVIEW', reviewDueAt: open.review_due_at || null,
      });
    }
    // The order already open for this entry, while it still asks for what the entry owes.
    let orderId = open && Math.abs(Number(open.amount) - due.amount) < 0.01 && String(open.currency) === due.currency ? open.id : null;
    const count = planEntries(plan).length;
    const itemTitle = `القسط ${index + 1} من ${count} — ${plan.course_title || plan.title || 'خطة أقساط'}`.slice(0, 500);
    if (!orderId) {
      orderId = uuidv4();
      const type = plan.course_id ? 'COURSE' : (plan.bundle_id ? 'BUNDLE' : 'OTHER');
      const notes = JSON.stringify({
        checkout: PLAN_ENTRY_MODE, payMode: PLAN_ENTRY_MODE, planId: plan.id, entryIndex: index,
        adContext: adContextFromRequest(req),
      });
      await conn.query(
        `INSERT INTO orders
           (id, subscriber_id, item_id, item_title, type, status, amount, currency, payment_method,
            customer_name, customer_email, customer_phone, course_id, bundle_id, notes, tenant_id, branch_id,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid, created_at)
         VALUES (?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
        [orderId, sub.id, plan.course_id || plan.bundle_id || 'installment', itemTitle, type, due.amount, due.currency,
         method === 'card' ? 'paymob' : 'TRANSFER',
         String(sub.name || 'عميل').slice(0, 255), sub.email || null, sub.phone || null,
         plan.course_id || null, plan.bundle_id || null, notes, req.tenantId,
         sub.branch_id || branchIdForBranch(sub.branch || 'ONLINE_EGYPT'),
         ...attributionValues(attributionFromRequest(req))]
      );
    }
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, orderId, amount: due.amount, currency: due.currency, itemTitle, method });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    if (e.statusCode >= 400 && e.statusCode < 500) return res.status(e.statusCode).json({ error: e.message, code: e.code });
    logger.error('[me/installments/checkout]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (conn) conn.release();
  }
});

// What /success waits on: the order Paymob returned to, as it stands. Paymob's
// redirect only says what the bank answered; the verified callback is what marks
// the order paid, and it may land a few seconds after the customer does.
router.get('/api/me/orders/:id/status', requireAuth, async (req, res) => {
  try {
    const sub = await resolveSubscriberRow(req, ['id', 'email']);
    const email = String(sub?.email || req.user?.email || '').toLowerCase().trim();
    if (!sub && !email) return res.status(404).json({ error: 'Order not found' });
    const [[order]] = await pool.query(
      `SELECT o.id, o.status, o.type, o.item_id, o.item_title, o.amount, o.currency, o.course_id, o.bundle_id, o.notes, o.paid_at
         FROM orders o
        WHERE o.id=? AND o.tenant_id=? AND o.deleted_at IS NULL
          AND ((? <> '' AND o.subscriber_id=?) OR (o.subscriber_id IS NULL AND ? <> '' AND LOWER(o.customer_email)=?))
        LIMIT 1`,
      [String(req.params.id).split('~')[0], req.tenantId, sub?.id || '', sub?.id || '', email, email]
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const [[proof]] = await pool.query(
      `SELECT status, review_due_at FROM payment_proofs WHERE order_id=? AND tenant_id=?
        ORDER BY submitted_at DESC LIMIT 1`, [order.id, req.tenantId]);
    let notes = {};
    try { notes = JSON.parse(order.notes || '{}') || {}; } catch { notes = {}; }
    const type = String(order.type || '').toLowerCase();
    const courseId = order.course_id || (type === 'course' ? order.item_id : null);
    const bundleId = order.bundle_id || (type === 'bundle' ? order.item_id : null);
    // The course to start: the order's own, or a path's first.
    let startCourseId = courseId;
    if (!startCourseId && bundleId) {
      const [[first]] = await pool.query(
        `SELECT bc.course_id FROM bundle_courses bc WHERE bc.tenant_id=? AND bc.bundle_id=?
          ORDER BY bc.sort_order, bc.course_id LIMIT 1`, [req.tenantId, bundleId]);
      startCourseId = first?.course_id || null;
    }
    res.json({
      id: order.id,
      status: String(order.status || 'pending').toLowerCase(),
      type,
      itemTitle: order.item_title || '',
      amount: Number(order.amount) || 0,
      currency: order.currency || 'EGP',
      courseId, bundleId, startCourseId,
      planEntry: notes.payMode === PLAN_ENTRY_MODE,
      proof: proof ? { status: proof.status, reviewDueAt: proof.review_due_at || null } : null,
    });
  } catch (e) {
    logger.error('[me/orders/status]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
