'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../lib/logger');
const { pool } = require('../../lib/db');
const { tryJson } = require('../../lib/helpers');
const { postPaymentJournal } = require('../../lib/finance');
const { requireAuth, requireAdmin } = require('../../middleware/auth');

router.post('/api/admin/backfill-payments', requireAuth, requireAdmin, async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'confirm=true required' });
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const [subscribers] = await conn.query(
      'SELECT id, branch, branch_id, crm_json FROM subscribers WHERE tenant_id=? AND crm_json IS NOT NULL LIMIT 5000',
      [tenantId]
    );
    await conn.beginTransaction();
    transactionStarted = true;
    let inserted = 0;
    let skipped = 0;
    const validTypes = new Set(['COURSE', 'BUNDLE', 'CERTIFICATE', 'CONSULTATION', 'BOOK', 'CARNEH', 'OTHER']);
    for (const subscriber of subscribers) {
      const history = tryJson(subscriber.crm_json, {}).paymentHistory || [];
      for (const item of Array.isArray(history) ? history : []) {
        const amount = Number(item.amount) || 0;
        if (!item.id || amount <= 0) { skipped += 1; continue; }
        const [[exists]] = await conn.query('SELECT id FROM payments WHERE id=? AND tenant_id=? LIMIT 1', [item.id, tenantId]);
        if (exists) { skipped += 1; continue; }
        const paymentType = validTypes.has(String(item.paymentType || '').toUpperCase())
          ? String(item.paymentType).toUpperCase() : 'OTHER';
        const date = String(item.at || item.date || new Date().toISOString()).slice(0, 10);
        await conn.query(
          `INSERT INTO payments
             (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type,
              payment_method, transaction_id, is_installment, date, note, status,
              tenant_id, branch, branch_id, source, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'paid',?,?,?,?,NOW())`,
          [item.id, subscriber.id, item.courseId || null, item.bundleId || null, amount,
           item.currency || 'EGP', paymentType, item.paymentMethod || 'historical',
           item.transactionId || null, item.isInstallment ? 1 : 0, date, item.note || null,
           tenantId, subscriber.branch || 'ONLINE_EGYPT', subscriber.branch_id || 'branch-other', 'crm_backfill']
        );
        const journalId = await postPaymentJournal({
          paymentId: item.id, amount, currency: item.currency || 'EGP', payType: paymentType,
          date, actor: req.user?.email || 'backfill',
        }, conn);
        if (!journalId) throw new Error(`Journal failed for ${item.id}`);
        inserted += 1;
      }
    }
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, inserted, skipped });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[backfill-payments]', error.message);
    res.status(500).json({ error: 'Backfill rolled back' });
  } finally { conn.release(); }
});

router.get('/api/admin/reconcile-payments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const [unpaid] = await pool.query(
      `SELECT e.id AS enrollment_id, s.name, s.email, s.client_code, s.branch,
              c.title AS course_title, e.enrolled_at
         FROM enrollments e
         JOIN subscribers s ON s.id=e.subscriber_id AND s.tenant_id=e.tenant_id
         LEFT JOIN courses c ON c.id=e.course_id AND c.tenant_id=e.tenant_id
        WHERE e.tenant_id=? AND NOT EXISTS (
          SELECT 1 FROM payments p
           WHERE p.subscriber_id=e.subscriber_id AND p.tenant_id=e.tenant_id
             AND p.status='paid' AND p.deleted_at IS NULL
             AND (p.course_id=e.course_id OR EXISTS (
               SELECT 1 FROM bundle_courses bc WHERE bc.bundle_id=p.bundle_id AND bc.course_id=e.course_id
             ))
        ) ORDER BY e.enrolled_at DESC LIMIT 500`,
      [tenantId]
    );
    const [[totals]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM enrollments WHERE tenant_id=?) AS total_enrollments,
        (SELECT COUNT(*) FROM payments WHERE tenant_id=? AND deleted_at IS NULL) AS total_payments`,
      [tenantId, tenantId]
    );
    res.json({ summary: { ...totals, unpaid_enrollments: unpaid.length }, unpaid });
  } catch (error) {
    logger.error('[reconcile-payments]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/admin/payment-audit', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;
    const params = [tenantId];
    let filters = '';
    if (req.query.paymentId) { filters += ' AND a.payment_id=?'; params.push(req.query.paymentId); }
    if (req.query.action) { filters += ' AND a.action=?'; params.push(req.query.action); }
    const [[count]] = await pool.query(
      `SELECT COUNT(*) AS total FROM payment_audit_log a JOIN payments p ON p.id=a.payment_id AND p.tenant_id=? WHERE 1=1${filters}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT a.*, s.name AS subscriber_name, s.client_code
         FROM payment_audit_log a
         JOIN payments p ON p.id=a.payment_id AND p.tenant_id=?
         LEFT JOIN subscribers s ON s.id=a.subscriber_id AND s.tenant_id=p.tenant_id
        WHERE 1=1${filters} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ total: Number(count.total) || 0, page, limit, rows });
  } catch (error) {
    logger.error('[payment-audit]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
