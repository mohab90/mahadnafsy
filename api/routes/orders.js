'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { parseLimit } = require('../lib/helpers');
const { logPaymentAudit } = require('../lib/finance');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { safeIsoString } = require('../lib/dates');


// GET /api/admin/orders
router.get('/api/admin/orders', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 500, 2000);
    const [rows] = await pool.query(
      `SELECT id, type, item_id, item_title, amount, currency, payment_method, customer_name,
       customer_email, customer_phone, status, transaction_id, coupon_code, subscriber_id,
       course_id, bundle_id, notes, staff_id, staff_name, created_at, paid_at, linked_transfer_id
       FROM orders WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`, [req.tenantId, limit]);

    const [payRows] = await pool.query(
      `SELECT p.id, p.subscriber_id, p.course_id, p.bundle_id, p.amount, p.currency,
              p.payment_type, p.payment_method, p.transaction_id, p.is_installment, p.date, p.note,
              p.staff_id, p.status,
              s.name AS customer_name, s.email AS customer_email, s.phone AS customer_phone,
              u.name AS staff_name
       FROM payments p
       LEFT JOIN subscribers s ON s.id = p.subscriber_id
       LEFT JOIN users u ON u.id = p.staff_id
       WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND p.amount > 0
       ORDER BY p.date DESC LIMIT ?`,
      [req.tenantId, limit]
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
router.post('/api/admin/orders', requireAuth, requireAdmin, async (req, res) => {
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
    const id = o.id || uuidv4();
    let staffName = o.staff_name || null;
    if (!staffName && o.staff_id) {
      const [[u]] = await pool.query('SELECT name FROM staff WHERE id = ? LIMIT 1', [o.staff_id]).catch(() => [[null]]);
      if (u) staffName = u.name || null;
    }
    await pool.query(
      `INSERT INTO orders (id, subscriber_id, item_id, item_title, type, status, amount,
         currency, payment_method, notes, staff_id, staff_name, tenant_id, branch_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE status=VALUES(status), notes=VALUES(notes), staff_id=VALUES(staff_id), staff_name=VALUES(staff_name), updated_at=CURRENT_TIMESTAMP`,
      [id, o.subscriber_id || null, itemId, itemTitle, o.type || 'course',
       o.status || 'pending', amount, o.currency || 'EGP', o.payment_method || 'CARD',
       o.notes || null, o.staff_id || null, staffName, req.tenantId,
       o.branch_id || 'branch-other', o.created_at || new Date().toISOString()]
    );
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/admin/orders/:id
router.patch('/api/admin/orders/:id', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const newStatus = String(req.body.status || 'pending').toLowerCase();
    if (['paid', 'refunded'].includes(newStatus)) {
      return res.status(409).json({ error: 'Use payment approval/refund workflow for financial statuses' });
    }
    if (!['pending', 'failed', 'cancelled', 'canceled'].includes(newStatus)) {
      return res.status(400).json({ error: 'Invalid order status' });
    }
    // order.status and payments.status must never diverge — one transaction, all or nothing.
    await conn.beginTransaction();
    const [[oldPay]] = await conn.query('SELECT status, amount, subscriber_id FROM payments WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [req.params.id, req.tenantId]).catch(() => [[null]]);
    await conn.query('UPDATE orders SET status=? WHERE id=? AND tenant_id=? AND deleted_at IS NULL', [newStatus, req.params.id, req.tenantId]);
    // Record the transfer↔payment reconciliation link when the accountant matches them.
    if (Object.prototype.hasOwnProperty.call(req.body, 'linked_transfer_id')) {
      await conn.query('UPDATE orders SET linked_transfer_id=? WHERE id=? AND tenant_id=?', [req.body.linked_transfer_id || null, req.params.id, req.tenantId]);
    }
    await conn.query('UPDATE payments SET status=? WHERE id=? AND tenant_id=? AND deleted_at IS NULL', [newStatus, req.params.id, req.tenantId]);
    await conn.commit();
    logPaymentAudit(req.params.id, 'update', oldPay?.status || null, newStatus, oldPay?.amount || null, oldPay?.subscriber_id || null, req.user?.email || req.user?.uid).catch(() => {});
    if (newStatus === 'paid' || newStatus === 'failed') {
      setImmediate(async () => {
        const [[pay]] = await pool.query('SELECT subscriber_id FROM payments WHERE id=? LIMIT 1', [req.params.id]).catch(() => [[null]]);
        if (!pay) return;
        const [[sub]] = await pool.query('SELECT id, crm_json FROM subscribers WHERE id=? LIMIT 1', [pay.subscriber_id]).catch(() => [[null]]);
        if (!sub) return;
        let crm = {};
        try { crm = JSON.parse(sub.crm_json || '{}'); } catch { crm = {}; }
        const ph = crm.paymentHistory || [];
        const idx = ph.findIndex(p => p.id === req.params.id);
        if (idx !== -1) {
          ph[idx] = { ...ph[idx], status: newStatus };
          crm.paymentHistory = ph;
          await pool.query('UPDATE subscribers SET crm_json=? WHERE id=?', [JSON.stringify(crm), sub.id]).catch(() => {});
        }
      });
    }
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
    logPaymentAudit(req.params.id, 'archive', delPay?.status || order?.status || null, null, delPay?.amount || null, delPay?.subscriber_id || null, req.user?.email || req.user?.uid).catch(() => {});
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
       WHERE o.status = 'PENDING' AND o.tenant_id=? AND o.deleted_at IS NULL
         AND o.created_at <= DATE_SUB(NOW(), INTERVAL ? HOUR)
         AND o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         AND NOT EXISTS (
           SELECT 1 FROM orders p
           WHERE p.status = 'PAID' AND p.tenant_id=o.tenant_id AND p.deleted_at IS NULL AND p.item_id = o.item_id
             AND (p.customer_phone = o.customer_phone OR p.customer_email = o.customer_email)
         )
       ORDER BY o.created_at DESC LIMIT 300`, [req.tenantId, hours]);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Customer-owned orders are the only valid source for manual payment proofs.
router.get('/api/me/orders', requireAuth, async (req, res) => {
  try {
    const email = String(req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    const [[subscriber]] = await pool.query(
      'SELECT id FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1',
      [req.tenantId, email]
    );
    const [rows] = await pool.query(
      `SELECT o.id, o.item_id, o.item_title, o.type, o.status, o.amount, o.currency,
              o.payment_method, o.created_at, o.paid_at
       FROM orders o
       WHERE o.tenant_id=? AND o.deleted_at IS NULL
         AND (o.subscriber_id=? OR (o.subscriber_id IS NULL AND LOWER(TRIM(o.customer_email))=?))
       ORDER BY o.created_at DESC LIMIT 100`,
      [req.tenantId, subscriber?.id || '', email]
    );
    res.json(rows);
  } catch (error) {
    logger.error('[me/orders]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
