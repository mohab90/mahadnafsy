'use strict';

const { TERMINAL_SQL } = require('../lib/leadStatuses');
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
const { createRepRotation, listDistributableReps } = require('../lib/leadAssignment');
const { excludeArchiveSourcesSql } = require('../lib/leadArchive');
const { buildTeamDailyReport, listReceivedLeads, reportRange } = require('../lib/teamDailyReport');
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

// GET /api/admin/crm/team-report?from=YYYY-MM-DD&to=YYYY-MM-DD — «أداء الفريق»'s
// daily report, per rep, over Cairo days (lib/teamDailyReport.js). A rep sees
// their own row only.
router.get('/api/admin/crm/team-report', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const range = reportRange(req.query);
    const isSales = String(req.staffRecord?.role || '').toLowerCase() === 'sales';
    res.json(await buildTeamDailyReport({
      tenantId: req.tenantId, ...range, onlyRepId: isSales ? req.staffRecord.id : null,
    }));
  } catch (e) {
    routeError(res, e, 'crm team report failed');
  }
});

// GET /api/admin/crm/team-report/received?rep=…&from=…&to=… — the leads behind
// one rep's «ليدز استلمها». A rep may ask for their own only.
router.get('/api/admin/crm/team-report/received', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const range = reportRange(req.query);
    const isSales = String(req.staffRecord?.role || '').toLowerCase() === 'sales';
    const repId = isSales ? req.staffRecord.id : String(req.query.rep || '');
    if (!repId) return res.status(400).json({ error: 'rep is required' });
    res.json({ ...range, rows: await listReceivedLeads({ tenantId: req.tenantId, repId, ...range }) });
  } catch (e) {
    routeError(res, e, 'crm team report received failed');
  }
});

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

async function loadAccessibleLead(req, leadId, db = pool, forUpdate = false, followMerge = true) {
  const tenantId = scopedTenantId(req);
  const scope = leadScope(req, 'l');
  const [[lead]] = await db.query(
    `SELECT id, tenant_id, name, status, crm_json, assigned_sales_id, assigned_sales_name
     FROM leads l
     WHERE id = ? AND l.tenant_id = ?${scope.sql}
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [leadId, tenantId, ...scope.params]
  );
  if (lead) return { lead, tenantId };
  // Said in the rep's words, the way the hide route says it: a contact logged
  // on a lead that had moved to someone else came back «Lead not found» — the
  // errors that showed «on some clients only» (9 on 6–7 Oct). A lead merged
  // into another is that other one now.
  const [[elsewhere]] = await db.query(
    'SELECT id, merged_into_lead_id FROM leads WHERE id = ? AND tenant_id = ? LIMIT 1', [leadId, tenantId]);
  if (elsewhere?.merged_into_lead_id && followMerge) {
    return loadAccessibleLead(req, elsewhere.merged_into_lead_id, db, forUpdate, false);
  }
  return elsewhere
    ? { status: 404, error: 'العميل ده مبقاش معاك — اتنقل لحد تاني. حدّث الصفحة.', code: 'LEAD_MOVED' }
    : { status: 404, error: 'العميل ده مش موجود — حدّث الصفحة.', code: 'LEAD_NOT_FOUND' };
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
      return res.status(loaded.status).json({ error: loaded.error, code: loaded.code });
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

// PUT /api/admin/crm/leads/:id/follow-up { date: 'YYYY-MM-DD' | null } — move or
// clear one lead's follow-up: «بكرة» on the follow-ups page. The whole lead was
// re-sent for it, and the date only ever reached crm_json.
router.put('/api/admin/crm/leads/:id/follow-up', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  const raw = req.body?.date;
  const date = raw == null || raw === '' ? null : String(raw).slice(0, 10);
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD or null' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const loaded = await loadAccessibleLead(req, req.params.id, conn, true);
    if (!loaded.lead) {
      await conn.rollback();
      return res.status(loaded.status).json({ error: loaded.error, code: loaded.code });
    }
    await conn.query(
      `UPDATE leads SET crm_json=CASE WHEN NOT JSON_VALID(crm_json) THEN crm_json
                                      WHEN ? IS NULL THEN JSON_REMOVE(crm_json, '$.nextFollowUpDate')
                                      ELSE JSON_SET(crm_json, '$.nextFollowUpDate', ?) END,
                        next_follow_up_date=?, updated_at=NOW()
        WHERE tenant_id=? AND id=?`,
      [date, date, date, loaded.tenantId, loaded.lead.id]);
    await logLeadEventStrict(loaded.lead.id, 'followup_set', date ? `موعد متابعة: ${date}` : 'اتشال ميعاد المتابعة',
      { date, actor: actor(req) }, loaded.tenantId, conn);
    await conn.commit();
    res.json({ ok: true, id: loaded.lead.id, nextFollowUpDate: date });
  } catch (e) {
    await conn.rollback().catch(() => {});
    routeError(res, e, 'crm follow-up update failed');
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
    const closeFollowUp = req.body?.closeFollowUp === true;
    if (!notes) return res.status(400).json({ error: 'notes required' });

    await conn.beginTransaction();
    const loaded = await loadAccessibleLead(req, req.params.id, conn, true);
    if (!loaded.lead) {
      await conn.rollback();
      return res.status(loaded.status).json({ error: loaded.error, code: loaded.code });
    }
    const result = await appendLeadInteraction({
      tenantId: loaded.tenantId,
      leadId: loaded.lead.id,
      interaction: { type, notes, outcome, date, nextFollowUp, closeFollowUp },
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
      return res.status(loaded.status).json({ error: loaded.error, code: loaded.code });
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
    if (!loaded.lead) return res.status(loaded.status).json({ error: loaded.error, code: loaded.code });

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
    // Archive rows ("محلي قديم" …) are distributed by hand from their own tab.
    const archive = excludeArchiveSourcesSql('source');
    const [targets] = await conn.query(
      `SELECT id,assigned_sales_id,assigned_sales_name,source,interested_course_ids_json,crm_json
       FROM leads
       WHERE tenant_id=? AND hidden=0
         AND (?='all' OR (assigned_sales_id IS NULL AND (assigned_cs_id IS NULL OR assigned_cs_id='')))
         AND status NOT IN ${TERMINAL_SQL}${archive.sql}
       ORDER BY score DESC, created_at ASC LIMIT ? FOR UPDATE`,
      [tenantId, mode, ...archive.params, limit]
    );

    if (!targets.length) {
      await conn.commit();
      return res.json({ ok: true, assigned: 0, reason: 'No matching leads' });
    }

    // Only the reps switched on in the CRM "التوزيع" screen, with their caps.
    const reps = await listDistributableReps(tenantId, conn);
    if (!reps.length) {
      await conn.commit();
      return res.status(409).json({ ok: false, assigned: 0, error: 'لا يوجد مندوب مبيعات مفعّل للتوزيع' });
    }
    const rotation = createRepRotation(reps, { mode: 'least' });

    let assigned = 0;
    for (const target of targets) {
      // null: nobody's course and source rules take this one.
      const rep = rotation.next(target);
      if (!rep) continue;
      await conn.query(
        `UPDATE leads SET assigned_sales_id = ?, assigned_sales_name = ?, updated_at = NOW()
         WHERE id = ? AND tenant_id=?`,
        [rep.id, rep.name, target.id, tenantId]
      );
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
