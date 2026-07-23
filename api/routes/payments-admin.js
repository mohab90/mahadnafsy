'use strict';

const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();

const { uuidv4 } = require('../lib/id');
const { pool } = require('../lib/db');
const { sendEmail } = require('../lib/email');
const { sendWhatsApp } = require('../lib/whatsapp');
const { tryJson } = require('../lib/helpers');
const { createNotification } = require('../lib/notification');
const { logPaymentAudit, postJournalEntry, _paymentAccountCode } = require('../lib/finance');
const { syncLeadDealValue } = require('../lib/leadDealValue');
const { enqueueEmailSequence } = require('../lib/emailSequence');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { safeDateOnly } = require('../lib/dates');
const { bulkOperationLimiter } = require('../middleware/rateLimits');

// PATCH /api/admin/payments/:id/status — approve or reject a payment (admin/manager)
// (removed dead duplicate PATCH /api/admin/payments/:id/status — live in an earlier-mounted router)

// POST /api/admin/backfill-payments — one-time: sync paymentHistory from crm_json → payments table
// (removed dead duplicate POST /api/admin/backfill-payments — live in an earlier-mounted router)

// GET /api/admin/reconcile-payments
// (removed dead duplicate GET /api/admin/reconcile-payments — live in an earlier-mounted router)

// GET /api/admin/payment-audit
// (removed dead duplicate GET /api/admin/payment-audit — live in an earlier-mounted router)

// GET /api/admin/payments/outstanding
// (removed dead duplicate GET /api/admin/payments/outstanding — live in an earlier-mounted router)

// POST /api/admin/payments/send-reminder
// (removed dead duplicate POST /api/admin/payments/send-reminder — live in an earlier-mounted router)

// POST /api/admin/payments/bulk-stub
// (removed dead duplicate POST /api/admin/payments/bulk-stub — live in an earlier-mounted router)

// POST /api/admin/subscriber-payments
// NOTE: POST /api/admin/subscriber-payments lives in routes/subscriber-payments.js (mounted first → this duplicate was dead code; removed 2026-06-20).

// GET /api/admin/subscribers/:id/payments
// (removed dead duplicate GET /api/admin/subscribers/:id/payments — live in an earlier-mounted router)

