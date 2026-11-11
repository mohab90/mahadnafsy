'use strict';
const { isSelfMutation } = require('../../lib/hrSelfMutation');
/**
 * «نظام المكافآت» (8 Nov 2026): the plan's rules (lib/bonusPlan.js, kept in tenant_settings 'bonus_plan'), what each course counts as for the reps, and a
 * month's bonuses worked out from the payments (lib/monthlyBonuses.js) — shown, and when HR says so written as bonuses awaiting approval.
 */
const express = require('express');
const router = express.Router();
const { hrError } = require('./_shared');
const logger = require('../../lib/logger').child({ module: 'hr-bonuses' });
const { pool } = require('../../lib/db');
const { requireAuth, requireAdminOrStaff, requirePermission, requirePermissionOrSelf } = require('../../middleware/auth');
const { getTenantSetting, setTenantSetting } = require('../../lib/tenantSettings');
const { normalizePlan, bookingWeight } = require('../../lib/bonusPlan');
const { normalizeCommissionSettings } = require('../../lib/payrollCommission');
const { computeMonthlyBonuses, saveMonthlyBonuses, adjustmentContext } = require('../../lib/monthlyBonuses');
const { listAdjustments, listCountedElsewhere, addAdjustment, revokeAdjustment } = require('../../lib/bonusAdjustments');
const { readSalesSheet } = require('../../lib/salesSheet');
const { reconcileSalesSheet } = require('../../lib/salesSheetReconcile');
const { renderMarkdown, renderCsv } = require('../../lib/salesSheetReport');
const { readCollectionSheet } = require('../../lib/collectionSheet');
const { reconcileCollectionSheet } = require('../../lib/collectionSheetReconcile');
const collectionReport = require('../../lib/collectionSheetReport');
const { writeAuditEvent } = require('../../lib/auditTrail');
const { roundProgressOf } = require('../../lib/roundProgress');
const { cairoYearMonth, dateOnlyInTimeZone } = require('../../lib/dates');

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

// GET /api/admin/hr/payroll-commission — whether payroll adds a sales commission of its own, and by which rule for the team, a department or an employee
// (lib/payrollCommission.js; off unless switched on), with the departments and employees a rule can be set for.
router.get('/api/admin/hr/payroll-commission', ...view, async (req, res) => {
  try {
    const settings = normalizeCommissionSettings(await getTenantSetting('payroll_commission', { tenantId: req.tenantId, fallback: {} }));
    const [departments] = await pool.query('SELECT id, name FROM hr_departments WHERE tenant_id=? ORDER BY name', [req.tenantId]);
    const [staff] = await pool.query('SELECT id, name, department_id FROM staff WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL ORDER BY name', [req.tenantId]);
    res.json({ settings, departments, staff });
  } catch (error) {
    logger.error('[payroll-commission/get]', error.message);
    hrError(res, error);
  }
});

