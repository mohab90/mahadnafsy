'use strict';

const express = require('express');
const router = express.Router();

const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const logger = require('../lib/logger').child({ module: 'crm-advanced-route' });
const { sanitize, tryJson } = require('../lib/helpers');
const { logLeadEvent } = require('../lib/crm');
const { DEFAULT_TENANT_ID, resolveTenantId } = require('../lib/tenantScope');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../middleware/auth');

const LEAD_STATUSES = new Set([
  'new',
  'contacted',
  'interested',
  'not_interested',
  'no_answer',
  'closed',
  'converted',
  'lost',
  'disqualified',
  'archived',
]);

function routeError(res, error, message = 'crm advanced route failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

function scopedTenantId(req) {
  return req.tenantId || resolveTenantId(req) || DEFAULT_TENANT_ID;
}

function leadTenantWhere(tenantId) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return '(tenant_id = ? OR tenant_id IS NULL OR tenant_id = \'\')';
  }
  return 'tenant_id = ?';
}

function actor(req) {
  return {
    uid: req.user?.uid || null,
    email: req.user?.email || null,
    staffId: req.staffRecord?.id || null,
    staffName: req.staffRecord?.name || null,
    staffRole: req.staffRecord?.role || null,
  };
}

async function loadAccessibleLead(req, leadId) {
  const tenantId = scopedTenantId(req);
  const [[lead]] = await pool.query(
    `SELECT id, tenant_id, name, status, crm_json, assigned_sales_id, assigned_sales_name
     FROM leads
     WHERE id = ? AND ${leadTenantWhere(tenantId)}
     LIMIT 1`,
    [leadId, tenantId]
  );
  if (!lead) return { status: 404, error: 'Lead not found' };

  const role = String(req.staffRecord?.role || '').toUpperCase();
  if (role === 'SALES' && lead.assigned_sales_id && lead.assigned_sales_id !== req.staffRecord.id) {
    return { status: 403, error: 'Lead is assigned to another sales user' };
  }

  return { lead, tenantId };
}

// PUT /api/admin/crm/leads/:id/status
router.put('/api/admin/crm/leads/:id/status', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!LEAD_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid lead status' });
    }

    const loaded = await loadAccessibleLead(req, req.params.id);
    if (!loaded.lead) return res.status(loaded.status).json({ error: loaded.error });
    const { lead, tenantId } = loaded;
    const previousStatus = String(lead.status || '').toLowerCase();

    await pool.query(
      `UPDATE leads SET status = ?, updated_at = NOW()
       WHERE id = ? AND ${leadTenantWhere(tenantId)}`,
      [status, lead.id, tenantId]
    );

    if (previousStatus !== status) {
      await logLeadEvent(lead.id, 'status_changed', `Status changed: ${previousStatus || 'unknown'} -> ${status}`, {
        from: previousStatus || null,
        to: status,
        actor: actor(req),
      });
    }

    res.json({ ok: true, id: lead.id, previousStatus, status });
  } catch (e) {
    routeError(res, e, 'crm status update failed');
  }
});

