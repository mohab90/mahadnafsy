'use strict';

// The Dokki manager's week (9 Oct 2026): the weekly report (lib/dokkiWeeklyReport.js)
// and the switches for what the branch sends on its own (lib/dokkiAbsenceFollowUp.js).

const express = require('express');
const router = express.Router();
const logger = require('../lib/logger');
const { pool } = require('../lib/db');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { requireDaqqiAccess, requireDaqqiManager } = require('../lib/daqqiAccess');
const { requestedBranch } = require('../lib/physicalBranches');
const { setTenantSetting } = require('../lib/tenantSettings');
const { buildDokkiWeeklyReport, composeDokkiWeeklyReport } = require('../lib/dokkiWeeklyReport');
const { SECTION, dokkiAutomationSettings } = require('../lib/dokkiAbsenceFollowUp');
const { buildDokkiDailyBrief, composeDokkiDailyBrief } = require('../lib/dokkiDailyBrief');

const fail = (res, error, where) => {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) logger.error(`[dokki-reports/${where}]`, error.message);
  res.status(statusCode).json({ error: statusCode < 500 ? error.message : 'Internal server error' });
};

router.get('/api/admin/daqqi/weekly-report', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess, async (req, res) => {
  try {
    const report = await buildDokkiWeeklyReport(pool, { tenantId: req.tenantId, branch: requestedBranch(req) });
    res.json({ ...report, message: composeDokkiWeeklyReport(report) });
  } catch (error) { fail(res, error, 'weekly'); }
});

// Today's rounds as the morning WhatsApp has them (lib/dokkiDailyBrief.js).
router.get('/api/admin/daqqi/daily-brief', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess, async (req, res) => {
  try {
    const brief = await buildDokkiDailyBrief(pool, { tenantId: req.tenantId, branch: requestedBranch(req) });
    res.json({ ...brief, message: brief.rounds.length ? composeDokkiDailyBrief(brief) : '' });
  } catch (error) { fail(res, error, 'daily'); }
});

router.get('/api/admin/daqqi/automation', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess, async (req, res) => {
  try { res.json(await dokkiAutomationSettings(req.tenantId)); } catch (error) { fail(res, error, 'automation-read'); }
});

// The branch manager's (or the administration's) switches.
router.put('/api/admin/daqqi/automation', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiManager, async (req, res) => {
  try {
    const current = await dokkiAutomationSettings(req.tenantId);
    const next = {
      absenceFollowUp: typeof req.body?.absenceFollowUp === 'boolean' ? req.body.absenceFollowUp : current.absenceFollowUp,
      weeklyReport: typeof req.body?.weeklyReport === 'boolean' ? req.body.weeklyReport : current.weeklyReport,
      dailyBrief: typeof req.body?.dailyBrief === 'boolean' ? req.body.dailyBrief : current.dailyBrief,
    };
    await setTenantSetting(SECTION, next, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    res.json({ ok: true, ...next });
  } catch (error) { fail(res, error, 'automation-save'); }
});

module.exports = router;
