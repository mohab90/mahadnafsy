'use strict';
/**
 * 6 Nov 2026 (migration 368): the lead counters behind GET /api/admin/leads/stats are kept in tables by triggers on leads. Against a real MariaDB:
 *   - after inserts, updates (status, rep, collection officer, source, branch, deal value, hiding) and deletes, the tables equal a live GROUP BY of the leads, to the lead;
 *   - an update that moves nothing (a score rewrite) changes no row;
 *   - the stats route answers the same figures from the tables as from the leads table (the tables are renamed away to make the route count the leads, as it
 *     does when they are missing), for the whole book and for one rep's scope;
 *   - the six-month trend is exact for Cairo's months at the edges (a lead at 00:30 on the 1st in Cairo belongs to that month, though it is the day before in UTC);
 *   - the nightly recount finds and fixes a count that has been tampered with, and says so.
 * Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-leads-agg-it';
let pool, router, agg, dates, db;

const statsOf = async (req = {}) => {
  db.cacheInvalidateLocal('figures:');
  const layer = router.stack.find(l => l.route?.path === '/api/admin/leads/stats');
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({ params: {}, query: {}, body: {}, headers: {}, tenantId: T, user: { uid: 'admin' }, staffRecord: null, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined, ...req }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return JSON.parse(JSON.stringify(res.body));
};
const clean = async () => {
  for (const table of ['communications', 'leads', 'leads_stats_agg', 'leads_created_daily', 'leads_score_agg']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
};
let n = 0;
async function lead(fields = {}) {
  n += 1;
  const row = { id: `la-${n}`, name: `ليد ${n}`, phone: `10188${String(n).padStart(5, '0')}`, source: 'facebook', status: 'new', created_at: new Date(), ...fields };
  const columns = ['id', 'tenant_id', 'name', 'phone', 'source', 'status', 'created_at', ...Object.keys(fields).filter(k => !['source', 'status', 'created_at', 'name', 'phone', 'id'].includes(k))];
  await pool.query(`INSERT INTO leads (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, columns.map(c => (c === 'tenant_id' ? T : row[c])));
  return row.id;
}
const update = (id, set) => pool.query(`UPDATE leads SET ${Object.keys(set).map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...Object.values(set), id]);
const noDrift = async (label) => {
  const drift = await agg.leadsStatsDrift(pool, T);
  assert.equal(drift.drifted, false, `${label}: the counters differ from the leads table ${JSON.stringify(drift)}`);
};
const monthKey = (offset = 0) => { const [y, m] = dates.cairoToday().split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + offset, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const at = (ym, day, hour = 12) => new Date(`${ym}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`);

before(async () => {
  if (!ENABLED) return;
  db = require('../../lib/db');
  ({ pool } = db);
  router = require('../../routes/admin/leads/stats');
  agg = require('../../lib/leadsStatsAgg');
  dates = require('../../lib/dates');
  await clean();
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('inserts, updates and deletes keep the counters equal to the leads table', { skip }, async () => {
  const ids = [];
  const this1 = monthKey(0); const prev = monthKey(-1);
  ids.push(await lead({ status: 'new', assigned_sales_id: 'rep-a', source: 'facebook', branch: 'ONLINE_EGYPT', deal_value: 100, created_at: at(this1, 3) }));
  ids.push(await lead({ status: 'new', assigned_sales_id: 'rep-a', source: 'google', branch: 'ONLINE_EGYPT', created_at: at(this1, 4) }));
  ids.push(await lead({ status: 'contacted', assigned_sales_id: 'rep-b', source: 'facebook', branch: 'DAQQI', deal_value: 250.5, created_at: at(prev, 10) }));
  ids.push(await lead({ status: 'converted', assigned_sales_id: 'rep-b', assigned_cs_id: 'cs-1', source: '', branch: 'ONLINE_SAUDI', deal_value: 3000, created_at: at(prev, 12) }));
  ids.push(await lead({ status: 'new', source: 'facebook', created_at: at(prev, 14), hidden: 1 }));
  await noDrift('after inserts');

  await update(ids[0], { status: 'converted' });
  await update(ids[1], { assigned_sales_id: 'rep-b', branch: 'DAQQI' });
  await update(ids[2], { deal_value: 10, assigned_cs_id: 'cs-1' });
  await update(ids[3], { source: 'tiktok' });
  await update(ids[4], { hidden: 0 });
  await update(ids[0], { hidden: 1 });
  await noDrift('after updates');

  await update(ids[1], { score: 77 });
  await pool.query('UPDATE leads SET notes = ? WHERE id = ?', ['ملاحظة', ids[1]]);
  await noDrift('after a score rewrite and a note');
  const before = await pool.query('SELECT n FROM leads_stats_agg WHERE tenant_id=? ORDER BY status, owner_id, cs_id, source, branch', [T]);
  await update(ids[1], { score: 12 });
  const afterRows = await pool.query('SELECT n FROM leads_stats_agg WHERE tenant_id=? ORDER BY status, owner_id, cs_id, source, branch', [T]);
  assert.deepEqual(afterRows[0], before[0], 'a rewrite that moves no lead changes no count');

  await pool.query('DELETE FROM leads WHERE id IN (?, ?)', [ids[2], ids[3]]);
  await noDrift('after deletes');
  const [[total]] = await pool.query('SELECT COALESCE(SUM(n),0) AS n FROM leads_stats_agg WHERE tenant_id=?', [T]);
  const [[live]] = await pool.query('SELECT COUNT(*) AS n FROM leads WHERE tenant_id=? AND hidden=0', [T]);
  assert.equal(Number(total.n), Number(live.n));
});

test('the route gives the same figures from the counters as from the leads table, for the whole book and for one rep', { skip }, async () => {
  await clean();
  const this1 = monthKey(0); const prev = monthKey(-1);
  await lead({ status: 'new', assigned_sales_id: 'rep-a', source: 'facebook', branch: 'ONLINE_EGYPT', deal_value: 100, score: 30, created_at: at(this1, 3) });
  await lead({ status: 'contacted', assigned_sales_id: 'rep-a', source: 'google', branch: 'ONLINE_EGYPT', score: 55, created_at: at(this1, 4) });
  await lead({ status: 'converted', assigned_sales_id: 'rep-b', assigned_cs_id: 'cs-1', source: 'facebook', branch: 'DAQQI', deal_value: 3000, score: 90, created_at: at(prev, 12) });
  await lead({ status: 'interested', source: 'tiktok', score: 72, created_at: at(prev, 14) });
  await lead({ status: 'closed', assigned_sales_id: 'rep-b', source: 'google', branch: 'DAQQI', score: 10, created_at: at(prev, 15) });
  await lead({ status: 'new', source: 'facebook', hidden: 1, score: 99, created_at: at(prev, 16) });
  await agg.rebuildLeadsScoreAgg(pool, T);

  const rep = { isSuperAdmin: false, staffRecord: { id: 'rep-a', role: 'sales', permissions: ['view_leads'] } };
  const fromCounters = { all: await statsOf(), rep: await statsOf(rep) };
  for (const table of ['leads_stats_agg', 'leads_created_daily', 'leads_score_agg']) await pool.query(`RENAME TABLE ${table} TO ${table}_away`);
  let fromLeads;
  try { fromLeads = { all: await statsOf(), rep: await statsOf(rep) }; } finally {
    for (const table of ['leads_stats_agg', 'leads_created_daily', 'leads_score_agg']) await pool.query(`RENAME TABLE ${table}_away TO ${table}`);
  }
  assert.equal(fromCounters.all.total, 5, 'five visible leads');
  assert.deepEqual(fromCounters.all, fromLeads.all, 'the whole book');
  assert.equal(fromCounters.rep.total, 2, 'rep-a holds two');
  assert.deepEqual(fromCounters.rep, fromLeads.rep, 'one rep\'s scope');
});

test('the trend is exact for Cairo\'s months: 00:30 on the 1st in Cairo is that month, the evening before in UTC', { skip }, async () => {
  await clean();
  const this1 = monthKey(0); const prev = monthKey(-1);
  const firstStart = dates.cairoDayStartUtc(`${this1}-01`); // Cairo midnight of the 1st, as a UTC instant
  const justAfter = new Date(`${firstStart.replace(' ', 'T')}Z`.replace('Z', '.000Z')); justAfter.setUTCMinutes(justAfter.getUTCMinutes() + 30);
  const justBefore = new Date(justAfter); justBefore.setUTCMinutes(justBefore.getUTCMinutes() - 60);
  await lead({ status: 'converted', created_at: justAfter });   // this month in Cairo, previous UTC day
  await lead({ status: 'new', created_at: justBefore });         // previous month in Cairo
  await lead({ status: 'new', created_at: at(prev, 10) });
  const rows = await agg.trendFromDaily(pool, T, { sql: '', params: [] }, { sql: '', params: [] });
  const byMonth = Object.fromEntries(rows.map(r => [r.ym, r]));
  assert.equal(byMonth[this1].cnt, 1, 'the lead after Cairo midnight');
  assert.equal(byMonth[this1].converted, 1);
  assert.equal(byMonth[prev].cnt, 2, 'the one before it, and the mid-month one');
});

test('the nightly recount finds a drifted count, fixes it, and says so', { skip }, async () => {
  await clean();
  await lead({ status: 'new', assigned_sales_id: 'rep-a' });
  await lead({ status: 'new', assigned_sales_id: 'rep-a' });
  await noDrift('fresh');
  await pool.query("UPDATE leads_stats_agg SET n = n + 5 WHERE tenant_id = ? AND owner_id = 'rep-a'", [T]);
  await pool.query('DELETE FROM leads_created_daily WHERE tenant_id = ?', [T]);
  const found = await agg.rebuildLeadsStatsAgg(pool, T);
  assert.equal(found.drifted, true);
  assert.equal(found.leads, 5, 'five leads too many in one row');
  await noDrift('after the recount');
  const [[daily]] = await pool.query('SELECT COALESCE(SUM(n),0) AS n FROM leads_created_daily WHERE tenant_id = ?', [T]);
  assert.equal(Number(daily.n), 2, 'the daily table is rebuilt too');
  assert.equal((await agg.rebuildLeadsStatsAgg(pool, T)).drifted, false, 'a second recount finds nothing');
});
