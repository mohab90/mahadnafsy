'use strict';
/**
 * The CRM's large-table paths (migration 235, lib/leadScoreRefresh.js) against a
 * real MariaDB: the stored score equals the formula after a refresh, so the KPI
 * and scoring screens agree with what they used to compute live; indexed search
 * finds what the substring scan found; the deferred-join and cursor pages walk
 * the list exactly; and the split idle-lead search returns the same fifty the
 * single query did. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-lead-scale-it';
const LEADS = 30;
let pool, router;

const handler = (path) => {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods.get);
  assert.ok(layer, path);
  return layer.route.stack.at(-1).handle;
};
async function get(path, query = {}) {
  const res = {
    statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    set(key, value) { this.headers[key] = value; return this; },
  };
  await handler(path)({
    params: {}, body: {}, query, headers: {}, tenantId: TENANT, user: { uid: 'admin', email: 'a@example.test' },
    staffRecord: null, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined,
  }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res;
}

async function clean() {
  for (const table of ['communications', 'leads', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

const NAMES = ['Yasmin Adel', 'Omar Fathy', 'ياسمين عادل', 'منى حسن', 'Karim Said'];
const STATUSES = ['new', 'contacted', 'interested', 'converted', 'archived', 'follow_up'];

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/admin/leads');
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('ls-rep-1', ?, 'Rep One', 'ls-rep1@example.test', '1017000001', 'SALES', 1, '2025-01-01'),
       ('ls-rep-2', ?, 'Rep Two', 'ls-rep2@example.test', '1017000002', 'SALES', 1, '2025-01-01')`, [TENANT, TENANT]);
  const leads = [];
  for (let i = 0; i < LEADS; i++) {
    // Several leads share a created_at so the pages must break ties on id.
    const created = new Date(Date.UTC(2026, 5, 1 + Math.floor(i / 3), 9, 0, 0));
    leads.push([`ls-lead-${String(i).padStart(2, '0')}`, TENANT, `C9${String(i).padStart(4, '0')}`, `${NAMES[i % NAMES.length]} ${i}`,
      i % 4 === 0 ? `person${i}@mail.test` : null, `10170${String(10000 + i).padStart(5, '0')}`, 'facebook', STATUSES[i % STATUSES.length],
      i % 5 === 4 ? null : `ls-rep-${1 + (i % 2)}`, created, created, 0, 0, i % 3 === 0 ? 'HIGH' : null]);
  }
  await pool.query(
    `INSERT INTO leads (id, tenant_id, client_code, name, email, phone, source, status, assigned_sales_id, created_at, updated_at, hidden, score, interest_level)
     VALUES ?`, [leads]);
  const comms = [];
  for (let i = 0; i < LEADS; i += 2) {
    for (let k = 0; k <= i % 3; k++) {
      comms.push([`ls-com-${i}-${k}`, TENANT, leads[i][0], k ? 'WHATSAPP' : 'CALL', new Date(Date.UTC(2026, 6, 1 + i, 12)), 'n', 'ls-rep-1']);
    }
  }
  await pool.query('INSERT INTO communications (id, tenant_id, lead_id, type, date, notes, staff_id) VALUES ?', [comms]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('after a refresh the stored score is the formula, and the KPI figures are the ones it used to compute live', { skip }, async () => {
  const { refreshLeadScores } = require('../../lib/leadScoreRefresh');
  const { LEAD_SCORE_SQL } = require('../../lib/leadScoreSql');
  const commJoin = `LEFT JOIN (SELECT lead_id, COUNT(*) AS comm_count, MAX(date) AS last_comm FROM communications
                     WHERE tenant_id = ? AND lead_id IS NOT NULL GROUP BY lead_id) lc ON lc.lead_id = l.id`;
  const first = await refreshLeadScores(pool, { tenantId: TENANT, batch: 7 });
  assert.equal(first.scanned, LEADS);
  assert.ok(first.updated > 0, 'every lead was seeded with score 0');
  const [drift] = await pool.query(
    `SELECT l.id, l.score, ${LEAD_SCORE_SQL} AS formula FROM leads l ${commJoin}
      WHERE l.tenant_id = ? HAVING score <> formula`, [TENANT, TENANT]);
  assert.deepEqual(drift, []);
  assert.equal((await refreshLeadScores(pool, { tenantId: TENANT })).updated, 0, 'a second pass changes nothing');

  // What the removed whole-table query returned.
  const [[old]] = await pool.query(
    `SELECT COALESCE(AVG(${LEAD_SCORE_SQL}), 0) AS avg_score, COALESCE(SUM(COALESCE(lc.comm_count, 0)), 0) AS total_comms
       FROM leads l ${commJoin} WHERE l.tenant_id = ? AND l.hidden = 0`, [TENANT, TENANT]);
  const { body } = await get('/api/admin/leads/stats');
  assert.equal(body.total, LEADS);
  assert.equal(body.avgScore, Math.round(Number(old.avg_score)));
  assert.equal(body.totalCommunications, Number(old.total_comms));

  const scored = (await get('/api/admin/leads/scored', { minScore: '20', limit: '500' })).body;
  const [[expected]] = await pool.query('SELECT COUNT(*) AS n FROM leads WHERE tenant_id = ? AND hidden = 0 AND score >= 20', [TENANT]);
  assert.equal(scored.total, Number(expected.n));
  assert.equal(scored.rows.length, Number(expected.n));
  for (let i = 1; i < scored.rows.length; i++) assert.ok(scored.rows[i - 1].score >= scored.rows[i].score, 'highest first');
  const withComms = scored.rows.find(r => r.id === 'ls-lead-04');
  if (withComms) assert.equal(withComms.communicationCount, 2, 'the page carries its own communication counts');
});

test('indexed search finds what the substring scan found, and falls back to it for fragments', { skip }, async () => {
  const ids = async q => (await get('/api/admin/leads', { q, limit: '500' })).body.map(l => l.id).sort();
  // The phone as a person types it, in another spelling than the one stored.
  assert.deepEqual(await ids('+20 1017010007'), ['ls-lead-07']);
  assert.deepEqual(await ids('01017010007'), ['ls-lead-07']);
  // Whole words → FULLTEXT; the same leads LIKE would have matched.
  const like = async pattern => (await pool.query(
    'SELECT id FROM leads WHERE tenant_id = ? AND hidden = 0 AND name LIKE ? ORDER BY id', [TENANT, pattern]))[0].map(r => r.id);
  assert.deepEqual(await ids('Yasmin'), await like('%Yasmin%'));
  assert.deepEqual(await ids('ياسمين عادل'), await like('%ياسمين عادل%'));
  // The middle of a word is not a word prefix: the scan still finds it.
  assert.deepEqual(await ids('smi'), await like('%smi%'));
  assert.ok((await ids('smi')).length > 0);
  // Too short for the index.
  assert.deepEqual(await ids('Om'), await like('%Om%'));
});

test('offset pages (deferred join) and cursor pages walk the list exactly', { skip }, async () => {
  const [all] = await pool.query(
    'SELECT id FROM leads WHERE tenant_id = ? AND hidden = 0 ORDER BY created_at DESC, id DESC', [TENANT]);
  const expected = all.map(r => r.id);

  const byOffset = [];
  for (let offset = 0; offset < LEADS; offset += 7) {
    byOffset.push(...(await get('/api/admin/leads', { limit: '7', offset: String(offset) })).body.map(l => l.id));
  }
  assert.deepEqual(byOffset, expected);

  const first = await get('/api/admin/leads', { limit: '7' });
  const byCursor = first.body.map(l => l.id);
  let cursor = first.headers['X-Next-Cursor'];
  assert.ok(cursor, 'the first page hands out a cursor');
  while (cursor) {
    const page = await get('/api/admin/leads', { limit: '7', cursor });
    byCursor.push(...page.body.map(l => l.id));
    cursor = page.headers['X-Next-Cursor'];
  }
  assert.deepEqual(byCursor, expected, 'ties on created_at break on id, no row lost or repeated');
});

test('the idle-lead search returns the fifty the single query did', { skip }, async () => {
  const { sqlCairoToday } = require('../../lib/dates');
  const excluded = ['converted', 'lost', 'not_interested_hidden', 'wrong_number'];
  const [old] = await pool.query(
    `SELECT l.id, COALESCE((SELECT MAX(c.date) FROM communications c WHERE c.tenant_id = l.tenant_id AND c.lead_id = l.id), l.created_at) AS last_activity
       FROM leads l
      WHERE l.tenant_id = ? AND l.hidden = 0 AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> '' AND l.status NOT IN (?)
     HAVING DATE(last_activity) <= ${sqlCairoToday()} - INTERVAL 14 DAY
      ORDER BY last_activity ASC, l.id ASC LIMIT 50`, [TENANT, excluded]);
  assert.ok(old.length > 5, 'sanity: the fixture has idle leads of both kinds');
  const { body } = await get('/api/admin/leads/crm-insights');
  assert.deepEqual(body.redistCandidates.map(r => r.lead.id), old.map(r => r.id));
});
