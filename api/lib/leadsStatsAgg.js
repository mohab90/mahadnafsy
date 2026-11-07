'use strict';

// The lead counters kept in tables (migration 368): what GET /api/admin/leads/stats reads, how the nightly job recounts them, and how the hourly score refresh
// rebuilds the score summary.
//
//   leads_stats_agg      (tenant, status, owner, collection officer, source, branch) → leads, deal value     kept by triggers on leads
//   leads_created_daily  (tenant, UTC day, branch, owner, converted) → leads created                         kept by triggers on leads
//   leads_score_agg      (tenant, status, owner, branch) → scores added up and counted by band               rebuilt after each hourly score refresh
//
// Only leads with hidden = 0 are counted, as the route always counted them.

const { addDaysToDateOnly, cairoDayStartUtc, cairoToday } = require('./dates');

const GROUP_STATS = `l.tenant_id, COALESCE(l.status, ''), COALESCE(NULLIF(l.assigned_sales_id, ''), ''), COALESCE(NULLIF(l.assigned_cs_id, ''), ''), COALESCE(NULLIF(l.source, ''), ''), COALESCE(l.branch, '')`;
const GROUP_DAILY = `l.tenant_id, CAST(l.created_at AS DATE), COALESCE(l.branch, ''), COALESCE(NULLIF(l.assigned_sales_id, ''), ''), (COALESCE(l.status, '') = 'converted')`;

/** The live counts the aggregate must equal, one row per aggregate row (n and deal_sum), for a tenant (or all). */
function liveStatsSql(tenantFilter) {
  return `SELECT l.tenant_id AS tenant_id, COALESCE(l.status, '') AS status, COALESCE(NULLIF(l.assigned_sales_id, ''), '') AS owner_id,
                 COALESCE(NULLIF(l.assigned_cs_id, ''), '') AS cs_id, COALESCE(NULLIF(l.source, ''), '') AS source, COALESCE(l.branch, '') AS branch,
                 COUNT(*) AS n, COALESCE(SUM(COALESCE(l.deal_value, 0)), 0) AS deal_sum
            FROM leads l WHERE l.hidden = 0${tenantFilter ? ' AND l.tenant_id = ?' : ''} GROUP BY ${GROUP_STATS}`;
}

/**
 * How far the counters have drifted from the leads table: the number of aggregate rows (either table) whose count differs from the live count, and the lead
 * difference in total. Read-only.
 */
async function leadsStatsDrift(pool, tenantId = null) {
  const params = tenantId ? [tenantId] : [];
  const keyOf = row => [row.tenant_id, row.status, row.owner_id, row.cs_id, row.source, row.branch].join('\u0001');
  const [live] = await pool.query(liveStatsSql(tenantId), params);
  const [kept] = await pool.query(`SELECT tenant_id, status, owner_id, cs_id, source, branch, n, deal_sum FROM leads_stats_agg WHERE n <> 0${tenantId ? ' AND tenant_id = ?' : ''}`, params);
  const expected = new Map(live.map(row => [keyOf(row), row]));
  let rows = 0;
  let leads = 0;
  for (const row of kept) {
    const want = expected.get(keyOf(row));
    expected.delete(keyOf(row));
    const diff = Number(row.n) - Number(want?.n || 0);
    if (diff !== 0 || Number(row.deal_sum) !== Number(want?.deal_sum || 0)) { rows += 1; leads += Math.abs(diff); }
  }
  for (const row of expected.values()) { rows += 1; leads += Number(row.n); }

  const [dayLive] = await pool.query(
    `SELECT COUNT(*) AS n FROM leads l WHERE l.hidden = 0${tenantId ? ' AND l.tenant_id = ?' : ''}`, params);
  const [[dayKept]] = await pool.query(`SELECT COALESCE(SUM(n), 0) AS n FROM leads_created_daily${tenantId ? ' WHERE tenant_id = ?' : ''}`, params);
  const dailyDiff = Math.abs(Number(dayKept.n) - Number(dayLive[0].n));
  return { rows, leads, dailyLeads: dailyDiff, drifted: rows > 0 || dailyDiff > 0 };
}

/**
 * Recount the two trigger-kept tables from the leads table and replace what they hold, in one transaction: a reader sees the old counts until the commit, then
 * the new ones. Returns the drift that was found (and so fixed).
 */
async function rebuildLeadsStatsAgg(pool, tenantId = null) {
  const drift = await leadsStatsDrift(pool, tenantId);
  const params = tenantId ? [tenantId] : [];
  const where = tenantId ? ' WHERE tenant_id = ?' : '';
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`DELETE FROM leads_stats_agg${where}`, params);
    await connection.query(
      `INSERT INTO leads_stats_agg (tenant_id, status, owner_id, cs_id, source, branch, n, deal_sum) ${liveStatsSql(tenantId)}`, params);
    await connection.query(`DELETE FROM leads_created_daily${where}`, params);
    await connection.query(
      `INSERT INTO leads_created_daily (tenant_id, day, branch, owner_id, converted, n)
       SELECT ${GROUP_DAILY}, COUNT(*) FROM leads l WHERE l.hidden = 0${tenantId ? ' AND l.tenant_id = ?' : ''} GROUP BY ${GROUP_DAILY}`, params);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  return drift;
}

