'use strict';

const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();

const { pool } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

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
      LEFT JOIN staff s ON s.id = c.staff_id AND s.tenant_id = c.tenant_id
      WHERE c.tenant_id = ? AND DATE_FORMAT(c.created_at, '%Y-%m') >= ?
    `;
    const params = [req.tenantId, from];
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

// GET /api/admin/export/orders used to live here — a CSV export whose 'orders'
// branch referenced columns that don't exist on the current orders table
// (order_number, user_id, staff_id), whose 'commissions' branch referenced
// non-existent crm_commissions columns (commission_type, description), and
// whose 'subscribers' branch referenced non-existent subscribers columns
// (country, enrolled_course_ids) — every invocation 500'd. None of the three
// branches filtered by tenant_id either, which would have been a real
// cross-tenant data leak the moment the column names got "fixed" without also
// adding that scoping. It also had zero frontend callers (admin-utils.js
// already has working, tenant-scoped export/subscribers, export/leads, and
// export/payments; OrdersTab.tsx's own CSV export is client-side). Removed
// rather than rebuilt against a schema it was never updated for.

module.exports = router;
