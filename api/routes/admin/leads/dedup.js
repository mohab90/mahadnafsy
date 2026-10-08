'use strict';
// Duplicates: finding, merging, unmerging, cleaning up and archiving.
// One part of routes/admin/leads.js, which puts the parts back together in order.
const { Router } = require('express');
const { withStaffNames, signerName } = require('../../../lib/staffNames');
const {
  pool,
  LEAD_STATUSES,
  isOpenLeadStatus,
  sendRouteError,
  DEFAULT_ARCHIVE_SOURCE,
  excludeArchiveSourcesSql,
  findLeadDuplicateGroups,
  listLeadMergeHistory,
  mergeLeads,
  unmergeLead,
  requireAuth,
  requireAdmin,
  requirePermission,
  cairoDayStartUtc,
  bulkOperationLimiter,
  logger,
} = require('./_shared');

const router = Router();

// POST /api/admin/leads/dedup-cleanup — delete duplicate leads (leads matching subscriber phones + dup-phone leads)
router.get('/api/admin/leads/duplicates', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  try {
    const groups = await findLeadDuplicateGroups(req.tenantId);
    res.json({ groups, count: groups.length });
  } catch (e) { logger.error('[lead-duplicates]', e.message); sendRouteError(res, e); }
});

router.post('/api/admin/leads/merge', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  try {
    const result = await mergeLeads({
      tenantId: req.tenantId,
      targetId: req.body?.targetId,
      sourceIds: req.body?.sourceIds,
      actor: req.staffRecord?.name || req.user?.email || 'admin',
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.error('[lead-merge]', e.message);
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    sendRouteError(res, e);
  }
});

router.get('/api/admin/leads/merge-history', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  try {
    res.json(await withStaffNames(req.tenantId, await listLeadMergeHistory(req.tenantId, req.query?.limit), 'actor'));
  } catch (e) { logger.error('[lead-merge-history]', e.message); sendRouteError(res, e); }
});

router.post('/api/admin/leads/unmerge', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  try {
    const result = await unmergeLead({
      tenantId: req.tenantId,
      sourceId: req.body?.sourceId,
      actor: req.user?.email || req.staffRecord?.name || 'admin',
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.error('[lead-unmerge]', e.message);
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    sendRouteError(res, e);
  }
});

router.post('/api/admin/leads/dedup-cleanup', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.body?.legacyArchiveOnly !== true) {
      // Merges (never deletes) every duplicate group — same phone identity or
      // same email — into its best-ranked lead, each with its own audit row so
      // it can be undone from "سجل الدمج". It used to stop after 100 groups.
      // Requests are cut off at 45s, so work stops at ~35s and reports what is
      // left; the caller simply calls again until `remaining` is 0.
      const deadline = Date.now() + 35000;
      const groups = await findLeadDuplicateGroups(req.tenantId);
      const actorName = signerName(req);
      let merged = 0, done = 0, failed = 0;
      for (const group of groups) {
        if (Date.now() > deadline) break;
        const sourceIds = group.leads.map(lead => lead.id).filter(id => id !== group.targetId);
        try {
          for (let i = 0; i < sourceIds.length; i += 100) {
            const result = await mergeLeads({
              tenantId: req.tenantId, targetId: group.targetId,
              sourceIds: sourceIds.slice(i, i + 100), actor: actorName,
            });
            merged += result.merged;
          }
        } catch (error) {
          failed += 1;
          logger.warn('[dedup-cleanup] group failed', { targetId: group.targetId, error: error.message });
        }
        done += 1;
      }
      return res.json({ ok: true, merged, groups: done, failed, remaining: groups.length - done, deleted: 0 });
    }
    const normPhone = (p) => (p || '').replace(/\D/g, '').replace(/^00/, '').replace(/^20/, '').replace(/^0/, '');

    // Load all subscribers' phones (normalized)
    const [subs] = await pool.query('SELECT phone FROM subscribers WHERE tenant_id=? AND phone IS NOT NULL AND phone != ""', [req.tenantId]);
    const subPhoneSet = new Set(subs.map(s => normPhone(s.phone)).filter(p => p.length >= 7));

    // Load all leads ordered oldest-first (so we keep the oldest when deduping)
    const [leads] = await pool.query(
      'SELECT id, phone FROM leads WHERE tenant_id=? AND hidden=0 ORDER BY created_at ASC',
      [req.tenantId]
    );

    const toDelete = new Set();

    // a) Leads whose phone matches a subscriber (converted but not cleaned)
    for (const lead of leads) {
      const lp = normPhone(lead.phone);
      if (lp.length >= 7 && subPhoneSet.has(lp)) toDelete.add(lead.id);
    }

    // b) Duplicate-phone leads (keep oldest = first seen per phone, delete the rest)
    const seenPhones = new Map();
    for (const lead of leads) {
      if (toDelete.has(lead.id)) continue;
      const lp = normPhone(lead.phone);
      if (lp.length >= 7) {
        if (seenPhones.has(lp)) toDelete.add(lead.id);
        else seenPhones.set(lp, lead.id);
      }
    }

    const ids = [...toDelete];
    if (ids.length > 0) {
      // Recoverable archive in batches of 500; CRM history must never be hard-deleted.
      for (let i = 0; i < ids.length; i += 500) {
        const batch = ids.slice(i, i + 500);
        await pool.query(
          `UPDATE leads SET hidden=1, updated_at=NOW() WHERE tenant_id=? AND id IN (${batch.map(() => '?').join(',')})`,
          [req.tenantId, ...batch]
        );
      }
    }

    res.json({ ok: true, deleted: ids.length });
  } catch (e) { logger.error('[dedup-cleanup]', e.message); sendRouteError(res, e); }
});

