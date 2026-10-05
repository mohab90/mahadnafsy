'use strict';
// Handing leads to reps and collection officers, and messaging them in bulk.
// One part of routes/admin/leads.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  pool,
  LEAD_STATUSES,
  isOpenLeadStatus,
  sanitize,
  sendRouteError,
  createNotification,
  logLeadEventStrict,
  createRepRotation,
  listDistributableReps,
  excludeArchiveSourcesSql,
  queueLeadWhatsAppBatch,
  leadScope,
  requireAuth,
  requireAdminOrStaff,
  requirePermission,
  bulkOperationLimiter,
  logger,
} = require('./_shared');

const router = Router();

// POST /api/admin/leads/bulk-assign — assign all unassigned NEW/INTERESTED leads to sales round-robin
router.post('/api/admin/leads/bulk-assign', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), bulkOperationLimiter, async (req, res) => {
  let conn = null;
  let transactionStarted = false;
  try {
    // Desk work: a rep or a collection officer edits their own leads, not the pool.
    if (['sales', 'collection'].includes(String(req.staffRecord?.role || '').toLowerCase())) return res.status(403).json({ error: 'غير مصرح' });
    const { statusFilter } = req.body || {};
    conn = await pool.getConnection();
    await conn.beginTransaction();
    transactionStarted = true;
    // Only the reps switched on in the CRM "التوزيع" screen.
    const reps = await listDistributableReps(req.tenantId, conn);
    if (!reps.length) {
      await conn.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'لا يوجد مندوب مبيعات مفعّل للتوزيع' });
    }

    // Get unassigned leads (excluding converted/lost/hidden)
    //
    // That is what this always meant, and it now says so. The list used to be
    // ['new','interested'] and their upper-case twins, so a lead the desk had
    // marked interested_booking, interested_followup, contacted or no_answer_wa
    // was silently left out of every distribution — the interested_booking ones
    // being the closest to buying of anything in the table.
    const statusIn = statusFilter
      ? [statusFilter]
      : [...LEAD_STATUSES].filter(isOpenLeadStatus);
    const placeholders = statusIn.map(() => '?').join(',');
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) {
      await conn.rollback(); transactionStarted = false;
      return res.status(403).json({ error: 'Lead assignment is outside your data scope' });
    }
    const archive = excludeArchiveSourcesSql('l.source');
    const [unassigned] = await conn.query(
      `SELECT l.id,l.source,l.interested_course_ids_json,l.crm_json FROM leads l
        WHERE l.tenant_id=? AND (l.assigned_sales_id IS NULL OR l.assigned_sales_id = '')
          AND (l.assigned_cs_id IS NULL OR l.assigned_cs_id = '')
          AND l.status IN (${placeholders}) AND l.hidden=0${accessScope.sql}${archive.sql}
        FOR UPDATE`,
      [req.tenantId, ...statusIn, ...accessScope.params, ...archive.params]
    );

    if (!unassigned.length) {
      await conn.commit(); transactionStarted = false;
      return res.json({ assigned: 0, message: 'لا يوجد ليدز غير معيّنة' });
    }

    const updates = [];
    const rotation = createRepRotation(reps);
    for (const lead of unassigned) {
      // null: nobody's course and source rules take this one — it stays in the pool.
      const rep = rotation.next(lead);
      if (!rep) continue;
      updates.push({ id: lead.id, salesId: rep.id, salesName: rep.name });
    }

    // Batch update via CASE WHEN for efficiency
    const BATCH = 500;
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);
      if (!batch.length) continue;
      const caseId   = batch.map(u => `WHEN id = ? THEN ?`).join(' ');
      const caseName = batch.map(u => `WHEN id = ? THEN ?`).join(' ');
      const ids      = batch.map(u => u.id);
      const valId    = batch.flatMap(u => [u.id, u.salesId]);
      const valName  = batch.flatMap(u => [u.id, u.salesName]);
      await conn.query(
        `UPDATE leads SET assigned_sales_id = CASE ${caseId} END, assigned_sales_name = CASE ${caseName} END WHERE tenant_id=? AND id IN (${ids.map(() => '?').join(',')})`,
        [...valId, ...valName, req.tenantId, ...ids]
      );
    }
    for (const update of updates) {
      await logLeadEventStrict(
        update.id, 'assigned', `تعيين جماعي لـ: ${update.salesName || update.salesId}`,
        { fromSalesId: null, salesId: update.salesId, salesName: update.salesName, actor: req.user?.email || 'admin' },
        req.tenantId, conn
      );
    }
    await conn.commit();
    transactionStarted = false;

    res.json({ assigned: updates.length, unassigned: unassigned.length - updates.length, reps: reps.length, message: `تم توزيع ${updates.length} ليد على ${reps.length} مندوب` });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[bulk-assign]', e.message); sendRouteError(res, e);
  } finally { conn?.release(); }
});

