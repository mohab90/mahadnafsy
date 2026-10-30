'use strict';

const { TERMINAL_SQL } = require('../lib/leadStatuses');
const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'crm-ops-route' });
const { pool, cached } = require('../lib/db');
const { queueLeadWhatsAppBatch } = require('../lib/leadInteractions');
const { leadScope } = require('../lib/leadAccess');
const { buildWorkQueue } = require('../lib/crmWorkQueue');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { whatsappSendLimiter } = require('../middleware/rateLimits');
const { sqlCairoToday } = require('../lib/dates');

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
        COALESCE(lc.last_date, l.last_follow_up, l.created_at) AS last_comm_date,
        DATEDIFF(NOW(), COALESCE(lc.last_date, l.last_follow_up, l.created_at)) AS days_silent
      FROM leads l
      LEFT JOIN (
        SELECT lead_id, MAX(date) AS last_date FROM communications
         WHERE tenant_id=? AND lead_id IS NOT NULL GROUP BY lead_id
      ) lc ON lc.lead_id = l.id
      WHERE l.tenant_id=? AND l.hidden=0 AND l.status NOT IN ${TERMINAL_SQL}`;
    // The newest message of every lead is read once from the communications index (tenant_id, lead_id, date) and joined
    // to the leads; joining the table to the leads and grouping them by id (4.0 s for 150,000 leads on the lab) was
    // the same answer in 1.4 s.
    const params = [req.tenantId, req.tenantId];
    const scope = leadScope(req, 'l');
    sql += scope.sql;
    params.push(...scope.params);
    sql += `
        AND (
          (l.next_follow_up_date IS NOT NULL AND l.next_follow_up_date < NOW())
          OR DATEDIFF(NOW(), COALESCE(lc.last_date, l.last_follow_up, l.created_at)) >= ?
        )
      ORDER BY days_silent DESC
      LIMIT 200`;
    params.push(days);
    // Every open lead's last message is needed to rank them, so the answer costs a pass over the leads (1.2-1.4 s at 150,000, about
    // three times that at the 520,000 production holds). Held for 15 s per scope and dropped by the next successful write
    // (dropFiguresAfterWrites in httpApp.js), like the counters on /leads/stats.
    const rows = await cached(`figures:crm-stale-leads:${req.tenantId}:${sql}:${JSON.stringify(params)}`, 15 * 1000,
      async () => (await pool.query(sql, params))[0]);
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
        AND l.next_follow_up_date <= ${sqlCairoToday()}
        AND l.status NOT IN ${TERMINAL_SQL}`;
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
    // The leads first, cut at the page; the message counts and the active sequence are then read for those leads only.
    // Both used to be aggregated over every communication and every enrolment of the tenant and joined to every lead
    // before the ORDER BY could cut anything (0.9-1.5 s at 150,000 leads and 40 messages each).
    const [leads] = await pool.query(
      `SELECT l.id,l.name,l.phone,l.email,l.status,l.source,l.branch,l.interest_level,
              l.score,l.deal_value,l.forecast_category,l.expected_close_date,
              l.next_follow_up_date,l.created_at,l.assigned_sales_id,l.assigned_sales_name
         FROM leads l
        WHERE l.tenant_id=? AND l.hidden=0 AND l.deleted_at IS NULL
          AND l.status NOT IN ${TERMINAL_SQL}
          ${scope.sql}
        ORDER BY l.score DESC,l.created_at ASC
        LIMIT ?`,
      [req.tenantId, ...scope.params, Math.max(sourceLimit * 4, 250)]
    );
    const ids = leads.map(lead => lead.id);
    const [comms, sequences] = ids.length ? await Promise.all([
      pool.query(
        `SELECT lead_id,COUNT(*) AS communication_count,MAX(date) AS last_communication_at
           FROM communications WHERE tenant_id=? AND lead_id IN (?) GROUP BY lead_id`,
        [req.tenantId, ids]).then(([result]) => result),
      pool.query(
        `SELECT lead_id,MIN(sequence_id) AS active_sequence_id
           FROM drip_enrollments
          WHERE tenant_id=? AND status IN ('active','paused') AND lead_id IN (?)
          GROUP BY lead_id`,
        [req.tenantId, ids]).then(([result]) => result),
    ]) : [[], []];
    const commByLead = new Map(comms.map(row => [row.lead_id, row]));
    const sequenceByLead = new Map(sequences.map(row => [row.lead_id, row]));
    const rows = leads.map(lead => ({
      ...lead,
      communication_count: commByLead.get(lead.id)?.communication_count ?? null,
      last_communication_at: commByLead.get(lead.id)?.last_communication_at ?? null,
      active_sequence_id: sequenceByLead.get(lead.id)?.active_sequence_id ?? null,
    }));
    res.json(buildWorkQueue(rows, { limit: sourceLimit }));
  } catch (error) {
    routeError(res, error, 'CRM work queue failed');
  }
});

module.exports = router;
