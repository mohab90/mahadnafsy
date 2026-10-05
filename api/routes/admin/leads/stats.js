'use strict';
// The lead counters behind the CRM dashboard.
// One part of routes/admin/leads.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  pool,
  sendRouteError,
  leadScope,
  requireAuth,
  requireAdminOrStaff,
  requirePermission,
  sqlCairoDayStartUtc,
  logger,
} = require('./_shared');

const router = Router();

// GET /api/admin/leads/stats — server-side pipeline/KPI aggregates so the CRM
// never has to pull the whole leads table into the browser just to show counts.
// Same role scoping as the list below. Stays fast at 500k+: one GROUP BY that
// rides idx_leads_tenant_status_created instead of loading every row.
router.get('/api/admin/leads/stats', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    // tenant_id kept inline in the query string (not folded into a variable) so
    // the static tenant-scope guard can see this table is properly scoped.
    let scopeClause = '';
    const params = [req.tenantId];
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) {
      return res.json({
        total: 0, byStatus: {}, assigned: 0, unassigned: 0, totalDealValue: 0,
        byOwner: {}, createdToday: 0,
      });
    }
    scopeClause = accessScope.sql;
    params.push(...accessScope.params);
    // Six independent reads of the same scoped set, issued together: they
    // took 3.3 s one after another at 500k leads and take the slowest one's
    // time side by side.
    const [[rows], [ownerRows], [commRows], [sourceRows], [trendRows], [[todayRow]]] = await Promise.all([
      pool.query(
        `SELECT l.status AS status, COUNT(*) AS cnt,
                SUM(CASE WHEN l.assigned_sales_id IS NULL OR l.assigned_sales_id = '' THEN 1 ELSE 0 END) AS unassigned_cnt,
                SUM(COALESCE(l.deal_value, 0)) AS deal_sum
         FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause} GROUP BY l.status`,
        params,
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(l.assigned_sales_id, ''), '') AS owner_id,
                l.status AS status, COUNT(*) AS cnt,
                COALESCE(SUM(l.score), 0) AS score_sum
         FROM leads l
         WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
         GROUP BY COALESCE(NULLIF(l.assigned_sales_id, ''), ''), l.status`,
        params,
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(l.assigned_sales_id, ''), '') AS owner_id,
                c.type AS type, COUNT(*) AS cnt
         FROM communications c
         JOIN leads l ON l.id = c.lead_id AND l.tenant_id = c.tenant_id
         WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
         GROUP BY COALESCE(NULLIF(l.assigned_sales_id, ''), ''), c.type`,
        params,
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(l.source, ''), '') AS source, COUNT(*) AS cnt
         FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
         GROUP BY COALESCE(NULLIF(l.source, ''), '')`,
        params,
      ),
      pool.query(
        `SELECT DATE_FORMAT(l.created_at, '%Y-%m') AS ym,
                COUNT(*) AS cnt,
                SUM(l.status = 'converted') AS converted
         FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
           AND l.created_at >= DATE_FORMAT(${sqlCairoDayStartUtc()} - INTERVAL 5 MONTH, '%Y-%m-01')
         GROUP BY DATE_FORMAT(l.created_at, '%Y-%m')`,
        params,
      ),
      pool.query(
        `SELECT COUNT(*) AS cnt FROM leads l
          WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
            AND l.created_at >= ${sqlCairoDayStartUtc()} AND l.created_at < ${sqlCairoDayStartUtc()} + INTERVAL 1 DAY`,
        params,
      ),
    ]);
    const byStatus = {};
    let total = 0, unassigned = 0, totalDealValue = 0;
    for (const r of rows) {
      const st = (r.status || 'new').toLowerCase();
      byStatus[st] = (byStatus[st] || 0) + Number(r.cnt);
      total += Number(r.cnt);
      unassigned += Number(r.unassigned_cnt);
      totalDealValue += Number(r.deal_sum || 0);
    }

    // Per-rep and today's intake. The dashboard's "leads per sales rep" tiles and
    // its "new leads today" figure were the last two things counting the whole
    // leads array in the browser, and they are the reason the array had to be
    // there at all. Two more GROUP BYs over the same scoped set is cheaper than
    // shipping 26k rows to compute them client-side.
    //
    // Same WHERE as above, so every figure in this response describes one
    // population — a caller can subtract them from each other and be right.
    // Grouped by owner AND status, not owner alone: the dashboard shows each
    // rep's conversion rate, so a total without its converted count would leave
    // the numerator on the array and the denominator here — and once the array
    // stops holding every row that rate goes above 100%.
    //
    // score_sum rather than AVG(): the caller wants one average per rep, but the
    // rows arrive split by status, so an average of averages would weight a rep's
    // four converted leads the same as their four hundred new ones. Summing and
    // dividing by the same total at the end gives the real mean.
    //
    // leads.score, not the formula: lib/leadScoreRefresh.js rewrites the column
    // from LEAD_SCORE_SQL every hour for every visible lead, so it holds the same
    // number the formula would give, at most an hour old. Computing the formula
    // here instead parsed crm_json and joined the communications rollup for every
    // lead on every load — 17 seconds at 500k leads, for one tile.
    let allScoreSum = 0, allScored = 0;
    const byOwner = {};
    for (const r of ownerRows) {
      allScoreSum += Number(r.score_sum) || 0;
      allScored += Number(r.cnt) || 0;
      // '' is the unassigned bucket, already reported as `unassigned`; keeping it
      // out of byOwner stops a caller summing the map and double-counting.
      if (!r.owner_id) continue;
      const id = String(r.owner_id);
      const entry = byOwner[id] || (byOwner[id] = { total: 0, converted: 0, scoreSum: 0, comms: {} });
      const count = Number(r.cnt);
      entry.total += count;
      entry.scoreSum += Number(r.score_sum) || 0;
      if (String(r.status || '').toLowerCase() === 'converted') entry.converted += count;
    }

    // Communication counts per rep per channel, for the same reason the statuses
    // are grouped above: the performance screen charts calls/WhatsApp/meetings
    // side by side, and counting them in the browser is what forces every lead's
    // communications array to be downloaded.
    //
    // Joined through leads so the tenant scope and the hidden filter apply here
    // too — communications carries a tenant_id, but not the lead's hidden flag.
    let totalCommunications = 0;
    for (const r of commRows) {
      totalCommunications += Number(r.cnt) || 0;
      if (!r.owner_id) continue;
      const id = String(r.owner_id);
      // A rep can have communications on leads that are all converted away or
      // reassigned, so this map is not guaranteed to have an entry yet.
      const entry = byOwner[id] || (byOwner[id] = { total: 0, converted: 0, scoreSum: 0, comms: {} });
      const type = String(r.type || '').trim().toLowerCase();
      if (!type) continue;
      entry.comms[type] = (entry.comms[type] || 0) + Number(r.cnt);
    }

    // avgScore is derived here, once, so no caller has to remember that scoreSum
    // is a sum and not already a mean.
    for (const entry of Object.values(byOwner)) {
      entry.avgScore = entry.total > 0 ? Math.round(entry.scoreSum / entry.total) : 0;
      delete entry.scoreSum;
    }

    // The two whole-table figures the performance screen shows — the mean score
    // across every visible lead and the communications logged against them — are
    // the sums of the two queries above, not a third pass over the table.

    // Lead source breakdown, for the analytics pie. Counting this in the browser
    // is one of the last three reasons the CRM wanted every row.
    const bySource = {};
    for (const r of sourceRows) bySource[String(r.source || '')] = Number(r.cnt);

    // Six months of new-vs-converted, keyed 'YYYY-MM'.
    //
    // DATE_FORMAT on created_at is not sargable, but the range test beside it is,
    // so the index still selects the six months and the formatting only runs on
    // what survives. Without the range this would format all 26,878 rows.
    const byMonth = {};
    for (const r of trendRows) {
      byMonth[String(r.ym)] = { total: Number(r.cnt), converted: Number(r.converted || 0) };
    }

    // A half-open range on the bare column, not DATE(created_at) = CURDATE().
    //
    // Comparing a string prefix would depend on how the driver rendered the
    // DATETIME — the bug behind the Dokki dates — but wrapping the column in
    // DATE() is no better: it makes the term unsargable, so
    // idx_leads_tenant_status_created cannot be used and counting today's leads
    // means scanning all 26,878 rows. >= midnight AND < tomorrow is exactly the
    // same set and reads the index.

    res.json({
      total, byStatus, assigned: total - unassigned, unassigned, totalDealValue,
      byOwner, bySource, byMonth,
      avgScore: allScored > 0 ? Math.round(allScoreSum / allScored) : 0,
      totalCommunications,
      createdToday: Number(todayRow?.cnt || 0),
    });
  } catch (e) { logger.error('[leads-stats]', e.message); sendRouteError(res, e); }
});

module.exports = router;
