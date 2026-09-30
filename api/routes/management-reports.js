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
const { SECTION, composeOwnerReport, ownerReportSettings, sendOwnerDailyReport } = require('../lib/ownerDailyReport');
const { setTenantSetting } = require('../lib/tenantSettings');
const { toDialable } = require('../lib/phoneNumber');
const { cairoToday } = require('../lib/dates');

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

// «التقرير اليومي على واتساب»: its numbers and hour, and what today's reads.
router.get('/api/admin/reports/whatsapp', requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = await ownerReportSettings(req.tenantId);
    const today = cairoToday();
    const report = await buildManagementReport({ tenantId: req.tenantId, from: today, to: today, today });
    res.json({ ...settings, preview: composeOwnerReport(report) });
  } catch (error) { failed(res, error, 'owner-report-settings'); }
});

router.put('/api/admin/reports/whatsapp', requireAuth, requireAdmin, async (req, res) => {
  try {
    const phones = (Array.isArray(req.body?.phones) ? req.body.phones : String(req.body?.phones || '').split(/[,،\s]+/))
      .map(phone => String(phone).trim()).filter(Boolean);
    const invalid = phones.filter(phone => !toDialable(phone));
    if (invalid.length) return res.status(400).json({ error: `رقم مش صحيح: ${invalid.join('، ')}` });
    const hour = Number(req.body?.hour);
    await setTenantSetting(SECTION, {
      enabled: req.body?.enabled === true,
      phones: phones.slice(0, 5),
      hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 21,
    }, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    res.json({ ok: true, ...(await ownerReportSettings(req.tenantId)) });
  } catch (error) { failed(res, error, 'owner-report-save'); }
});

// «ابعت دلوقتي»: today's report, now, to the saved numbers.
router.post('/api/admin/reports/whatsapp/send-now', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await sendOwnerDailyReport({ tenantId: req.tenantId, force: true });
    if (result.reason === 'no_numbers') return res.status(400).json({ error: 'احفظ رقم واتساب الأول' });
    res.json(result);
  } catch (error) { failed(res, error, 'owner-report-send'); }
});

module.exports = router;