// POST /api/admin/leads/move-to-archive — move the unassigned live pool into
// the "محلي قديم" archive tab.
// body: { createdBefore?: 'YYYY-MM-DD', dryRun?: boolean }
//
// The archive is a *source* ("محلي قديم", see lib/leadArchive.js), and bulk
// historical data that came in under any other source — thousands of old
// Google-Sheets rows, for instance — sat in "محلي جديد" and the main table
// with no way to put it away short of editing each lead. Nothing is deleted:
// the rows keep every field, their previous source is kept in
// crm_json.archivedFromSource, and they stay distributable from the archive tab.
router.post('/api/admin/leads/move-to-archive', requireAuth, requireAdmin, requirePermission('manage_leads'), bulkOperationLimiter, async (req, res) => {
  try {
    const { createdBefore, dryRun } = req.body || {};
    if (createdBefore != null && createdBefore !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(createdBefore))) {
      return res.status(400).json({ error: 'createdBefore must be YYYY-MM-DD' });
    }
    // The pool «محلي جديد» shows, exactly (isLocalNewLead in the admin): open
    // leads only, and local ones. It took every unassigned lead but converted
    // and lost, so a lead waiting in «دولي جديد» was filed under «محلي قديم» by
    // the button on the local tab, along with leads already closed. And the
    // cut-off is the start of that Cairo day, since created_at is a UTC instant.
    const archive = excludeArchiveSourcesSql('source');
    const openStatuses = [...LEAD_STATUSES].filter(isOpenLeadStatus);
    let unassignedPool = `hidden=0 AND (assigned_sales_id IS NULL OR assigned_sales_id='') AND (assigned_cs_id IS NULL OR assigned_cs_id='')
      AND status IN (${openStatuses.map(() => '?').join(',')})
      AND COALESCE(branch,'') NOT IN ('ONLINE_ABROAD','ONLINE_SAUDI') AND COALESCE(source,'') NOT LIKE 'دولي%'${archive.sql}`;
    const params = [...openStatuses, ...archive.params];
    if (createdBefore) { unassignedPool += ' AND created_at < ?'; params.push(cairoDayStartUtc(createdBefore)); }

    const [rows] = await pool.query(`SELECT id FROM leads WHERE tenant_id=? AND ${unassignedPool}`, [req.tenantId, ...params]);
    if (dryRun) return res.json({ ok: true, dryRun: true, matched: rows.length });

    let moved = 0;
    for (let i = 0; i < rows.length; i += 1000) {
      const ids = rows.slice(i, i + 1000).map(row => row.id);
      // Re-checks the same conditions, so a lead assigned or converted since
      // the SELECT above is left alone.
      const [result] = await pool.query(
        `UPDATE leads
            SET crm_json = CASE WHEN JSON_VALID(crm_json)
                  THEN JSON_SET(crm_json, '$.archivedFromSource', source)
                  ELSE JSON_OBJECT('archivedFromSource', source) END,
                source = ?, updated_at = NOW()
          WHERE tenant_id=? AND ${unassignedPool} AND id IN (${ids.map(() => '?').join(',')})`,
        [DEFAULT_ARCHIVE_SOURCE, req.tenantId, ...params, ...ids]
      );
      moved += Number(result.affectedRows || 0);
    }
    logger.info('[move-to-archive]', { tenantId: req.tenantId, moved, createdBefore: createdBefore || null, actor: req.user?.email || null });
    res.json({ ok: true, moved });
  } catch (e) { logger.error('[move-to-archive]', e.message); sendRouteError(res, e); }
});

module.exports = router;