// POST /api/admin/crm/leads/:id/interactions
router.post('/api/admin/crm/leads/:id/interactions', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const type = sanitize(String(req.body?.type || 'note').trim().toLowerCase(), 80) || 'note';
    const notes = sanitize(String(req.body?.notes || req.body?.description || '').trim(), 2000);
    const outcome = sanitize(String(req.body?.outcome || '').trim(), 200);
    if (!notes) return res.status(400).json({ error: 'notes required' });

    const loaded = await loadAccessibleLead(req, req.params.id);
    if (!loaded.lead) return res.status(loaded.status).json({ error: loaded.error });
    const eventId = uuidv4();
    const meta = { type, outcome: outcome || null, actor: actor(req) };

    await pool.query(
      `INSERT INTO lead_timeline (id, lead_id, event_type, description, meta_json, at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [eventId, loaded.lead.id, 'interaction', notes, JSON.stringify(meta)]
    );

    res.json({ ok: true, id: eventId, leadId: loaded.lead.id });
  } catch (e) {
    routeError(res, e, 'crm interaction insert failed');
  }
});

// GET /api/admin/crm/leads/:id/interactions
router.get('/api/admin/crm/leads/:id/interactions', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const loaded = await loadAccessibleLead(req, req.params.id);
    if (!loaded.lead) return res.status(loaded.status).json({ error: loaded.error });

    const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 300);
    const [rows] = await pool.query(
      `SELECT id, lead_id, event_type, description, meta_json, at
       FROM lead_timeline
       WHERE lead_id = ?
       ORDER BY at DESC
       LIMIT ?`,
      [loaded.lead.id, limit]
    );

    res.json({
      ok: true,
      lead: {
        id: loaded.lead.id,
        name: loaded.lead.name,
        status: loaded.lead.status,
        assignedSalesId: loaded.lead.assigned_sales_id,
        assignedSalesName: loaded.lead.assigned_sales_name,
        crm: tryJson(loaded.lead.crm_json, {}),
      },
      timeline: rows.map(row => ({
        id: row.id,
        leadId: row.lead_id,
        type: row.event_type,
        description: row.description,
        meta: tryJson(row.meta_json, {}),
        at: row.at,
      })),
    });
  } catch (e) {
    routeError(res, e, 'crm timeline fetch failed');
  }
});

// POST /api/admin/crm/leads/smart-route
router.post('/api/admin/crm/leads/smart-route', requireAuth, requireAdmin, async (req, res) => {
  const tenantId = scopedTenantId(req);
  const limit = Math.min(Math.max(parseInt(req.body?.limit || '100', 10) || 100, 1), 500);
  const mode = req.body?.mode === 'all' ? 'all' : 'unassigned';
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const assignmentEvents = [];

    const targetWhere = mode === 'all'
      ? `hidden = 0 AND ${leadTenantWhere(tenantId)} AND status NOT IN ('converted','lost','archived','disqualified')`
      : `hidden = 0 AND ${leadTenantWhere(tenantId)} AND assigned_sales_id IS NULL AND status NOT IN ('converted','lost','archived','disqualified')`;

    const [targets] = await conn.query(
      `SELECT id FROM leads WHERE ${targetWhere} ORDER BY score DESC, created_at ASC LIMIT ?`,
      [tenantId, limit]
    );

    if (!targets.length) {
      await conn.commit();
      return res.json({ ok: true, assigned: 0, reason: 'No matching leads' });
    }

    const [reps] = await conn.query(`
      SELECT s.id, s.name, s.role, COUNT(l.id) AS active_leads
      FROM staff s
      LEFT JOIN leads l
        ON l.assigned_sales_id = s.id
       AND l.hidden = 0
       AND l.status NOT IN ('converted','lost','archived','disqualified')
       AND ${leadTenantWhere(tenantId).replace(/tenant_id/g, 'l.tenant_id')}
      WHERE UPPER(s.role) IN ('SALES','MANAGER') AND COALESCE(s.is_active, 1) = 1
      GROUP BY s.id, s.name, s.role
      ORDER BY active_leads ASC, s.name ASC
    `, [tenantId]);

    if (!reps.length) {
      await conn.commit();
      return res.status(409).json({ ok: false, assigned: 0, error: 'No active sales staff found' });
    }

    let assigned = 0;
    for (const target of targets) {
      reps.sort((a, b) => Number(a.active_leads || 0) - Number(b.active_leads || 0) || String(a.name).localeCompare(String(b.name)));
      const rep = reps[0];
      await conn.query(
        `UPDATE leads SET assigned_sales_id = ?, assigned_sales_name = ?, updated_at = NOW()
         WHERE id = ? AND ${leadTenantWhere(tenantId)}`,
        [rep.id, rep.name, target.id, tenantId]
      );
      rep.active_leads = Number(rep.active_leads || 0) + 1;
      assigned += 1;
      assignmentEvents.push({
        leadId: target.id,
        description: `Smart route assigned to ${rep.name || rep.id}`,
        meta: {
        salesId: rep.id,
        salesName: rep.name,
        mode,
        actor: actor(req),
        },
      });
    }

    await conn.commit();
    await Promise.allSettled(assignmentEvents.map(event =>
      logLeadEvent(event.leadId, 'assigned', event.description, event.meta)
    ));
    res.json({ ok: true, assigned, reps: reps.length, mode });
  } catch (e) {
    await conn.rollback().catch(() => {});
    routeError(res, e, 'crm smart route failed');
  } finally {
    conn.release();
  }
});

module.exports = router;
