'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'crm-ops-route' });
const { pool } = require('../lib/db');
const { queueLeadWhatsAppBatch } = require('../lib/leadInteractions');
const { leadScope } = require('../lib/leadAccess');
const { buildWorkQueue } = require('../lib/crmWorkQueue');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { whatsappSendLimiter } = require('../middleware/rateLimits');

function routeError(res, error, message = 'crm ops route failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

router.get('/api/admin/crm/stale-leads', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days || '7', 10) || 7, 1), 90);
  try {
    let sql = `
      SELECT
        l.id, l.name, l.email, l.phone, l.status, l.interest_level,
        l.next_follow_up_date, l.last_follow_up,
        l.assigned_sales_name, l.assigned_cs_name,
        COALESCE(MAX(c.date), l.last_follow_up, l.created_at) AS last_comm_date,
        DATEDIFF(NOW(), COALESCE(MAX(c.date), l.last_follow_up, l.created_at)) AS days_silent
      FROM leads l
      LEFT JOIN communications c ON c.tenant_id = l.tenant_id AND c.lead_id = l.id
      WHERE l.tenant_id=? AND l.hidden=0 AND l.status NOT IN ('converted','lost','not_interested')`;
    const params = [req.tenantId];
    const scope = leadScope(req, 'l');
    sql += scope.sql;
    params.push(...scope.params);
    sql += `
      GROUP BY l.id
      HAVING
        (l.next_follow_up_date IS NOT NULL AND l.next_follow_up_date < NOW())
        OR days_silent >= ?
      ORDER BY days_silent DESC
      LIMIT 200`;
    params.push(days);
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { routeError(res, e); }
});

router.get('/api/admin/crm/follow-up-due', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    let sql = `
      SELECT
        l.id, l.name, l.email, l.phone, l.status, l.interest_level,
        l.next_follow_up_date, l.assigned_sales_name, l.assigned_cs_name,
        DATEDIFF(NOW(), l.next_follow_up_date) AS overdue_days
      FROM leads l
      WHERE l.tenant_id=? AND l.hidden=0
        AND l.next_follow_up_date IS NOT NULL
        AND l.next_follow_up_date <= CURDATE()
        AND l.status NOT IN ('converted','lost')`;
    const params = [req.tenantId];
    const scope = leadScope(req, 'l');
    sql += scope.sql;
    params.push(...scope.params);
    sql += ' ORDER BY l.next_follow_up_date ASC LIMIT 100';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/crm/bulk-whatsapp', requireAuth, requireAdminOrStaff, requirePermission('bulk_whatsapp'), whatsappSendLimiter, async (req, res) => {
  try {
    const { leads = [], message } = req.body || {};
    if (!message || !leads.length) return res.status(400).json({ error: 'leads[] and message required' });
    if (leads.length > 100) return res.status(400).json({ error: 'max 100 leads per batch' });
    const results = await queueLeadWhatsAppBatch({
      tenantId: req.tenantId,
      leadIds: leads.map(lead => lead.id),
      message,
      actor: { email: req.user?.email || null, name: req.staffRecord?.name || null },
      staffId: req.staffRecord?.id || null,
      accessScope: leadScope(req, 'l'),
    });
    res.json({ ok: true, sent: results.length, failed: 0, queued: results.length, results });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    routeError(res, error, 'crm whatsapp batch failed');
  }
});

router.get('/api/admin/crm/work-queue', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const scope = leadScope(req, 'l');
    if (scope.none) return res.json(buildWorkQueue([]));
    const sourceLimit = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 250);
    const [rows] = await pool.query(
      `SELECT l.id,l.name,l.phone,l.email,l.status,l.source,l.branch,l.interest_level,
              l.score,l.deal_value,l.forecast_category,l.expected_close_date,
              l.next_follow_up_date,l.created_at,l.assigned_sales_id,l.assigned_sales_name,
              comm.communication_count,comm.last_communication_at,
              seq.active_sequence_id
         FROM leads l
         LEFT JOIN (
           SELECT tenant_id,lead_id,COUNT(*) AS communication_count,MAX(date) AS last_communication_at
             FROM communications WHERE tenant_id=? GROUP BY tenant_id,lead_id
         ) comm ON comm.tenant_id=l.tenant_id AND comm.lead_id=l.id
         LEFT JOIN (
           SELECT tenant_id,lead_id,MIN(sequence_id) AS active_sequence_id
             FROM drip_enrollments
            WHERE tenant_id=? AND status IN ('active','paused') AND lead_id IS NOT NULL
            GROUP BY tenant_id,lead_id
         ) seq ON seq.tenant_id=l.tenant_id AND seq.lead_id=l.id
        WHERE l.tenant_id=? AND l.hidden=0 AND l.deleted_at IS NULL
          AND LOWER(l.status) NOT IN ('converted','lost','archived','disqualified','not_interested','wrong_number','junk')
          ${scope.sql}
        ORDER BY l.score DESC,l.created_at ASC
        LIMIT ?`,
      [req.tenantId, req.tenantId, req.tenantId, ...scope.params, Math.max(sourceLimit * 4, 250)]
    );
    res.json(buildWorkQueue(rows, { limit: sourceLimit }));
  } catch (error) {
    routeError(res, error, 'CRM work queue failed');
  }
});

module.exports = router;