/** Rebuild the score summary from leads.score: after the hourly refresh has rewritten the scores, and by the nightly job. */
async function rebuildLeadsScoreAgg(pool, tenantId = null) {
  const params = tenantId ? [tenantId] : [];
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`DELETE FROM leads_score_agg${tenantId ? ' WHERE tenant_id = ?' : ''}`, params);
    await connection.query(
      `INSERT INTO leads_score_agg (tenant_id, status, owner_id, branch, scored_n, score_sum, band_high, band_mid, band_low)
       SELECT l.tenant_id, COALESCE(l.status, ''), COALESCE(NULLIF(l.assigned_sales_id, ''), ''), COALESCE(l.branch, ''),
              COUNT(*), COALESCE(SUM(COALESCE(l.score, 0)), 0), COALESCE(SUM(COALESCE(l.score, 0) >= 70), 0),
              COALESCE(SUM(COALESCE(l.score, 0) >= 40 AND COALESCE(l.score, 0) < 70), 0), COALESCE(SUM(COALESCE(l.score, 0) < 40), 0)
         FROM leads l WHERE l.hidden = 0${tenantId ? ' AND l.tenant_id = ?' : ''}
        GROUP BY l.tenant_id, COALESCE(l.status, ''), COALESCE(NULLIF(l.assigned_sales_id, ''), ''), COALESCE(l.branch, '')`, params);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

/** The nightly job: recount everything, rebuild the score summary, and say what was off. */
async function reconcileLeadsStats(pool, logger = null) {
  const drift = await rebuildLeadsStatsAgg(pool);
  await rebuildLeadsScoreAgg(pool);
  if (drift.drifted && logger) logger.warn('[jobs] lead counters were off and are fixed', drift);
  return drift;
}

/**
 * The six-month trend (this Cairo month and the five before it), from the daily table: the UTC days that lie wholly inside a Cairo month are read from
 * leads_created_daily, and the few hours at either end of the month (Cairo's midnight is 21:00 or 22:00 UTC) are counted from the leads table, which an index on
 * (tenant, created_at) answers for a sliver of rows. Exact for Cairo's months, DST included.
 *
 * @param {{ sql: string, params: any[] }} dailyScope  the caller's scope on the daily table's columns (alias `a`: a.owner_id, a.branch)
 * @param {{ sql: string, params: any[] }} liveScope   the same scope on the leads table (alias `l`)
 * @returns {Promise<Array<{ ym: string, cnt: number, converted: number }>>}
 */
async function trendFromDaily(pool, tenantId, dailyScope, liveScope, now = new Date()) {
  const [year, month] = cairoToday(now).split('-').map(Number);
  const months = [];
  for (let back = 5; back >= 0; back--) {
    const date = new Date(Date.UTC(year, month - 1 - back, 1));
    const ym = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    const start = cairoDayStartUtc(`${ym}-01`);
    const end = cairoDayStartUtc(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`);
    const startDay = start.slice(0, 10);
    const endDay = end.slice(0, 10);
    // the first whole UTC day after the start, the last whole one before the end
    const firstDay = start.endsWith('00:00:00') ? startDay : addDaysToDateOnly(startDay, 1);
    months.push({ ym, start, end, firstDay, endDay });
  }
  const dailyCases = months.map(() => 'WHEN a.day >= ? AND a.day < ? THEN ?').join(' ');
  const dailyParams = months.flatMap(m => [m.firstDay, m.endDay, m.ym]);
  const edgeRanges = months.flatMap(m => [
    ...(m.start < `${m.firstDay} 00:00:00` ? [{ ym: m.ym, from: m.start, to: `${m.firstDay} 00:00:00` }] : []),
    ...(m.end > `${m.endDay} 00:00:00` ? [{ ym: m.ym, from: `${m.endDay} 00:00:00`, to: m.end }] : []),
  ]);
  const edgeCases = edgeRanges.map(() => 'WHEN l.created_at >= ? AND l.created_at < ? THEN ?').join(' ');
  const [[daily], [edges]] = await Promise.all([
    pool.query(
      `SELECT CASE ${dailyCases} END AS ym, SUM(a.n) AS cnt, SUM(CASE WHEN a.converted = 1 THEN a.n ELSE 0 END) AS converted
         FROM leads_created_daily a WHERE a.tenant_id = ?${dailyScope.sql} AND a.day >= ? AND a.day < ? GROUP BY ym`,
      [...dailyParams, tenantId, ...dailyScope.params, months[0].firstDay, months[months.length - 1].endDay]),
    edgeRanges.length ? pool.query(
      `SELECT CASE ${edgeCases} END AS ym, COUNT(*) AS cnt, SUM(l.status = 'converted') AS converted
         FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${liveScope.sql} AND (${edgeRanges.map(() => '(l.created_at >= ? AND l.created_at < ?)').join(' OR ')}) GROUP BY ym`,
      [...edgeRanges.flatMap(e => [e.from, e.to, e.ym]), tenantId, ...liveScope.params, ...edgeRanges.flatMap(e => [e.from, e.to])]) : [[]],
  ]);
  const total = new Map();
  for (const row of [...daily, ...edges]) {
    if (!row.ym) continue;
    const held = total.get(row.ym) || { ym: row.ym, cnt: 0, converted: 0 };
    held.cnt += Number(row.cnt || 0);
    held.converted += Number(row.converted || 0);
    total.set(row.ym, held);
  }
  return months.map(m => total.get(m.ym)).filter(row => row && row.cnt > 0);
}

module.exports = { trendFromDaily, leadsStatsDrift, rebuildLeadsStatsAgg, rebuildLeadsScoreAgg, reconcileLeadsStats };
