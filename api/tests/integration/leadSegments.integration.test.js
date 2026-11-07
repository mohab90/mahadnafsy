'use strict';
/**
 * 7 Nov 2026: GET /api/admin/leads/segments — «الشرائح» of the marketing hub, an audience picked out by status, source, score, age and a search, counted and paged
 * by the database — against a real MariaDB, on leads whose answers are worked out here in JavaScript from the rows that were inserted: every filter's size, its rows
 * (newest first), its page limits, the two drop-down lists, a hidden lead being in no audience, and a rep seeing only their own. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-segments-it';
let pool, router, db;
const DAY = 86400000;

const segment = async (query = {}, req = {}) => {
  db.cacheInvalidateLocal('figures:');
  const layer = router.stack.find(l => l.route?.path === '/api/admin/leads/segments');
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
  await layer.route.stack.at(-1).handle({ params: {}, query, body: {}, headers: {}, tenantId: T, user: { uid: 'admin' }, staffRecord: null, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined, ...req }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return JSON.parse(JSON.stringify(res.body));
};

const leads = [];
before(async () => {
  if (!ENABLED) return;
  db = require('../../lib/db');
  ({ pool } = db);
  router = require('../../routes/admin/leads/stats');
  for (const table of ['leads', 'leads_stats_agg', 'leads_created_daily', 'leads_score_agg']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]);
  const now = Date.now();
  const spec = [
    ['interested', 'Facebook', 85, 2, 'rep-a', 'منى'], ['interested', 'facebook', 72, 5, 'rep-a', 'هبة'], ['interested', 'google', 40, 20, 'rep-b', 'سلمى'],
    ['no_answer', 'facebook', 10, 3, 'rep-a', 'نور'], ['converted', 'referral', 95, 40, 'rep-b', 'ياسمين'], ['new', 'referral', 25, 1, 'rep-a', 'دينا'],
    ['new', 'tiktok', 30, 90, 'rep-b', 'رنا'], ['contacted', 'facebook', 55, 8, 'rep-a', 'أسماء'], ['new', '', 0, 6, 'rep-b', 'بدون مصدر'],
  ];
  let i = 0;
  for (const [status, source, score, daysAgo, rep, name] of spec) {
    i += 1;
    const created = new Date(now - daysAgo * DAY);
    await pool.query('INSERT INTO leads (id, tenant_id, name, phone, source, status, score, created_at, assigned_sales_id) VALUES (?,?,?,?,?,?,?,?,?)',
      [`sg-${i}`, T, name, `10199${String(i).padStart(5, '0')}`, source, status, score, created, rep]);
    leads.push({ id: `sg-${i}`, name, phone: `10199${String(i).padStart(5, '0')}`, source, status, score, created: created.getTime(), rep });
  }
  await pool.query('INSERT INTO leads (id, tenant_id, name, phone, source, status, score, hidden) VALUES (?,?,?,?,?,?,?,1)', ['sg-hidden', T, 'مخفي', '10199999999', 'facebook', 'interested', 99]);
});
after(async () => {
  if (!ENABLED) return;
  for (const table of ['leads', 'leads_stats_agg', 'leads_created_daily', 'leads_score_agg']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  await pool.end();
});

const expected = ({ status, source, minScore = 0, daysNew = 0, q = '' } = {}, from = leads) => from.filter(l =>
  (!status || status === 'all' || l.status === status)
  && (!source || source === 'all' || l.source.toLowerCase() === source)
  && l.score >= minScore
  && (!daysNew || l.created >= Date.now() - daysNew * DAY)
  && (!q || l.name.includes(q) || l.phone.includes(q))).sort((a, b) => b.created - a.created);

test('every filter picks out the audience worked out by hand, newest first', { skip }, async () => {
  const cases = [
    {}, { status: 'interested' }, { status: 'interested', minScore: 70 }, { source: 'facebook' }, { source: 'referral' }, { daysNew: 7 }, { daysNew: 30 }, { minScore: 50 },
    { status: 'no_answer' }, { status: 'converted' }, { q: 'نور' }, { q: '1019900003' }, { status: 'new', daysNew: 7, minScore: 20 }, { source: 'nothing-like-this' },
  ];
  for (const query of cases) {
    const want = expected(query);
    const got = await segment(Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])));
    assert.equal(got.total, want.length, `${JSON.stringify(query)}: the audience's size`);
    assert.deepEqual(got.rows.map(row => row.id), want.map(l => l.id), `${JSON.stringify(query)}: its rows, newest first`);
  }
});

test('the hidden lead is in no audience, the drop-downs list what the book holds, and a page is at most 200', { skip }, async () => {
  const all = await segment({ pageSize: '3' });
  assert.equal(all.total, 9);
  assert.equal(all.base, 9);
  assert.equal(all.rows.length, 3);
  assert.ok(!(await segment({ pageSize: '500' })).rows.some(row => row.id === 'sg-hidden'));
  assert.equal((await segment({ pageSize: '500' })).pageSize, 200, 'never more than 200 rows');
  const facets = all.facets;
  assert.deepEqual(Object.fromEntries(facets.statuses.map(s => [s.value, s.count])), { interested: 3, new: 3, no_answer: 1, converted: 1, contacted: 1 });
  assert.deepEqual(Object.fromEntries(facets.sources.map(s => [s.value, s.count])), { facebook: 4, referral: 2, google: 1, tiktok: 1 }, 'sources folded to lower case, the empty one left out');
  const second = await segment({ pageSize: '3', page: '1' });
  assert.deepEqual([...all.rows, ...second.rows].map(r => r.id), expected().slice(0, 6).map(l => l.id));
});

test('a rep sees only their own leads in an audience', { skip }, async () => {
  const rep = { isSuperAdmin: false, staffRecord: { id: 'rep-a', role: 'sales', permissions: ['view_leads'] } };
  const mine = leads.filter(l => l.rep === 'rep-a');
  const got = await segment({ source: 'facebook' }, rep);
  assert.deepEqual(got.rows.map(r => r.id), expected({ source: 'facebook' }, mine).map(l => l.id));
  assert.equal(got.base, mine.length);
});