// POST /api/admin/enrollments
// (removed dead duplicate POST /api/admin/enrollments — live in an earlier-mounted router)

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Monthly Commission Comparison ────────────────────────────────
// GET /api/admin/commissions/monthly?months=6&staffId=OPTIONAL
//
// Returns commissions grouped by staff member × calendar month for the
// last N months. Useful for month-over-month comparison reports.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/api/admin/commissions/monthly', requireAuth, requireAdmin, async (req, res) => {
  try {
    const months   = Math.min(12, Math.max(1, parseInt(req.query.months || '6')));
    const staffId  = req.query.staffId || null;
    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - (months - 1));
    fromDate.setDate(1);
    const from = fromDate.toISOString().slice(0, 7); // YYYY-MM

    let sql = `
      SELECT
        DATE_FORMAT(c.created_at, '%Y-%m')  AS month,
        c.staff_id,
        COALESCE(s.name, c.staff_id)        AS staff_name,
        COUNT(*)                             AS deals_count,
        SUM(c.commission_amount)             AS total_commission,
        SUM(c.payment_amount)                AS total_payment
      FROM crm_commissions c
      LEFT JOIN staff s ON s.id = c.staff_id
      WHERE DATE_FORMAT(c.created_at, '%Y-%m') >= ?
    `;
    const params = [from];
    if (staffId) { sql += ' AND c.staff_id = ?'; params.push(staffId); }
    sql += ' GROUP BY month, c.staff_id, staff_name ORDER BY month ASC, total_commission DESC';

    const [rows] = await pool.query(sql, params);

    // Build calendar month array for the period
    const allMonths = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(fromDate);
      d.setMonth(d.getMonth() + i);
      allMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // Distinct staff list
    const staffList = [...new Map(rows.map(r => [r.staff_id, r.staff_name])).entries()]
      .map(([id, name]) => ({ id, name }));

    // Matrix: staff → months
    const matrix = staffList.map(({ id, name }) => ({
      staffId: id,
      staffName: name,
      months: allMonths.map(m => {
        const row = rows.find(r => r.staff_id === id && r.month === m);
        return {
          month: m,
          dealsCount: row ? Number(row.deals_count) : 0,
          totalCommission: row ? Number(row.total_commission) : 0,
          totalPayment: row ? Number(row.total_payment) : 0,
        };
      }),
      grandTotal: rows.filter(r => r.staff_id === id).reduce((a, r) => a + Number(r.total_commission), 0),
    })).sort((a, b) => b.grandTotal - a.grandTotal);

    res.json({ from, months: allMonths, staff: matrix });
  } catch (e) { logger.error('[commissions/monthly]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Excel-compatible CSV Export (UTF-8 BOM) ─────────────────────
// GET /api/admin/export/orders?from=YYYY-MM-DD&to=YYYY-MM-DD&type=orders|commissions|subscribers
// Returns a CSV file compatible with Excel (UTF-8 BOM so Arabic displays correctly).
// Falls back gracefully — no external dependency needed.
// ══════════════════════════════════════════════════════════════════════════
router.get('/api/admin/export/orders', requireAuth, requireAdmin, bulkOperationLimiter, async (req, res) => {
  try {
    const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to   = req.query.to   || new Date().toISOString().slice(0, 10);
    const type = req.query.type || 'orders';

    let rows = [], headers = [], filename = '';

    if (type === 'orders') {
      const [data] = await pool.query(
        `SELECT o.id, o.order_number, u.name AS client_name, u.email, u.phone,
                c.title AS course_name, o.amount, o.currency, o.status,
                o.payment_method, o.created_at, s.name AS staff_name
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN courses c ON c.id = o.course_id
         LEFT JOIN staff s ON s.id = o.staff_id
         WHERE o.created_at >= ? AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)
         ORDER BY o.created_at DESC`,
        [from, to]
      );
      headers = ['رقم الطلب','اسم العميل','البريد','الهاتف','الكورس','المبلغ','العملة','الحالة','طريقة الدفع','التاريخ','موظف المبيعات'];
      rows = data.map(r => [
        r.order_number || r.id, r.client_name || '', r.email || '', r.phone || '',
        r.course_name || '', r.amount, r.currency || 'EGP', r.status || '',
        r.payment_method || '', (r.created_at || '').toString().slice(0, 10), r.staff_name || '',
      ]);
      filename = `orders-${from}-${to}.csv`;

    } else if (type === 'commissions') {
      const [data] = await pool.query(
        `SELECT c.id, s.name AS staff_name, s.email, c.commission_amount, c.payment_amount,
                c.commission_type, c.description, c.created_at
         FROM crm_commissions c
         LEFT JOIN staff s ON s.id = c.staff_id
         WHERE c.created_at >= ? AND c.created_at < DATE_ADD(?, INTERVAL 1 DAY)
         ORDER BY c.created_at DESC`,
        [from, to]
      );
      headers = ['الموظف','البريد','مبلغ العمولة','مبلغ الدفع','نوع العمولة','وصف','التاريخ'];
      rows = data.map(r => [
        r.staff_name || '', r.email || '', r.commission_amount, r.payment_amount,
        r.commission_type || '', r.description || '', (r.created_at || '').toString().slice(0, 10),
      ]);
      filename = `commissions-${from}-${to}.csv`;

    } else if (type === 'subscribers') {
      const [data] = await pool.query(
        `SELECT s.id, s.name, s.email, s.phone, s.country,
                s.is_active, s.created_at,
                GROUP_CONCAT(c.title SEPARATOR ' | ') AS courses
         FROM subscribers s
         LEFT JOIN JSON_TABLE(s.enrolled_course_ids, '$[*]' COLUMNS(cid VARCHAR(36) PATH '$')) j ON 1=1
         LEFT JOIN courses c ON c.id = j.cid
         WHERE s.created_at >= ? AND s.created_at < DATE_ADD(?, INTERVAL 1 DAY)
         GROUP BY s.id ORDER BY s.created_at DESC`,
        [from, to]
      ).catch(async () => {
        // Fallback without JSON_TABLE (older MySQL)
        const [fb] = await pool.query(
          `SELECT id, name, email, phone, country, is_active, created_at FROM subscribers
           WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
           ORDER BY created_at DESC`,
          [from, to]
        );
        return [fb];
      });
      headers = ['الاسم','البريد','الهاتف','الدولة','نشط','الكورسات','تاريخ التسجيل'];
      rows = data.map(r => [
        r.name || '', r.email || '', r.phone || '', r.country || '',
        r.is_active ? 'نعم' : 'لا', r.courses || '',
        (r.created_at || '').toString().slice(0, 10),
      ]);
      filename = `subscribers-${from}-${to}.csv`;
    } else {
      return res.status(400).json({ error: 'type must be orders|commissions|subscribers' });
    }

    // Build CSV with UTF-8 BOM (Excel requires BOM for proper Arabic rendering)
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const BOM = '﻿';
    const csv = BOM + [headers, ...rows].map(row => row.map(escape).join(',')).join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (e) { logger.error('[export/orders]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
