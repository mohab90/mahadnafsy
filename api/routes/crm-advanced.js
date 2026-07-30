'use strict';

const express = require('express');
const router = express.Router();

const { pool } = require('../lib/db');
const logger = require('../lib/logger').child({ module: 'crm-advanced-route' });
const { sanitize, tryJson } = require('../lib/helpers');
const { logLeadEventStrict } = require('../lib/crm');
const { appendLeadInteraction, deleteLeadInteraction } = require('../lib/leadInteractions');
const { leadScope } = require('../lib/leadAccess');
const { normalizeLeadStatus, transitionLead } = require('../lib/leadState');
const { listPipeline, savePipeline } = require('../lib/leadPipeline');
const { listAssignmentMembers, saveAssignmentMembers } = require('../lib/leadAssignmentPolicy');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');

function routeError(res, error, message = 'crm advanced route failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

function scopedTenantId(req) {
  return req.tenantId;
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

router.get('/api/admin/crm/pipeline', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    res.json({ stages: await listPipeline(req.tenantId) });
  } catch (e) {
    routeError(res, e, 'crm pipeline fetch failed');
  }
});

router.put('/api/admin/crm/pipeline', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const stages = await savePipeline(req.tenantId, req.body?.stages, conn);
    await conn.commit();
    res.json({ ok: true, stages });
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    routeError(res, e, 'crm pipeline save failed');
  } finally {
    conn.release();
  }
});

router.get('/api/admin/crm/assignment-members', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  try {
    res.json({ members: await listAssignmentMembers(req.tenantId) });
  } catch (e) {
    routeError(res, e, 'crm assignment policy fetch failed');
  }
});

router.put('/api/admin/crm/assignment-members', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const members = await saveAssignmentMembers(req.tenantId, req.body?.members, conn);
    await conn.commit();
    res.json({ ok: true, members });
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    routeError(res, e, 'crm assignment policy save failed');
  } finally {
    conn.release();
  }
});