// PUT /api/admin/hr/payroll-commission — the whole settings, checked (a 400 says what is wrong). It changes what the next payroll calculation pays.
router.put('/api/admin/hr/payroll-commission', ...managePay, async (req, res) => {
  try {
    const settings = normalizeCommissionSettings(req.body?.settings || req.body);
    await setTenantSetting('payroll_commission', settings, { tenantId: req.tenantId, actorId: req.staffRecord?.id || null });
    await writeAuditEvent({ action: 'hr.payroll_commission_saved', entityType: 'tenant_settings', entityId: 'payroll_commission', severity: 'warning', metadata: settings, req }).catch(() => {});
    res.json({ ok: true, settings });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
    logger.error('[payroll-commission/put]', error.message);
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

// GET /api/admin/hr/staff/:id/round-progress — a rep's current round: its dates, the bookings counted so far, the next step and what is left to reach it, and the
// rounds already over this month. The employee reads their own (the page every rep lands on); someone else's needs view_hr. Reads only, the same computation as the
// payroll's bonus columns.
router.get('/api/admin/hr/staff/:id/round-progress', requireAuth, requireAdminOrStaff, requirePermissionOrSelf('view_hr'), async (req, res) => {
  try {
    const { year, month } = cairoYearMonth();
    res.set('Cache-Control', 'no-store');
    const result = await computeMonthlyBonuses(pool, { tenantId: req.tenantId, year, month });
    res.json(roundProgressOf(result, req.params.id, dateOnlyInTimeZone()));
  } catch (error) {
    logger.error('[round-progress]', error.message);
    hrError(res, error);
  }
});

const actorOf = req => ({ id: String(req.staffRecord?.id || req.user?.uid || '').slice(0, 36) || null, name: req.staffRecord?.name || req.user?.name || req.user?.email || null });

// GET /api/admin/hr/bonus-adjustments?month=YYYY-MM[&history=1] — the owner's changes to the month's bonuses (lib/bonusAdjustments.js), who, when and why.
router.get('/api/admin/hr/bonus-adjustments', ...view, async (req, res) => {
  try {
    const { year, month } = monthOf(req.query.month);
    res.set('Cache-Control', 'no-store');
    res.json({ adjustments: await listAdjustments(pool, { tenantId: req.tenantId, year, month, history: req.query.history === '1' }) });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
    logger.error('[bonus-adjustments/get]', error.message);
    hrError(res, error);
  }
});

// GET /api/admin/hr/late-bookings?month=YYYY-MM — the first payments of the month before and after: the bookings that can be counted in this month instead of their own
// (COUNT_IN_MONTH, «الحجز اتأخر رفعه»), each with the sales rep it belongs to and whether it is already counted in this month.
router.get('/api/admin/hr/late-bookings', ...view, async (req, res) => {
  try {
    const { year, month } = monthOf(req.query.month);
    const context = await adjustmentContext(pool, { tenantId: req.tenantId, year, month });
    const sales = new Map(context.staff.filter(row => row.bonus_scheme === 'SALES_BOOKINGS').map(row => [row.id, row.name]));
    const counted = await listCountedElsewhere(pool, { tenantId: req.tenantId, paymentIds: context.adjacentBookings.map(booking => booking.paymentId) });
    const bookings = context.adjacentBookings.map(booking => {
      const repId = [booking.salesRep, booking.recordedBy].find(id => id && sales.has(id)) || null;
      const move = counted.get(booking.paymentId);
      return {
        paymentId: booking.paymentId, client: booking.client, clientCode: booking.clientCode, title: booking.title, day: booking.day, month: booking.day.slice(0, 7),
        priceEgp: booking.priceEgp, weight: bookingWeight(context.plan, booking.priceEgp), repId, repName: repId ? sales.get(repId) : null,
        countedIn: move ? `${move.year}-${String(move.month).padStart(2, '0')}` : null,
      };
    }).sort((a, b) => (a.day < b.day ? -1 : 1));
    res.set('Cache-Control', 'no-store');
    res.json({ bookings, reps: [...sales].map(([id, name]) => ({ id, name })) });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
    logger.error('[late-bookings]', error.message);
    hrError(res, error);
  }
});

// POST /api/admin/hr/bonus-adjustments {month, kind, staffId?, paymentId?, toStaffId?, weight?, amount?, round?, reason} — a change to a month's calculation; whoever
// holds manage_financial (the owner, admin). A reason is required. The month's bonuses are worked out again with it (and saved only when HR saves them).
router.post('/api/admin/hr/bonus-adjustments', ...managePay, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { year, month } = monthOf(req.body?.month);
    // A change to a month's bonuses is not made on one's own (or in one's own favour: a booking moved to oneself).
    if ([req.body?.staffId, req.body?.toStaffId].some(id => isSelfMutation(req, id))) {
      return res.status(409).json({ error: 'لا يجوز تعديل مكافآتك بنفسك', code: 'HR_SELF_MUTATION' });
    }
    await conn.beginTransaction();
    const context = await adjustmentContext(conn, { tenantId: req.tenantId, year, month });
    const made = await addAdjustment(conn, { tenantId: req.tenantId, year, month, input: req.body || {}, actor: actorOf(req), context });
    await conn.commit();
    await writeAuditEvent({ action: 'hr.bonus_adjusted', entityType: 'bonus_adjustment', entityId: made.id, severity: 'warning', metadata: { month: `${year}-${month}`, kind: made.kind, staffId: made.staffId, paymentId: made.paymentId, toStaffId: made.toStaffId, weight: made.weight, amount: made.amount, reason: made.reason }, req }).catch(() => {});
    res.json({ ok: true, adjustment: made });
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error.statusCode === 400) return res.status(400).json({ error: error.message, code: error.code });
    logger.error('[bonus-adjustments/post]', error.message);
    hrError(res, error);
  } finally { conn.release(); }
});

