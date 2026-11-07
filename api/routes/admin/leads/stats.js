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
  cairoToday,
  communicationsByLead,
  mapLeadRow,
  logger,
} = require('./_shared');
const { FOLLOW_UP_DATE, FOLLOW_UP_OPEN, dueBy } = require('../../../lib/leadFollowUps');
const { TERMINAL_SQL } = require('../../../lib/leadStatuses');
const { trendFromDaily } = require('../../../lib/leadsStatsAgg');
const { indexedLeadSearch } = require('./lists');
const { cached } = require('../../../lib/db');
const { sqlCairoWall, sqlCairoDayEndUtc, addDaysToDateOnly } = require('../../../lib/dates');

const router = Router();

// The figures of one response, from the rows its queries (live or from the counters) return — one population, so a caller can subtract them from each other.
function assemble({ rows, ownerRows, commRows, sourceRows, trendRows, todayRow, holderRows, bandRow }) {
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
    allScored += Number(r.score_n ?? r.cnt) || 0;
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

  return {
    total, byStatus, assigned: total - unassigned, unassigned, totalDealValue,
    byOwner, bySource, byMonth,
    avgScore: allScored > 0 ? Math.round(allScoreSum / allScored) : 0,
    totalCommunications,
    createdToday: Number(todayRow?.cnt || 0),
    collectionHolders: holderRows.map(row => ({ id: row.id, name: row.name, count: Number(row.cnt) })),
    scoreBands: { high: Number(bandRow?.high || 0), mid: Number(bandRow?.mid || 0), low: Number(bandRow?.low || 0) },
  };
}

// The scopes the counters answer, written for their columns (alias `a`): every lead, one rep's own, one branch's (or a few). The collection officer's and the
// branch desk's scopes reach leads through other tables and are counted from the leads table.
function aggregateScope(accessScope) {
  if (accessScope.scope === 'all') return { sql: '', params: [] };
  if (accessScope.scope === 'assigned_sales') return { sql: ' AND a.owner_id = ?', params: accessScope.params };
  if (String(accessScope.scope).startsWith('branch:') && accessScope.sql.startsWith(' AND l.branch IN (')) {
    return { sql: accessScope.sql.replace('l.branch', 'a.branch'), params: accessScope.params };
  }
  return null;
}