async function loadAccessibleLead(req, leadId, db = pool, forUpdate = false) {
  const tenantId = scopedTenantId(req);
  const scope = leadScope(req, 'l');
  const [[lead]] = await db.query(
    `SELECT id, tenant_id, name, status, crm_json, assigned_sales_id, assigned_sales_name
     FROM leads l
     WHERE id = ? AND l.tenant_id = ?${scope.sql}
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [leadId, tenantId, ...scope.params]
  );
  if (!lead) return { status: 404, error: 'Lead not found' };

  return { lead, tenantId };
}

// PUT /api/admin/crm/leads/:id/status
router.put('/api/admin/crm/leads/:id/status', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const status = normalizeLeadStatus(req.body?.status);
    await conn.beginTransaction();
    const loaded = await loadAccessibleLead(req, req.params.id, conn, true);
    if (!loaded.lead) {
      await conn.rollback();
      return res.status(loaded.status).json({ error: loaded.error });
    }
    const { lead, tenantId } = loaded;
    const previousStatus = String(lead.status || '').toLowerCase();

    await transitionLead({ tenantId, leadId: lead.id, toStatus: status, actor: actor(req), db: conn });

    await conn.commit();
    res.json({ ok: true, id: lead.id, previousStatus, status });
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    routeError(res, e, 'crm status update failed');
  } finally {
    conn.release();
  }
});

// POST /api/admin/crm/leads/:id/interactions
router.post('/api/admin/crm/leads/:id/interactions', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const type = sanitize(String(req.body?.type || 'note').trim().toLowerCase(), 80) || 'note';
    const notes = sanitize(String(req.body?.notes || req.body?.description || '').trim(), 2000);
    const outcome = sanitize(String(req.body?.outcome || '').trim(), 200);
    const date = req.body?.date || null;
    const nextFollowUp = req.body?.nextFollowUp || null;
    if (!notes) return res.status(400).json({ error: 'notes required' });

    await conn.beginTransaction();
    const loaded = await loadAccessibleLead(req, req.params.id, conn, true);
    if (!loaded.lead) {
      await conn.rollback();
      return res.status(loaded.status).json({ error: loaded.error });
    }
    const result = await appendLeadInteraction({
      tenantId: loaded.tenantId,
      leadId: loaded.lead.id,
      interaction: { type, notes, outcome, date, nextFollowUp },
      actor: actor(req),
      staffId: req.staffRecord?.id || null,
      db: conn,
    });
    const requestedStatus = req.body?.newStatus
      ? normalizeLeadStatus(req.body.newStatus)
      : (String(loaded.lead.status || '').toLowerCase() === 'new' ? 'contacted' : null);
    if (requestedStatus && requestedStatus !== String(loaded.lead.status || '').toLowerCase()) {
      await transitionLead({
        tenantId: loaded.tenantId,
        leadId: loaded.lead.id,
        toStatus: requestedStatus,
        actor: actor(req),
        db: conn,
      });
    }
    if (requestedStatus === 'not_interested_hidden') {
      await conn.query(
        'UPDATE leads SET hidden=1,updated_at=NOW() WHERE tenant_id=? AND id=?',
        [loaded.tenantId, loaded.lead.id]
      );
    }
    await conn.commit();
    res.json({ ok: true, id: result.id, leadId: loaded.lead.id, status: requestedStatus || loaded.lead.status });
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    routeError(res, e, 'crm interaction insert failed');
  } finally {
    conn.release();
  }
});

router.delete('/api/admin/crm/leads/:leadId/interactions/:interactionId', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const loaded = await loadAccessibleLead(req, req.params.leadId, conn, true);
    if (!loaded.lead) {
      await conn.rollback();
      return res.status(loaded.status).json({ error: loaded.error });
    }
    const result = await deleteLeadInteraction({
      tenantId: loaded.tenantId,
      leadId: loaded.lead.id,
      interactionId: req.params.interactionId,
      actor: actor(req),
      db: conn,
    });
    await conn.commit();
    res.json({ ok: true, ...result });
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    routeError(res, e, 'crm interaction delete failed');
  } finally {
    conn.release();
  }
});

// GET /api/admin/crm/leads/:id/interactions
router.get('/api/admin/crm/leads/:id/interactions', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const loaded = await loadAccessibleLead(req, req.params.id);
    if (!loaded.lead) return res.status(loaded.status).json({ error: loaded.error });

    const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 300);
    const [[rows], [communications]] = await Promise.all([
      pool.query(
        `SELECT id, lead_id, event_type, description, meta_json, at
           FROM lead_timeline
          WHERE tenant_id=? AND lead_id = ?
          ORDER BY at DESC LIMIT ?`,
        [loaded.tenantId, loaded.lead.id, limit]
      ),
      pool.query(
        `SELECT id,type,date,notes,outcome,next_follow_up,staff_id
           FROM communications
          WHERE tenant_id=? AND lead_id = ?
          ORDER BY date DESC,id DESC LIMIT ?`,
        [loaded.tenantId, loaded.lead.id, limit]
      ),
    ]);

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
      communications: communications.map(row => ({
        id: row.id,
        type: String(row.type || 'note').toLowerCase(),
        date: row.date,
        notes: row.notes,
        outcome: row.outcome || undefined,
        nextFollowUp: row.next_follow_up || undefined,
        staffId: row.staff_id || undefined,
      })),
    });
  } catch (e) {
    routeError(res, e, 'crm timeline fetch failed');
  }
});

// POST /api/admin/crm/leads/smart-route
router.post('/api/admin/crm/leads/smart-route', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  const tenantId = scopedTenantId(req);
  const limit = Math.min(Math.max(parseInt(req.body?.limit || '100', 10) || 100, 1), 500);
  const mode = req.body?.mode === 'all' ? 'all' : 'unassigned';
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const [targets] = await conn.query(
      `SELECT id,assigned_sales_id,assigned_sales_name
       FROM leads
       WHERE tenant_id=? AND hidden=0
         AND (?='all' OR assigned_sales_id IS NULL)
         AND status NOT IN ('converted','lost','archived','disqualified')
       ORDER BY score DESC, created_at ASC LIMIT ? FOR UPDATE`,
      [tenantId, mode, limit]
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
       AND l.tenant_id=?
      WHERE s.tenant_id=? AND UPPER(s.role)='SALES' AND COALESCE(s.is_active, 1) = 1 AND s.deleted_at IS NULL
      GROUP BY s.id, s.name, s.role
      ORDER BY active_leads ASC, s.name ASC
    `, [tenantId, tenantId]);

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
         WHERE id = ? AND tenant_id=?`,
        [rep.id, rep.name, target.id, tenantId]
      );
      rep.active_leads = Number(rep.active_leads || 0) + 1;
      assigned += 1;
      await logLeadEventStrict(target.id, 'assigned', `Smart route assigned to ${rep.name || rep.id}`, {
        fromSalesId: target.assigned_sales_id || null,
        fromSalesName: target.assigned_sales_name || null,
        salesId: rep.id,
        salesName: rep.name,
        mode,
        actor: actor(req),
      }, tenantId, conn);
    }

    await conn.commit();
    res.json({ ok: true, assigned, reps: reps.length, mode });
  } catch (e) {
    await conn.rollback().catch(() => {});
    routeError(res, e, 'crm smart route failed');
  } finally {
    conn.release();
  }
});

module.exports = router;