// POST /api/admin/hr/bonus-adjustments/:id/revoke {reason?} — takes a change back; it stays in the month's history.
router.post('/api/admin/hr/bonus-adjustments/:id/revoke', ...managePay, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const revoked = await revokeAdjustment(conn, { tenantId: req.tenantId, id: req.params.id, actor: actorOf(req), reason: req.body?.reason });
    await conn.commit();
    if (!revoked) return res.status(404).json({ error: 'التعديل ده مش موجود أو اتلغى قبل كده' });
    await writeAuditEvent({ action: 'hr.bonus_adjustment_revoked', entityType: 'bonus_adjustment', entityId: req.params.id, severity: 'warning', metadata: { kind: revoked.kind, reason: req.body?.reason || null }, req }).catch(() => {});
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.error('[bonus-adjustments/revoke]', error.message);
    hrError(res, error);
  } finally { conn.release(); }
});

// POST /api/admin/hr/sales-sheet-reconciliation {fileBase64, filename, month} — the owner's monthly sales target sheet held against the system and the target
// system applied to both (lib/salesSheetReconcile.js). Reads only. It holds real clients' names and phones, so it is the financial permission's.
router.post('/api/admin/hr/sales-sheet-reconciliation', ...managePay, async (req, res) => {
  try {
    const { fileBase64, month: monthText } = req.body || {};
    if (typeof fileBase64 !== 'string' || !fileBase64) return res.status(400).json({ error: 'ارفع شيت المبيعات (.xlsx)' });
    const { year, month } = monthOf(monthText);
    const buffer = Buffer.from(fileBase64.replace(/^data:[^,]*,/, ''), 'base64');
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'الملف لازم يكون أقل من 8 ميجا' });
    const sheet = readSalesSheet(buffer, { month: `${year}-${String(month).padStart(2, '0')}` });
    if (!sheet.rows) return res.status(400).json({ error: 'مفيش صفوف حجوزات اتقرت من الشيت ده', unreadable: sheet.unreadable });
    const report = await reconcileSalesSheet(pool, { tenantId: req.tenantId, sheet, year, month, tabMap: req.body?.map });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, report, markdown: renderMarkdown(report), csv: renderCsv(report) });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ error: error.message, code: error.code });
    logger.error('[sales-sheet-reconciliation]', error.message);
    hrError(res, error);
  }
});

// POST /api/admin/hr/collection-sheet-reconciliation {fileBase64, filename, month} — the collection employees' monthly sheet held against the system's payments
// (lib/collectionSheetReconcile.js): is every payment of the sheet in the system, and under the same employee? Reads only; the financial permission's.
router.post('/api/admin/hr/collection-sheet-reconciliation', ...managePay, async (req, res) => {
  try {
    const { fileBase64, month: monthText } = req.body || {};
    if (typeof fileBase64 !== 'string' || !fileBase64) return res.status(400).json({ error: 'ارفع شيت التحصيل (.xlsx)' });
    const { year, month } = monthOf(monthText);
    const buffer = Buffer.from(fileBase64.replace(/^data:[^,]*,/, ''), 'base64');
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'الملف لازم يكون أقل من 8 ميجا' });
    const sheet = readCollectionSheet(buffer, { month: `${year}-${String(month).padStart(2, '0')}` });
    if (!sheet.rows) return res.status(400).json({ error: 'مفيش دفعات اتقرت من الشيت ده', unreadable: sheet.unreadable });
    const report = await reconcileCollectionSheet(pool, { tenantId: req.tenantId, sheet, year, month, tabMap: req.body?.map });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, report, markdown: collectionReport.renderMarkdown(report), csv: collectionReport.renderCsv(report) });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ error: error.message, code: error.code });
    logger.error('[collection-sheet-reconciliation]', error.message);
    hrError(res, error);
  }
});

module.exports = router;
