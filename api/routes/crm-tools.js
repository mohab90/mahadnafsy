'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../lib/logger');
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { sendWhatsApp } = require('../lib/whatsapp');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/api/admin/payments/outstanding', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.email, s.phone, s.client_code, s.assigned_sales_name, s.assigned_cs_name,
              COALESCE(SUM(CASE WHEN p.is_installment=0 THEN p.course_expected ELSE 0 END),0) AS total_expected,
              COALESCE(SUM(CASE WHEN p.status='paid' THEN p.amount ELSE 0 END),0) AS total_paid,
              COALESCE(SUM(CASE WHEN p.is_installment=0 THEN p.course_expected ELSE 0 END),0)
                - COALESCE(SUM(CASE WHEN p.status='paid' THEN p.amount ELSE 0 END),0) AS outstanding
         FROM subscribers s JOIN payments p ON p.subscriber_id=s.id AND p.tenant_id=s.tenant_id
        WHERE s.tenant_id=? AND s.is_active=1 AND p.deleted_at IS NULL
          AND p.course_expected IS NOT NULL AND p.course_expected>0
        GROUP BY s.id HAVING outstanding>0 ORDER BY outstanding DESC LIMIT 300`,
      [tenantId]
    );
    res.json({ subscribers: rows, total_outstanding: rows.reduce((sum, row) => sum + (Number(row.outstanding) || 0), 0), count: rows.length });
  } catch (error) {
    logger.error('[outstanding-payments]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/payments/send-reminder', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const ids = Array.isArray(req.body?.subscriberIds) ? req.body.subscriberIds.slice(0, 200) : [];
    if (!req.body?.all && !ids.length) return res.status(400).json({ error: 'subscriberIds or all=true required' });
    const params = [tenantId];
    let idFilter = '';
    if (!req.body?.all) { idFilter = ' AND s.id IN (?)'; params.push(ids); }
    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.phone,
              COALESCE(SUM(p.course_expected),0)-COALESCE(SUM(CASE WHEN p.status='paid' THEN p.amount ELSE 0 END),0) AS outstanding
         FROM subscribers s JOIN payments p ON p.subscriber_id=s.id AND p.tenant_id=s.tenant_id
        WHERE s.tenant_id=? AND p.deleted_at IS NULL AND p.course_expected>0${idFilter}
        GROUP BY s.id HAVING outstanding>0 LIMIT 200`,
      params
    );
    const results = [];
    for (const subscriber of rows) {
      const amount = Number(subscriber.outstanding) || 0;
      const message = req.body?.message
        ? String(req.body.message).replaceAll('{name}', subscriber.name || '').replaceAll('{amount}', amount.toFixed(0))
        : `أهلاً ${subscriber.name || ''}، لديك رصيد مستحق ${amount.toFixed(0)} ج.م. يرجى التواصل معنا لتسوية الرصيد.`;
      try {
        await sendWhatsApp(String(subscriber.phone || '').replace(/\D/g, ''), message);
        results.push({ id: subscriber.id, ok: true });
      } catch (error) { results.push({ id: subscriber.id, ok: false }); }
    }
    res.json({ ok: true, sent: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok).length, results });
  } catch (error) {
    logger.error('[payment-reminders]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/payments/bulk-stub', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const [rows] = await pool.query(
      `SELECT e.id, e.subscriber_id, e.course_id, e.bundle_id, e.enrolled_at, e.branch_id
         FROM enrollments e
        WHERE e.tenant_id=? AND NOT EXISTS (
          SELECT 1 FROM payments p WHERE p.tenant_id=e.tenant_id AND p.subscriber_id=e.subscriber_id
            AND (p.course_id=e.course_id OR (e.course_id IS NULL AND p.bundle_id=e.bundle_id))
        ) LIMIT 1000`,
      [tenantId]
    );
    if (req.body?.dryRun !== false) return res.json({ dryRun: true, count: rows.length, sample: rows.slice(0, 5) });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const row of rows) {
        await conn.query(
          `INSERT INTO payments
             (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type,
              payment_method, date, note, status, source, tenant_id, branch_id, created_at)
           VALUES (?,?,?,?,0,'EGP','OTHER','historical',?,'تسجيل تاريخي بدون إثبات دفع','pending','reconciliation_stub',?,?,NOW())`,
          [uuidv4(), row.subscriber_id, row.course_id || null, row.bundle_id || null,
           row.enrolled_at, tenantId, row.branch_id || 'branch-other']
        );
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    } finally { conn.release(); }
    res.json({ ok: true, created: rows.length });
  } catch (error) {
    logger.error('[payment-stubs]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
