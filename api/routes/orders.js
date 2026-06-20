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
       course_id, bundle_id, notes, staff_id, staff_name, created_at, paid_at
       FROM orders ORDER BY created_at DESC LIMIT ?`, [limit]);

    const [payRows] = await pool.query(
      `SELECT p.id, p.subscriber_id, p.course_id, p.bundle_id, p.amount, p.currency,
              p.payment_type, p.payment_method, p.transaction_id, p.is_installment, p.date, p.note,
              p.staff_id, p.status,
              s.name AS customer_name, s.email AS customer_email, s.phone AS customer_phone,
              u.name AS staff_name
       FROM payments p
       LEFT JOIN subscribers s ON s.id = p.subscriber_id
       LEFT JOIN users u ON u.id = p.staff_id
       WHERE p.amount > 0
       ORDER BY p.date DESC LIMIT ?`,
      [limit]
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
    const id = o.id || uuidv4();
    let staffName = o.staff_name || null;
    if (!staffName && o.staff_id) {
      const [[u]] = await pool.query('SELECT name FROM staff WHERE id = ? LIMIT 1', [o.staff_id]).catch(() => [[null]]);
      if (u) staffName = u.name || null;
    }
    await pool.query(
      `INSERT INTO orders (id, subscriber_id, item_id, item_title, type, status, amount,
         currency, payment_method, notes, staff_id, staff_name, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE status=VALUES(status), notes=VALUES(notes), staff_id=VALUES(staff_id), staff_name=VALUES(staff_name), updated_at=CURRENT_TIMESTAMP`,
      [id, o.subscriber_id || null, o.item_id || null, o.item_title || '', o.type || 'course',
       o.status || 'pending', o.amount || 0, o.currency || 'EGP', o.payment_method || 'CARD',
       o.notes || null, o.staff_id || null, staffName, o.created_at || new Date().toISOString()]
    );
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/admin/orders/:id
router.patch('/api/admin/orders/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const newStatus = req.body.status || 'pending';
    const [[oldPay]] = await pool.query('SELECT status, amount, subscriber_id FROM payments WHERE id=? LIMIT 1', [req.params.id]).catch(() => [[null]]);
    await pool.query('UPDATE orders SET status=? WHERE id=?', [newStatus, req.params.id]);
    await pool.query('UPDATE payments SET status=? WHERE id=?', [newStatus, req.params.id]).catch(() => {});
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
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/orders/:id
router.delete('/api/admin/orders/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[delPay]] = await pool.query('SELECT status, amount, subscriber_id FROM payments WHERE id=? LIMIT 1', [req.params.id]).catch(() => [[null]]);
    await pool.query('DELETE FROM orders WHERE id = ?', [req.params.id]);
    await pool.query('DELETE FROM payments WHERE id = ?', [req.params.id]).catch(() => {});
    logPaymentAudit(req.params.id, 'delete', delPay?.status || null, null, delPay?.amount || null, delPay?.subscriber_id || null, req.user?.email || req.user?.uid).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