// POST /api/admin/leads/assign-collection — hand chosen leads to one
// collection officer. Body: { leadIds: string[], staffId, includeAssigned? }
//
// «في تاب محلي جديد ومحلي قديم ودولي قديم اني اوزع الداتا علي فريق التحصيل
// لكن ميكونوش في التوزيع الرئيسي لكن في الداتا المتبقيه اوزعلهم منها». The
// collection team is not in the automatic distribution; the desk hands them
// what is left, from those three tabs. The screen used to save each lead with
// an assignedCollectionId that only reached crm_json, so the officer's scope —
// the assigned_cs_id column — never showed them any of it.
//
// What is left means nobody has it: a lead with a sales rep or another officer
// is skipped unless the desk says to take it over.
router.post('/api/admin/leads/assign-collection', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), bulkOperationLimiter, async (req, res) => {
  const role = String(req.staffRecord?.role || '').toLowerCase();
  if (['sales', 'collection'].includes(role)) return res.status(403).json({ error: 'التوزيع شغل المسئول' });
  const leadIds = [...new Set((Array.isArray(req.body?.leadIds) ? req.body.leadIds : []).map(String).filter(Boolean))];
  const includeAssigned = req.body?.includeAssigned === true;
  // Where the batch lives afterwards, as the sales distribution already lets
  // the desk choose («وجهة الداتا بعد التوزيع»); absent, it stays where it is.
  const source = sanitize(req.body?.source || '', 200) || null;
  if (!leadIds.length) return res.status(400).json({ error: 'اختار العملاء اللي هتوزعهم' });
  if (leadIds.length > 5000) return res.status(400).json({ error: 'أقصى عدد في المرة 5000' });
  const conn = await pool.getConnection();
  try {
    const [[officer]] = await conn.query(
      `SELECT id, name FROM staff WHERE tenant_id=? AND id=? AND UPPER(role)='COLLECTION'
          AND is_active=1 AND deleted_at IS NULL LIMIT 1`, [req.tenantId, String(req.body?.staffId || '')]);
    if (!officer) return res.status(400).json({ error: 'اختار مسئول تحصيل نشط' });
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) return res.status(403).json({ error: 'Lead assignment is outside your data scope' });
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT l.id FROM leads l
        WHERE l.tenant_id=? AND l.hidden=0 AND l.id IN (${leadIds.map(() => '?').join(',')})${accessScope.sql}
          ${includeAssigned ? '' : `AND (l.assigned_sales_id IS NULL OR l.assigned_sales_id='')
          AND (l.assigned_cs_id IS NULL OR l.assigned_cs_id='')`}
        FOR UPDATE`,
      [req.tenantId, ...leadIds, ...accessScope.params]
    );
    const ids = rows.map(row => row.id);
    if (ids.length) {
      await conn.query(
        `UPDATE leads SET assigned_cs_id=?, assigned_cs_name=?, source=COALESCE(?, source)
          WHERE tenant_id=? AND id IN (${ids.map(() => '?').join(',')})`,
        [officer.id, officer.name, source, req.tenantId, ...ids]
      );
      for (const id of ids) {
        await logLeadEventStrict(id, 'assigned', `تعيين لمسئول التحصيل: ${officer.name}`,
          { collectionId: officer.id, collectionName: officer.name, actor: req.user?.email || 'admin' }, req.tenantId, conn);
      }
    }
    await conn.commit();
    if (ids.length) {
      createNotification('lead', '📋 داتا جديدة ليك', `اتوزع عليك ${ids.length} عميل محتمل`,
        { tab: 'leads' }, req.tenantId, officer.id).catch(() => {});
    }
    res.json({ assigned: ids.length, skipped: leadIds.length - ids.length, officer: officer.name });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[assign-collection]', e.message); sendRouteError(res, e);
  } finally { conn.release(); }
});

// POST /api/admin/leads/bulk-whatsapp — send WhatsApp message to multiple leads
// Body: { lead_ids: string[], message: string }
router.post('/api/admin/leads/bulk-whatsapp', requireAuth, requireAdminOrStaff, requirePermission('bulk_whatsapp'), bulkOperationLimiter, async (req, res) => {
  try {
    const { lead_ids, message } = req.body || {};
    if (!Array.isArray(lead_ids) || lead_ids.length === 0) return res.status(400).json({ error: 'lead_ids required' });
    if (!message?.trim()) return res.status(400).json({ error: 'message required' });
    if (lead_ids.length > 200) return res.status(400).json({ error: 'Maximum 200 leads per batch' });

    const results = await queueLeadWhatsAppBatch({
      tenantId: req.tenantId,
      leadIds: lead_ids,
      message,
      actor: { email: req.user?.email || null, name: req.staffRecord?.name || null },
      staffId: req.staffRecord?.id || null,
      accessScope: leadScope(req, 'l'),
    });

    // `sent`/`failed` kept for existing frontend callers (LeadScoringTab.tsx,
    // MarketingHubTab.tsx, SegmentationSection.tsx, AbTestSection.tsx) — matches the
    // already-established "queued now means sent" wording used for email/SMS campaigns.
    res.json({ ok: true, queued: results.length, sent: results.length, failed: 0, total: results.length });
  } catch (e) { logger.error('[bulk-whatsapp]', e.message); sendRouteError(res, e); }
});

module.exports = router;
