'use strict';

// «تقارير الإدارة» and the three teams' daily reports (lib/managementReport.js,
// lib/teamReports.js), over Cairo days: today, yesterday, 7, 15 or 30 days.

const express = require('express');
const logger = require('../lib/logger').child({ module: 'management-reports-route' });
const { requireAuth, requireAdmin, requireAdminOrStaff, requireAnyPermission } = require('../middleware/auth');
const { hasPermission } = require('../constants/permissions');
const { reportRange } = require('../lib/teamDailyReport');
const { TEAM_REPORTS } = require('../lib/teamReports');
const { buildManagementReport } = require('../lib/managementReport');

const router = express.Router();

// Who reads a team's report: whoever manages a team, and whoever was given
// that team's performance figures (the HR manager holds these).
const TEAM_READERS = {
  online: ['manage_sales_team', 'view_perf_online'],
  support: ['manage_sales_team', 'view_perf_cx'],
  daqqi: ['manage_sales_team', 'view_perf_daqqi'],
};

const failed = (res, error, label) => {
  logger.error(`[${label}]`, error.message);
  res.status(500).json({ error: 'تعذر تجهيز التقرير' });
};

// requireAnyPermission carries the MFA check; the team's own list narrows it.
router.get('/api/admin/reports/teams/:team', requireAuth, requireAdminOrStaff,
  requireAnyPermission('manage_sales_team', 'view_perf_online', 'view_perf_cx', 'view_perf_daqqi'), async (req, res) => {
  const build = TEAM_REPORTS[req.params.team];
  if (!build) return res.status(404).json({ error: 'Unknown team' });
  const readers = TEAM_READERS[req.params.team];
  if (!req.isSuperAdmin && !readers.some(permission => hasPermission(req.staffRecord, permission))) {
    return res.status(403).json({ error: `Permission denied: one of ${readers.join(', ')}` });
  }
  try {
    res.json(await build({ tenantId: req.tenantId, ...reportRange(req.query) }));
  } catch (error) { failed(res, error, 'team-report'); }
});

// The institute's money and every team at once: the owner and the managers.
router.get('/api/admin/reports/management', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await buildManagementReport({ tenantId: req.tenantId, ...reportRange(req.query) }));
  } catch (error) { failed(res, error, 'management-report'); }
});

module.exports = router;
