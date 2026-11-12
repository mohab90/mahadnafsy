'use strict';

// «تقارير الإدارة» on the overview page (the owner, 11 Nov 2026): what each employee did in a period, and each branch's money, weekly and
// monthly (lib/managementReports.js). Read by whoever holds view_reports AND whose data scope reaches every branch (the owner, the
// managers) or exactly one (a branch manager: his branch only). A rep or a collection officer — scoped to their own clients — is refused.

const express = require('express');
const logger = require('../../lib/logger').child({ module: 'management-reports' });
const { cached } = require('../../lib/db');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { FinancialScopeError, resolveFinancialScope } = require('../../lib/financialScope');
const { buildBranchReport, buildEmployeeReport } = require('../../lib/managementReports');

const router = express.Router();
const guard = [requireAuth, requireAdminOrStaff, requirePermission('view_reports')];

const handler = build => async (req, res) => {
  let scope;
  try { scope = resolveFinancialScope(req); } catch (error) {
    if (error instanceof FinancialScopeError) return res.status(403).json({ error: 'التقرير ده للإدارة بس' });
    throw error;
  }
  try {
    // The same report asked again within a minute is the same answer: on 600,000 leads a past month takes 3–4 s to work out (lab, 12 Nov 2026), and
    // a screen that switches between its two tabs asks for each several times. «figures:» is dropped by the next write (lib/db.js cached).
    const { period = '', from = '', to = '' } = req.query;
    const key = `figures:management:${build.name}:${req.tenantId}:${scope.kind}:${scope.branchId || ''}:${period}:${from}:${to}`;
    res.json(await cached(key, 60 * 1000, () => build({ tenantId: req.tenantId, period: req.query, scope })));
  } catch (error) {
    logger.error('[management-reports]', error.message);
    res.status(500).json({ error: 'تعذر تجهيز التقرير' });
  }
};

router.get('/api/admin/reports/management/employees', ...guard, handler(buildEmployeeReport));
router.get('/api/admin/reports/management/branches', ...guard, handler(buildBranchReport));

module.exports = router;
