'use strict';
// «بدل رصيد الإجازات» (lib/leaveEncashment.js): the year's unused leave days turned into money at each employee's salary. The list is read with view_hr; writing the pending
// bonuses is manage_hr, audited, and never for the signed-in person's own record (the owner excepted, lib/hrSelfMutation.js) — someone else runs it for him.
const { Router } = require('express');
const router = Router();
const { hrError, requirePermission, logger, pool, requireAuth, requireAdminOrStaff } = require('./_shared');
const { writeAuditEvent } = require('../../lib/auditTrail');
const { isSelfMutation } = require('../../lib/hrSelfMutation');
const { periodOf, encashmentList, saveEncashment } = require('../../lib/leaveEncashment');

const fail = (res, error, label) => {
  if (error.statusCode === 400) return res.status(400).json({ error: error.message });
  logger.error(`[hr/leave-encashment/${label}]`, error.message);
  return hrError(res, error);
};

// GET /api/admin/hr/leave-encashment?year=2026[&month=12][&pay_year=2026] — every active employee with the year's entitlement, used, remaining, day's pay and amount. Writes nothing.
router.get('/api/admin/hr/leave-encashment', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const period = periodOf({ year: req.query.year, month: req.query.month, payYear: req.query.pay_year });
    res.set('Cache-Control', 'no-store');
    res.json(await encashmentList(pool, { tenantId: req.tenantId, ...period }));
  } catch (error) { fail(res, error, 'get'); }
});

// POST /api/admin/hr/leave-encashment {year, month?, pay_year?} — one PENDING bonus per employee (source LEAVE_ENCASHMENT) for the month chosen (December by default).
router.post('/api/admin/hr/leave-encashment', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const period = periodOf({ year: req.body?.year, month: req.body?.month, payYear: req.body?.pay_year });
    const mine = req.staffRecord?.id && isSelfMutation(req, req.staffRecord.id) ? [req.staffRecord.id] : [];
    await conn.beginTransaction();
    transactionStarted = true;
    const result = await saveEncashment(conn, { tenantId: req.tenantId, ...period, actorId: req.staffRecord?.id || null, skipStaffIds: mine });
    await writeAuditEvent({
      action: 'hr.leave_encashment.saved', entityType: 'leave_encashment', entityId: `${period.year}`, severity: 'warning',
      metadata: { year: period.year, month: period.month, pay_year: period.payYear, written: result.written.length, updated: result.updated.length, kept: result.kept.length, cleared: result.cleared.length, skipped_self: result.skipped.length, total: result.total },
      req, db: conn,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, ...result });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    fail(res, error, 'save');
  } finally { conn.release(); }
});

module.exports = router;