// The same eight answers, from the counters.
async function readAggregates(tenantId, scope, accessScope) {
  const a = scope.sql;
  const p = [tenantId, ...scope.params];
  const [[rows], [ownerCounts], [commRows], [sourceRows], trendRows, [[todayRow]], [holderRows], [scoreRows], [[bandRow]]] = await Promise.all([
    pool.query(
      `SELECT a.status AS status, SUM(a.n) AS cnt, SUM(CASE WHEN a.owner_id = '' THEN a.n ELSE 0 END) AS unassigned_cnt, SUM(a.deal_sum) AS deal_sum
         FROM leads_stats_agg a WHERE a.tenant_id = ? AND a.n > 0${a} GROUP BY a.status`, p),
    pool.query(
      `SELECT a.owner_id AS owner_id, a.status AS status, SUM(a.n) AS cnt FROM leads_stats_agg a WHERE a.tenant_id = ? AND a.n > 0${a} GROUP BY a.owner_id, a.status`, p),
    pool.query(
      `SELECT COALESCE(NULLIF(l.assigned_sales_id, ''), '') AS owner_id, c.type AS type, COUNT(*) AS cnt
         FROM communications c JOIN leads l ON l.id = c.lead_id AND l.tenant_id = c.tenant_id
        WHERE l.tenant_id = ? AND l.hidden = 0${accessScope.sql} GROUP BY COALESCE(NULLIF(l.assigned_sales_id, ''), ''), c.type`,
      [tenantId, ...accessScope.params]),
    pool.query(`SELECT a.source AS source, SUM(a.n) AS cnt FROM leads_stats_agg a WHERE a.tenant_id = ? AND a.n > 0${a} GROUP BY a.source`, p),
    trendFromDaily(pool, tenantId, scope, { sql: accessScope.sql, params: accessScope.params }),
    // new leads today: a sliver of the leads table by its created_at index
    pool.query(
      `SELECT COUNT(*) AS cnt FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${accessScope.sql}
          AND l.created_at >= ${sqlCairoDayStartUtc()} AND l.created_at < ${sqlCairoDayEndUtc()}`, [tenantId, ...accessScope.params]),
    pool.query(
      `SELECT st.id, st.name, SUM(a.n) AS cnt
         FROM leads_stats_agg a
         JOIN staff st ON st.tenant_id = a.tenant_id AND (st.id = a.cs_id OR st.id = a.owner_id)
        WHERE a.tenant_id = ? AND a.n > 0${a} AND UPPER(st.role) = 'COLLECTION' AND st.is_active = 1 AND st.deleted_at IS NULL
        GROUP BY st.id, st.name ORDER BY st.name`, p),
    // the scores, added up when the hourly refresh last rewrote them (leads_score_agg)
    pool.query(
      `SELECT a.owner_id AS owner_id, a.status AS status, SUM(a.score_sum) AS score_sum, SUM(a.scored_n) AS score_n FROM leads_score_agg a WHERE a.tenant_id = ?${a} GROUP BY a.owner_id, a.status`, p),
    pool.query(
      `SELECT SUM(a.band_high) AS high, SUM(a.band_mid) AS mid, SUM(a.band_low) AS low FROM leads_score_agg a
        WHERE a.tenant_id = ?${a} AND COALESCE(a.status, '') NOT IN ${TERMINAL_SQL}`, p),
  ]);
  // one row per (owner, status): the count as it is now, the score as the refresh last saw it
  const scoreOf = new Map(scoreRows.map(row => [`${row.owner_id}\u0001${row.status}`, row]));
  const ownerRows = ownerCounts.map(row => {
    const score = scoreOf.get(`${row.owner_id}\u0001${row.status}`);
    return { ...row, score_sum: score ? score.score_sum : 0, score_n: score ? score.score_n : 0 };
  });
  return { rows, ownerRows, commRows, sourceRows, trendRows: trendRows.map(row => ({ ym: row.ym, cnt: row.cnt, converted: row.converted })), todayRow, holderRows, bandRow };
}

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
    // Seven scans of the leads table, on every page load of every employee: 0.3-0.5 s at 150,000 leads
    // and about three times that at the 520,000 production holds. Held for 15 s and shared by everyone
    // who asks for the same scope meanwhile (cached() also joins a call already running), and dropped
    // by the first successful write after it (dropFiguresAfterWrites in httpApp.js), so a status changed
    // on screen is counted on the next read, not 15 s later.
    const key = `figures:leads-stats:${req.tenantId}:${scopeClause}:${JSON.stringify(params)}`;
    const payload = await cached(key, 15 * 1000, async () => {
      // Served from the counters kept in tables (migration 368, lib/leadsStatsAgg.js) when the scope is one they can answer: every lead, one rep's, or a branch's.
      // The scope is read from the same `leadScope`, so who sees what is unchanged. Any other scope, or tables that are not there, reads the leads table as before.
      const aggregate = aggregateScope(accessScope);
      if (aggregate) {
        try {
          return assemble(await readAggregates(req.tenantId, aggregate, accessScope));
        } catch (error) {
          logger.warn('[leads-stats] counters unavailable, counting the leads table', error.message);
        }
      }
      // Six independent reads of the same scoped set, issued together: they
      // took 3.3 s one after another at 500k leads and take the slowest one's
      // time side by side.
      const [[rows], [ownerRows], [commRows], [sourceRows], [trendRows], [[todayRow]], [holderRows], [[bandRow]]] = await Promise.all([
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
          `SELECT DATE_FORMAT(${sqlCairoWall('l.created_at')}, '%Y-%m') AS ym,
                  COUNT(*) AS cnt,
                  SUM(l.status = 'converted') AS converted
           FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
             AND l.created_at >= DATE_FORMAT(${sqlCairoDayStartUtc()} - INTERVAL 5 MONTH, '%Y-%m-01')
           GROUP BY DATE_FORMAT(${sqlCairoWall('l.created_at')}, '%Y-%m')`,
          params,
        ),
        pool.query(
          `SELECT COUNT(*) AS cnt FROM leads l
            WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
              AND l.created_at >= ${sqlCairoDayStartUtc()} AND l.created_at < ${sqlCairoDayEndUtc()}`,
          params,
        ),
        // The collection officers who hold leads — handed to them from the
        // remaining data, or left on them as a sales rep's: «بعد السيلز اعمل خط
        // واظهر اسماء التحصيل اللى عندهم داتا».
        pool.query(
          `SELECT st.id, st.name, COUNT(*) AS cnt
             FROM leads l
             JOIN staff st ON st.tenant_id = l.tenant_id AND (st.id = l.assigned_cs_id OR st.id = l.assigned_sales_id)
            WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
              AND UPPER(st.role) = 'COLLECTION' AND st.is_active = 1 AND st.deleted_at IS NULL
            GROUP BY st.id, st.name ORDER BY st.name`,
          params,
        ),
        // The open leads by score band, for «توزيع السكور» on the performance page — counted in the browser over the
        // page of leads it held. leads.score is the formula's own value (lib/leadScoreRefresh.js).
        pool.query(
          `SELECT SUM(COALESCE(l.score, 0) >= 70) AS high,
                  SUM(COALESCE(l.score, 0) >= 40 AND COALESCE(l.score, 0) < 70) AS mid,
                  SUM(COALESCE(l.score, 0) < 40) AS low
             FROM leads l
            WHERE l.tenant_id = ? AND ${FOLLOW_UP_OPEN}${scopeClause}`,
          params,
        ),
      ]);
      return assemble({ rows, ownerRows, commRows, sourceRows, trendRows, todayRow, holderRows, bandRow });
    });
    res.json(payload);
  } catch (e) { logger.error('[leads-stats]', e.message); sendRouteError(res, e); }
});

