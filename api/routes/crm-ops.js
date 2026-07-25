'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'crm-ops-route' });
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { logLeadEvent } = require('../lib/crm');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { whatsappSendLimiter } = require('../middleware/rateLimits');
const outbox = require('../lib/outbox');

function routeError(res, error, message = 'crm ops route failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

router.get('/api/admin/crm/stale-leads', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  const days = Math.min(parseInt(req.query.days || '7'), 90);
  try {
    let sql = `
      SELECT
        l.id, l.name, l.email, l.phone, l.status, l.interest_level,
        l.next_follow_up_date, l.last_follow_up,
        l.assigned_sales_name, l.assigned_cs_name,
        COALESCE(MAX(c.date), l.last_follow_up, l.created_at) AS last_comm_date,
        DATEDIFF(NOW(), COALESCE(MAX(c.date), l.last_follow_up, l.created_at)) AS days_silent
      FROM leads l
      LEFT JOIN communications c ON c.lead_id = l.id
      WHERE l.tenant_id=? AND l.hidden=0 AND l.status NOT IN ('converted','lost','not_interested')`;
    const params = [req.tenantId];
    const staffRole = (req.staffRecord?.role || '').toUpperCase();
    if (req.staffRecord && !req.isSuperAdmin) {
      if (staffRole === 'SALES') {
        sql += ' AND l.assigned_sales_id = ?';
        params.push(req.staffRecord.id);
      } else if (staffRole === 'COLLECTION' || staffRole === 'CS') {
        sql += ' AND l.id IN (SELECT lead_id FROM subscribers WHERE tenant_id=? AND assigned_cs_id=? AND lead_id IS NOT NULL)';
        params.push(req.tenantId, req.staffRecord.id);
      }
    }
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
        AND l.next_follow_up_date <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        AND l.status NOT IN ('converted','lost')`;
    const params = [req.tenantId];
    const fuRole = (req.staffRecord?.role || '').toUpperCase();
    if (req.staffRecord && !req.isSuperAdmin) {
      if (fuRole === 'SALES') {
        sql += ' AND l.assigned_sales_id = ?';
        params.push(req.staffRecord.id);
      } else if (fuRole === 'COLLECTION' || fuRole === 'CS') {
        sql += ' AND l.id IN (SELECT lead_id FROM subscribers WHERE tenant_id=? AND assigned_cs_id=? AND lead_id IS NOT NULL)';
        params.push(req.tenantId, req.staffRecord.id);
      }
    }
    sql += ' ORDER BY l.next_follow_up_date ASC LIMIT 100';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/crm/bulk-whatsapp', requireAuth, requireAdminOrStaff, requirePermission('bulk_whatsapp'), whatsappSendLimiter, async (req, res) => {
  const { leads = [], message } = req.body || {};
  if (!message || !leads.length) return res.status(400).json({ error: 'leads[] and message required' });
  if (leads.length > 100) return res.status(400).json({ error: 'max 100 leads per batch' });
  const leadIds = [...new Set(leads.map(lead => String(lead.id || '')).filter(Boolean))];
  if (!leadIds.length) return res.status(400).json({ error: 'valid lead ids required' });
  const params = [req.tenantId, ...leadIds];
  let ownership = '';
  if (req.staffRecord?.role === 'SALES') {
    ownership = ' AND assigned_sales_id=?';
    params.push(req.staffRecord.id);
  }
  const [ownedLeads] = await pool.query(
    `SELECT id, name, phone FROM leads WHERE tenant_id=? AND id IN (${leadIds.map(() => '?').join(',')}) AND hidden=0${ownership}`,
    params
  );
  // Enqueued via the durable outbox (drained by the background worker) instead of
  // sent inline — the previous loop awaited sendWhatsApp() plus 3 sequential DB
  // queries per lead, blocking the request for the full batch's real API latency
  // with no retry on failure (PERF-02).
  const results = [];
  for (const lead of ownedLeads) {
    const phone = (lead.phone || '').replace(/\D/g, '');
    const personalMsg = message.replace(/\{name\}/g, lead.name || '');
    await outbox.enqueue({
      channel: 'whatsapp', recipient: phone,
      payload: { message: personalMsg },
      tenantId: req.tenantId, refType: 'lead', refId: lead.id,
    });
    await pool.query(
      `INSERT INTO communications (id, lead_id, type, date, notes, staff_id)
       VALUES (?, ?, 'WHATSAPP', NOW(), ?, ?)`,
      [uuidv4(), lead.id, `رسالة جماعية: ${personalMsg.substring(0, 100)}`, req.user?.uid || null]
    );
    await pool.query('UPDATE leads SET last_follow_up=NOW() WHERE id=? AND tenant_id=?', [lead.id, req.tenantId]);
    await logLeadEvent(lead.id, 'WHATSAPP_QUEUED', `جدولة رسالة جماعية للرقم ${phone}`,
      { msg: personalMsg.substring(0, 200), sender: req.user?.email }, req.tenantId);
    results.push({ id: lead.id, phone, ok: true, err: null });
  }
  // `sent`/`failed` kept for the existing frontend caller (LeadsTab.tsx) — matches
  // the already-established "queued now means sent" wording used for email/SMS campaigns.
  res.json({ ok: true, sent: results.length, failed: 0, queued: results.length, results });
});

module.exports = router;
