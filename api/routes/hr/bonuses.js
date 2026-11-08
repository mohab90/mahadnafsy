'use strict';
/**
 * «نظام المكافآت» (8 Nov 2026): the plan's rules (lib/bonusPlan.js, kept in tenant_settings 'bonus_plan'), what each course counts as for the reps, and a
 * month's bonuses worked out from the payments (lib/monthlyBonuses.js) — shown, and when HR says so written as bonuses awaiting approval.
 */
const express = require('express');
const router = express.Router();
const { hrError } = require('./_shared');
const logger = require('../../lib/logger').child({ module: 'hr-bonuses' });
const { pool } = require('../../lib/db');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { getTenantSetting, setTenantSetting } = require('../../lib/tenantSettings');
const { normalizePlan, bookingWeight } = require('../../lib/bonusPlan');
const { computeMonthlyBonuses, saveMonthlyBonuses } = require('../../lib/monthlyBonuses');
const { writeAuditEvent } = require('../../lib/auditTrail');

const view = [requireAuth, requireAdminOrStaff, requirePermission('view_hr')];
const manage = [requireAuth, requireAdminOrStaff, requirePermission('manage_hr')];
const managePay = [requireAuth, requireAdminOrStaff, requirePermission('manage_financial')];

/** «YYYY-MM» → { year, month }, or a 400. */
function monthOf(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) throw Object.assign(new Error('الشهر لازم يكون بالشكل 2026-09'), { statusCode: 400 });
  return { year: Number(match[1]), month };
}

// GET /api/admin/hr/bonus-plan — the plan, and every course and track with how many bookings it counts as at its own price.
router.get('/api/admin/hr/bonus-plan', ...view, async (req, res) => {
  try {
    const plan = normalizePlan(await getTenantSetting('bonus_plan', { tenantId: req.tenantId, fallback: {} }));
    const [items] = await pool.query(
      `SELECT 'course' AS kind, id, title, price_egp FROM courses WHERE tenant_id=? AND deleted_at IS NULL
       UNION ALL
       SELECT 'track' AS kind, id, title, price_egp FROM bundles WHERE tenant_id=? AND deleted_at IS NULL
       ORDER BY price_egp DESC, title`, [req.tenantId, req.tenantId]);
    res.json({
      plan,
      items: items.map(item => ({ kind: item.kind, id: item.id, title: item.title, priceEgp: Number(item.price_egp) || 0, weight: bookingWeight(plan, item.price_egp) })),
    });
  } catch (error) {
    logger.error('[bonus-plan/get]', error.message);
    hrError(res, error);
  }
});

// PUT /api/admin/hr/bonus-plan — the whole plan, checked (a 400 says what is wrong).
router.put('/api/admin/hr/bonus-plan', ...managePay, async (req, res) => {
  try {
    const plan = normalizePlan(req.body?.plan || req.body);
    await setTenantSetting('bonus_plan', plan, { tenantId: req.tenantId, actorId: req.staffRecord?.id || null });
    await writeAuditEvent({ action: 'hr.bonus_plan_saved', entityType: 'tenant_settings', entityId: 'bonus_plan', severity: 'warning', metadata: plan, req }).catch(() => {});
    res.json({ ok: true, plan });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ error: error.message, code: error.code });
    logger.error('[bonus-plan/put]', error.message);
    hrError(res, error);
  }
});

// GET /api/admin/hr/monthly-bonuses?month=YYYY-MM — every employee on a scheme and how their month's bonus is made up. Writes nothing.
router.get('/api/admin/hr/monthly-bonuses', ...view, async (req, res) => {
  try {
    const { year, month } = monthOf(req.query.month);
    res.set('Cache-Control', 'no-store');
    res.json(await computeMonthlyBonuses(pool, { tenantId: req.tenantId, year, month }));
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
    logger.error('[monthly-bonuses/get]', error.message);
    hrError(res, error);
  }
});

// POST /api/admin/hr/monthly-bonuses {month} — the month's bonuses written as bonuses awaiting approval (one per employee, replacing a pending one).
router.post('/api/admin/hr/monthly-bonuses', ...manage, async (req, res) => {
  const { year, month } = (() => { try { return monthOf(req.body?.month); } catch (error) { return { error }; } })();
  if (!year) return res.status(400).json({ error: 'الشهر لازم يكون بالشكل 2026-09' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await saveMonthlyBonuses(conn, { tenantId: req.tenantId, year, month, actorId: req.staffRecord?.id || null });
    await conn.commit();
    res.json({ ok: true, month: `${year}-${String(month).padStart(2, '0')}`, written: result.written, kept: result.kept, cleared: result.cleared, total: result.total });
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.error('[monthly-bonuses/save]', error.message);
    hrError(res, error);
  } finally { conn.release(); }
});

module.exports = router;
