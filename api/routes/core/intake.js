'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../lib/logger');
const { pool } = require('../../lib/db');
const { requireAuth, requireAdminOrStaff } = require('../../middleware/auth');

router.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

router.get('/api/admin/subscribers/:id/payments', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const [[subscriber]] = await pool.query('SELECT id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, tenantId]);
    if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });
    const [rows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency, payment_type,
              payment_method, transaction_id, is_installment, date, note, status, staff_id,
              staff_name, from_account, source, item_title, cert_type, branch
         FROM payments
        WHERE subscriber_id=? AND tenant_id=? AND deleted_at IS NULL
        ORDER BY date ASC`,
      [req.params.id, tenantId]
    );
    res.json(rows.map(payment => ({
      id: payment.id,
      amount: Number(payment.amount) || 0,
      currency: payment.currency || 'EGP',
      paymentType: String(payment.payment_type || 'other').toLowerCase(),
      paymentMethod: payment.payment_method || null,
      transactionId: payment.transaction_id || null,
      isInstallment: Boolean(payment.is_installment),
      courseId: payment.course_id || null,
      bundleId: payment.bundle_id || null,
      note: payment.note || null,
      at: payment.date instanceof Date ? payment.date.toISOString().slice(0, 10) : String(payment.date || '').slice(0, 10),
      status: payment.status || 'paid',
      staffId: payment.staff_id || null,
      staffName: payment.staff_name || null,
      fromAccountNumber: payment.from_account || null,
      source: payment.source || null,
      itemTitle: payment.item_title || null,
      certType: payment.cert_type || null,
      branch: payment.branch || null,
    })));
  } catch (error) {
    logger.error('[subscriber-payments]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