// GET /api/admin/leads/segments — «الشرائح» (marketing hub): the audience a set of filters picks out, counted and paged by the database (6 Nov 2026).
//
// The screen built its audiences in the browser from the leads it had downloaded (the whole table: 58 MB on the lab) with a score of its own (a status/source/recency
// formula written on the screen) — so «ليدات ساخنة» was the leads the screen scored 70 or more, not the ones the system does. Here the filters run in the database over the
// same scope as the leads list (leadScope), on the system's own score (leads.score, kept by the hourly refresh):
//   status, source        exact (the source in lower case, as the screen compared it)
//   minScore              leads.score >= n
//   daysNew               created in the last n days
//   q                     in the name, or the phone
// and the answer is the audience's size, its first rows (pageSize <= 200: the WhatsApp send takes the first 200) and the lists the two drop-downs offer.
const SEGMENT_ROWS = 200;
const COUNT_CAP = 10000;
router.get('/api/admin/leads/segments', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) return res.json({ total: 0, base: 0, rows: [], facets: { statuses: [], sources: [] } });
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 100, 1), SEGMENT_ROWS);
    const page = Math.max(parseInt(req.query.page, 10) || 0, 0);
    let where = `l.tenant_id = ? AND l.hidden = 0${accessScope.sql}`;
    const params = [req.tenantId, ...accessScope.params];
    const status = String(req.query.status || '');
    if (status && status !== 'all') { where += ' AND l.status = ?'; params.push(status); }
    const source = String(req.query.source || '').toLowerCase();
    if (source && source !== 'all') { where += " AND LOWER(COALESCE(l.source, '')) = ?"; params.push(source); }
    const minScore = Math.min(Math.max(parseInt(req.query.minScore, 10) || 0, 0), 100);
    if (minScore > 0) { where += ' AND l.score >= ?'; params.push(minScore); }
    const daysNew = Math.min(Math.max(parseInt(req.query.daysNew, 10) || 0, 0), 3650);
    if (daysNew > 0) { where += ' AND l.created_at >= ?'; params.push(new Date(Date.now() - daysNew * 86400000)); }
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q) {
      // the leads list's own indexed search (a phone by its spellings, name words by the full-text index); a word too short for the index scans, as it always did
      const indexed = indexedLeadSearch(q);
      if (indexed) { where += ` AND ${indexed.sql}`; params.push(...indexed.params); } else {
        const like = `%${q.replace(/[\\%_]/g, match => `\\${match}`)}%`;
        where += ' AND (l.name LIKE ? OR l.phone LIKE ?)';
        params.push(like, like);
      }
    }
    // An audience of a status and a source only is counted from the counters, not by counting the leads.
    const countersAnswer = !q && minScore === 0 && daysNew === 0;
    // The facets and the base count do not depend on the filters, and come from the counters when the scope is one they answer (leads/stats' own).
    const aggregate = aggregateScope(accessScope);
    const facets = cached(`figures:segment-facets:${req.tenantId}:${accessScope.sql}:${JSON.stringify(accessScope.params)}`, 15 * 1000, async () => {
      const [statusRows, sourceRows] = aggregate
        ? await Promise.all([
          pool.query(`SELECT a.status AS value, SUM(a.n) AS cnt FROM leads_stats_agg a WHERE a.tenant_id = ? AND a.n > 0${aggregate.sql} GROUP BY a.status`, [req.tenantId, ...aggregate.params]),
          pool.query(`SELECT a.source AS value, SUM(a.n) AS cnt FROM leads_stats_agg a WHERE a.tenant_id = ? AND a.n > 0${aggregate.sql} GROUP BY a.source`, [req.tenantId, ...aggregate.params]),
        ])
        : await Promise.all([
          pool.query(`SELECT l.status AS value, COUNT(*) AS cnt FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${accessScope.sql} GROUP BY l.status`, [req.tenantId, ...accessScope.params]),
          pool.query(`SELECT COALESCE(l.source, '') AS value, COUNT(*) AS cnt FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${accessScope.sql} GROUP BY COALESCE(l.source, '')`, [req.tenantId, ...accessScope.params]),
        ]);
      const lower = new Map();
      for (const row of sourceRows[0]) { const key = String(row.value || '').toLowerCase(); lower.set(key, (lower.get(key) || 0) + Number(row.cnt)); }
      return {
        statuses: statusRows[0].map(row => ({ value: row.value, count: Number(row.cnt) })).filter(row => row.value).sort((a, b) => b.count - a.count),
        sources: [...lower].filter(([value]) => value).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
        base: statusRows[0].reduce((sum, row) => sum + Number(row.cnt), 0),
      };
    });
    const countFromCounters = countersAnswer && aggregate;
    const [[[countRow]], [rows], facetAnswer] = await Promise.all([
      (countFromCounters
        ? pool.query(
          `SELECT COALESCE(SUM(a.n), 0) AS total FROM leads_stats_agg a WHERE a.tenant_id = ? AND a.n > 0${aggregate.sql}${status && status !== 'all' ? ' AND a.status = ?' : ''}${source && source !== 'all' ? " AND LOWER(a.source) = ?" : ''}`,
          [req.tenantId, ...aggregate.params, ...(status && status !== 'all' ? [status] : []), ...(source && source !== 'all' ? [source] : [])])
        // counted up to 10,001 leads: a search that matches a tenth of the book does not need its exact size (the answer says when it stopped counting)
        : pool.query(`SELECT COUNT(*) AS total FROM (SELECT 1 FROM leads l WHERE ${where} LIMIT ${COUNT_CAP + 1}) c`, params)).then(result => [result[0]]),
      pool.query(
        `SELECT l.id, l.name, l.phone, l.status, l.source, l.score, l.created_at FROM leads l WHERE ${where} ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, page * pageSize]),
      facets,
    ]);
    res.set('Cache-Control', 'private, no-store');
    res.json({
      total: Math.min(Number(countRow?.total || 0), COUNT_CAP), capped: Number(countRow?.total || 0) > COUNT_CAP, base: facetAnswer.base, page, pageSize,
      rows: rows.map(row => ({ id: row.id, name: row.name || '', phone: row.phone || '', status: row.status, source: row.source || '', score: Number(row.score) || 0, createdAt: row.created_at })),
      facets: { statuses: facetAnswer.statuses, sources: facetAnswer.sources },
    });
  } catch (e) { logger.error('[leads-segments]', e.message); sendRouteError(res, e); }
});

// GET /api/admin/leads/followups-due — the header bell's number: open leads
// whose follow-up is today or already past, for whoever is asking.
//
// The bell counted them in the browser out of the 500 newest leads, so an admin
// who also has a staff record downloaded those 500 rows (350 KB on the local copy
// of production) on every screen, for one number — and a follow-up on an older
// lead was never counted. The same rule, over the same scope the leads list
// answers with (leadScope), as one COUNT: an open status (shared/leadStatuses.ts
// isOpenLeadStatus) and a follow-up date (the column, else crm_json's, as
// mapLeadRow reads it) on or before today in Cairo.
router.get('/api/admin/leads/followups-due', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) return res.json({ due: 0, overdue: 0, today: 0 });
    const today = cairoToday();
    // Today's and the overdue, as every screen counts them (lib/leadFollowUps.js).
    const due = dueBy(today);
    // The header bell, on every page: held like the counters above (15 s, dropped by the next write).
    const payload = await cached(`figures:followups-due:${req.tenantId}:${today}:${accessScope.sql}:${JSON.stringify(accessScope.params)}`, 15 * 1000, async () => {
      const [[row]] = await pool.query(
        `SELECT SUM(l.next_follow_up_date < ?) AS overdue, SUM(l.next_follow_up_date >= ?) AS today
           FROM leads l
          WHERE l.tenant_id = ?${accessScope.sql}${due.sql}`,
        [today, today, req.tenantId, ...accessScope.params, ...due.params],
      );
      const overdue = Number(row?.overdue || 0);
      const dueToday = Number(row?.today || 0);
      return { due: overdue + dueToday, overdue, today: dueToday };
    });
    res.json(payload);
  } catch (e) { logger.error('[leads-followups-due]', e.message); sendRouteError(res, e); }
});

// GET /api/admin/leads/followups-panel — the follow-ups drawer opened from the header bell and from the leads
// screen: the open leads overdue, due today and with no date yet, for whoever is asking (leadScope).
//
// The drawer filtered the person's whole list of leads — for an employee, the list of every lead in their scope
// that the panel downloaded at sign-in. Counts are the true ones; the rows are the first 100 of each group
// (the oldest follow-ups first, the newest undated leads first), which is a day's work, not a backlog.
const PANEL_ROWS = 100;
router.get('/api/admin/leads/followups-panel', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const empty = { openTotal: 0, overdueCount: 0, todayCount: 0, noFollowupCount: 0, overdue: [], today: [], noFollowup: [] };
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) return res.json(empty);
    const today = cairoToday();
    // Open as every screen counts it (lib/leadFollowUps.js).
    const open = FOLLOW_UP_OPEN;
    const base = `FROM leads l WHERE l.tenant_id = ?${accessScope.sql} AND ${open}`;
    const p = [req.tenantId, ...accessScope.params];
    const undated = "l.next_follow_up_date IS NULL AND l.status IN ('new','contacted','interested')";
    // A day is the range from its start to the next day's: the dates are read from the index (lib/leadFollowUps.js).
    const tomorrow = addDaysToDateOnly(today, 1);
    const onToday = 'l.next_follow_up_date >= ? AND l.next_follow_up_date < ?';
    const columns = `SELECT l.id, l.client_code, l.name, l.email, l.phone, l.source, l.utm_source, l.utm_medium, l.utm_campaign, l.fbclid, l.gclid, l.status, l.lead_type, l.branch,
              l.interest_level, l.interested_course_ids_json, l.enrolled_course_id, l.deal_value,
              l.assigned_sales_id, COALESCE(ss.name, l.assigned_sales_name) AS assigned_sales_name,
              l.assigned_cs_id, COALESCE(cs.name, l.assigned_cs_name) AS assigned_cs_name,
              l.notes, l.last_follow_up, l.next_follow_up_date, l.crm_json, l.hidden, l.score, l.created_at, l.updated_at,
              0 AS communication_count
         FROM leads l
         LEFT JOIN staff ss ON ss.id = l.assigned_sales_id AND ss.tenant_id = l.tenant_id
         LEFT JOIN staff cs ON cs.id = l.assigned_cs_id AND cs.tenant_id = l.tenant_id
        WHERE l.tenant_id = ?${accessScope.sql} AND ${open}`;
    const [[[counts]], [overdue], [dueToday], [noDate]] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS open_total, COALESCE(SUM(l.next_follow_up_date < ?), 0) AS overdue, COALESCE(SUM(${onToday}), 0) AS today,
                COALESCE(SUM(${undated}), 0) AS no_followup ${base}`, [today, today, tomorrow, ...p]),
      pool.query(`${columns} AND l.next_follow_up_date < ? ORDER BY ${FOLLOW_UP_DATE} ASC, l.id ASC LIMIT ${PANEL_ROWS}`, [...p, today]),
      pool.query(`${columns} AND ${onToday} ORDER BY l.name ASC, l.id ASC LIMIT ${PANEL_ROWS}`, [...p, today, tomorrow]),
      pool.query(`${columns} AND ${undated} ORDER BY l.created_at DESC, l.id DESC LIMIT ${PANEL_ROWS}`, p),
    ]);
    // The cards act on a lead from the row alone; the communications are not drawn here.
    const none = new Map();
    const mapRows = rows => rows.map(r => mapLeadRow(r, none));
    res.json({
      openTotal: Number(counts.open_total) || 0,
      overdueCount: Number(counts.overdue) || 0,
      todayCount: Number(counts.today) || 0,
      noFollowupCount: Number(counts.no_followup) || 0,
      overdue: mapRows(overdue), today: mapRows(dueToday), noFollowup: mapRows(noDate),
    });
  } catch (e) { logger.error('[leads-followups-panel]', e.message); sendRouteError(res, e); }
});

module.exports = router;
