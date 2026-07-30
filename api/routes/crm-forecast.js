'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { logLeadEventStrict } = require('../lib/crm');
const { loadCrmForecast, buildPipelineMovements } = require('../lib/crmForecast');
const { leadScope } = require('../lib/leadAccess');
const {
  requireAuth, requireAdminOrStaff, requirePermission,
} = require('../middleware/auth');

const CATEGORIES = new Set(['pipeline', 'best_case', 'commit']);
const money = value => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Number(number.toFixed(2)) : null;
};
const validDateOnly = value => {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

router.get(
  '/api/admin/crm/forecast',
  requireAuth,
  requireAdminOrStaff,
  requirePermission('view_leads'),
  async (req, res) => {
    const months = Math.min(Math.max(Number(req.query.months) || 3, 1), 12);
    const scope = leadScope(req, 'l');
    if (scope.none) {
      return res.json(await loadCrmForecast({
        tenantId: req.tenantId, scope, months, staffId: '__none__',
      }));
    }
    return res.json(await loadCrmForecast({
      tenantId: req.tenantId,
      scope,
      months,
      staffId: req.isSuperAdmin ? null : req.staffRecord?.id || '__none__',
    }));
  }
);

router.get(
  '/api/admin/crm/pipeline-movements',
  requireAuth,
  requireAdminOrStaff,
  requirePermission('view_leads'),
  async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    const scope = leadScope(req, 'l');
    if (scope.none) return res.json(buildPipelineMovements([]));
    const [rows] = await pool.query(
      `SELECT lt.id,lt.lead_id,lt.event_type,lt.meta_json,lt.at,
              l.name AS lead_name,l.assigned_sales_id,l.assigned_sales_name
         FROM lead_timeline lt
         JOIN leads l ON l.id=lt.lead_id AND l.tenant_id=lt.tenant_id
        WHERE lt.tenant_id=?
          AND lt.event_type IN ('status_changed','forecast_updated','assigned')
          AND lt.at>=DATE_SUB(NOW(),INTERVAL ? DAY)${scope.sql}
        ORDER BY lt.at DESC LIMIT 2000`,
      [req.tenantId, days, ...scope.params]
    );
    return res.json(buildPipelineMovements(rows));
  }
);

router.post(
  '/api/admin/crm/forecast/submissions',
  requireAuth,
  requireAdminOrStaff,
  requirePermission('manage_leads'),
  async (req, res) => {
    const period = String(req.body?.period || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return res.status(400).json({ error: 'period must use YYYY-MM' });
    }
    const pipelineEgp = money(req.body?.pipelineEgp);
    const bestCaseEgp = money(req.body?.bestCaseEgp);
    const commitEgp = money(req.body?.commitEgp);
    if ([pipelineEgp, bestCaseEgp, commitEgp].includes(null)
      || commitEgp > bestCaseEgp || bestCaseEgp > pipelineEgp) {
      return res.status(400).json({ error: 'Forecast amounts must satisfy 0 <= commit <= best case <= pipeline' });
    }
    const staffId = req.isSuperAdmin
      ? String(req.body?.staffId || '__org__').slice(0, 64)
      : String(req.staffRecord?.id || '');
    if (!staffId) return res.status(403).json({ error: 'Staff identity is required' });
    if (staffId !== '__org__') {
      const [[staff]] = await pool.query(
        'SELECT id FROM staff WHERE tenant_id=? AND id=? AND is_active=1 LIMIT 1',
        [req.tenantId, staffId]
      );
      if (!staff) return res.status(400).json({ error: 'Active tenant staff member not found' });
    }
    const id = uuidv4();
    await pool.query(
      `INSERT INTO crm_forecast_submissions
       (id,tenant_id,period,staff_id,pipeline_egp,best_case_egp,commit_egp,note,submitted_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id, req.tenantId, period, staffId, pipelineEgp, bestCaseEgp, commitEgp,
        String(req.body?.note || '').trim().slice(0, 1000) || null,
        String(req.user?.uid || req.user?.email || '').slice(0, 64) || null,
      ]
    );
    return res.status(201).json({ ok: true, id });
  }
);

router.patch(
  '/api/admin/crm/leads/:id/forecast',
  requireAuth,
  requireAdminOrStaff,
  requirePermission('manage_leads'),
  async (req, res) => {
    const category = req.body?.category == null ? null : String(req.body.category).toLowerCase();
    const probability = req.body?.probability == null ? null : Number(req.body.probability);
    const closeDate = req.body?.expectedCloseDate == null ? null : String(req.body.expectedCloseDate);
    const dealValue = req.body?.dealValueEgp == null ? null : money(req.body.dealValueEgp);
    if (category !== null && !CATEGORIES.has(category)) return res.status(400).json({ error: 'Invalid forecast category' });
    if (probability !== null && (!Number.isFinite(probability) || probability < 0 || probability > 100)) {
      return res.status(400).json({ error: 'probability must be between 0 and 100' });
    }
    if (closeDate !== null && !validDateOnly(closeDate)) {
      return res.status(400).json({ error: 'expectedCloseDate must use YYYY-MM-DD' });
    }
    if (req.body?.dealValueEgp != null && dealValue === null) {
      return res.status(400).json({ error: 'dealValueEgp must be a non-negative amount' });
    }
    const scope = leadScope(req, 'l');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[lead]] = await conn.query(
        `SELECT l.id,l.deal_value,l.forecast_category,l.forecast_probability,l.expected_close_date
           FROM leads l WHERE l.tenant_id=? AND l.id=? AND l.hidden=0
             AND l.deleted_at IS NULL${scope.sql || ''} LIMIT 1 FOR UPDATE`,
        [req.tenantId, req.params.id, ...(scope.params || [])]
      );
      if (!lead) {
        await conn.rollback();
        return res.status(404).json({ error: 'Lead not found in permitted scope' });
      }
      const after = {
        category: category ?? lead.forecast_category,
        probability: probability ?? (lead.forecast_probability == null ? null : Number(lead.forecast_probability)),
        expectedCloseDate: closeDate ?? lead.expected_close_date,
        dealValueEgp: dealValue ?? Number(lead.deal_value || 0),
      };
      await conn.query(
        `UPDATE leads SET deal_value=?,forecast_category=?,expected_close_date=?,
                forecast_probability=?,forecast_updated_by=?,forecast_updated_at=NOW()
          WHERE tenant_id=? AND id=?`,
        [
          after.dealValueEgp, after.category, after.expectedCloseDate, after.probability,
          String(req.user?.uid || req.user?.email || '').slice(0, 64) || null,
          req.tenantId, req.params.id,
        ]
      );
      await logLeadEventStrict(
        req.params.id,
        'forecast_updated',
        'CRM opportunity forecast updated',
        {
          before: {
            category: lead.forecast_category,
            probability: lead.forecast_probability,
            expectedCloseDate: lead.expected_close_date,
            dealValueEgp: Number(lead.deal_value || 0),
          },
          after,
          actor: req.user?.uid || req.user?.email || null,
        },
        req.tenantId,
        conn
      );
      await conn.commit();
      return res.json({ ok: true, forecast: after });
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    } finally {
      conn.release();
    }
  }
);

module.exports = router;
