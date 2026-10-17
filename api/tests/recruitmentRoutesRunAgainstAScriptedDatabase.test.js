'use strict';
/**
 * The applications and interviews routes, run against a scripted database (the pattern of
 * purchaseWithoutEmail.test.js): every query they send must carry exactly as many parameters as it has
 * placeholders, and the answers must have the shape the screens read. There is no MariaDB in this
 * suite's unit tests, so a slip in the filters' SQL would otherwise first show to the desk.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-recruitment-secret-0123456789-abcdefghijklmnop';

const db = {
  calls: [],
  script: [],
  async query(sql, params = []) {
    const flat = String(sql).replace(/\s+/g, ' ').trim();
    db.calls.push({ sql: flat, params });
    for (const [pattern, answer] of db.script) {
      if (pattern.test(flat)) return typeof answer === 'function' ? answer(params, flat) : answer;
    }
    return [[]];
  },
  reset(script = []) { db.calls = []; db.script = script; },
};
const conn = {
  query: (...args) => db.query(...args), execute: (...args) => db.query(...args),
  async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query: (...args) => db.query(...args), execute: (...args) => db.query(...args), getConnection: async () => conn },
  cached: async (_key, _ttl, fn) => fn(), cacheInvalidate() {},
  dbQuery: (...args) => db.query(...args), dbExecute: (...args) => db.query(...args),
  getStaffIdByEmail: async () => null, requireDb: (_req, _res, next) => next(), isDbDown: () => false,
});

const operations = require('../routes/admin-operations');
const recruiting = require('../routes/hr/recruiting');

const handlerOf = (router, route) => {
  const layer = router.stack.find(item => item.route && item.route.path === route && item.route.methods.get);
  assert.ok(layer, `GET ${route} is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};
async function call(handler, query = {}, reach = { all: true }) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  const req = { query, params: {}, body: {}, headers: {}, tenantId: 'tenant-default', recruitReach: reach, user: { isAdmin: true }, get: () => undefined };
  await handler(req, res);
  return res;
}
const placeholders = sql => (sql.match(/\?/g) || []).length;
const everyQueryBalanced = () => {
  assert.ok(db.calls.length > 0, 'the route queried the database');
  for (const { sql, params } of db.calls) {
    assert.equal(placeholders(sql), params.length, `placeholders and parameters agree in: ${sql.slice(0, 120)}`);
  }
};

const row = (id, extra = {}) => ({ id, name: `n${id}`, source_form: 'staff', programs_json: null, first_call_tags: '[]', ...extra });

test('the applications list pages, filters in the database, and answers rows with a total', async () => {
  const list = handlerOf(operations.router || operations, '/api/admin/join-us');
  db.reset([[/SELECT COUNT\(\*\) n/, [[{ n: 130 }]]], [/FROM join_us_applications j/, [Array.from({ length: 50 }, (_, i) => row(i))]]]);
  const res = await call(list, {
    paged: '1', inbox: '1', form: 'staff', status: 'NEW', branch: 'daqqi', job: 'job-1', minExp: '3-5', q: 'سارة', limit: '50', offset: '0',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.rows.length, 50);
  assert.equal(res.body.total, 130, 'a full page asks the database how many there are');
  everyQueryBalanced();
  const select = db.calls.find(call => /LIMIT 50 OFFSET 0/.test(call.sql));
  assert.ok(select, 'the page is 50 rows');
  assert.match(select.sql, /a\.stage IS NULL OR a\.stage NOT IN \('interview','offer'\)/, 'those moved to the interviews are not listed');
  assert.match(select.sql, /UPPER\(COALESCE\(NULLIF\(j\.status,''\),'NEW'\)\) = \?/);
});

test('a short page is its own total, without a count query', async () => {
  const list = handlerOf(operations.router || operations, '/api/admin/join-us');
  db.reset([[/FROM join_us_applications j/, [[row(1), row(2)]]]]);
  const res = await call(list, { paged: '1', inbox: '1', form: 'teaching', limit: '50', offset: '0' });
  assert.deepEqual({ rows: res.body.rows.length, total: res.body.total }, { rows: 2, total: 2 });
  assert.equal(db.calls.filter(call => /COUNT\(\*\)/.test(call.sql)).length, 0);
  everyQueryBalanced();
});

test('without ?paged the list is the plain array the analytics screens read, moved applications included', async () => {
  const list = handlerOf(operations.router || operations, '/api/admin/join-us');
  db.reset([[/FROM join_us_applications j/, [[row(1)]]]]);
  const res = await call(list, { limit: '1000', offset: '0' });
  assert.ok(Array.isArray(res.body));
  assert.doesNotMatch(db.calls[0].sql, /NOT IN \('interview','offer'\)/);
  everyQueryBalanced();
});

test('a branch manager\'s page stays inside their branch', async () => {
  const list = handlerOf(operations.router || operations, '/api/admin/join-us');
  db.reset([[/FROM join_us_applications j/, [[row(1)]]]]);
  await call(list, { paged: '1', inbox: '1', form: 'staff' }, { all: false, branch: 'DAQQI' });
  everyQueryBalanced();
  assert.ok(db.calls[0].params.includes('daqqi'));

  const interviews = handlerOf(recruiting.router || recruiting, '/api/admin/hr/interviews');
  db.reset([[/FROM job_applicants a/, [[row('a1', { stage: 'interview' })]]]]);
  await call(interviews, { tab: 'upcoming' }, { all: false, branch: 'DAQQI' });
  everyQueryBalanced();
  assert.ok(db.calls[0].params.includes('daqqi'), 'the interviews are narrowed the same way');
});

test('the counts and the pickers use the same scope and answer what the page reads', async () => {
  const counts = handlerOf(operations.router || operations, '/api/admin/join-us/counts');
  db.reset([[/GROUP BY form, status/, [[{ form: 'staff', status: 'NEW', n: 4 }, { form: 'staff', status: 'REJECTED', n: 1 }]]]]);
  const tally = await call(counts, { inbox: '1', form: 'staff' });
  assert.equal(tally.body.byFormStatus.staff.NEW, 4);
  assert.match(db.calls[0].sql, /NOT IN \('interview','offer'\)/);
  everyQueryBalanced();

  const facets = handlerOf(operations.router || operations, '/api/admin/join-us/facets');
  db.reset([
    [/GROUP BY a\.job_id, jp\.title/, [[{ id: 'job-1', title: 'محاسب', n: 3 }]]],
    [/GROUP BY branch/, [[{ branch: 'daqqi', n: 2 }, { branch: null, n: 1 }]]],
    [/SELECT j\.programs_json/, [[{ programs_json: '[{"id":"c1","title":"دبلومة"}]' }, { programs_json: '[{"id":"c1","title":"دبلومة"}]' }]]],
  ]);
  const picks = await call(facets, { inbox: '1', form: 'teaching' });
  assert.deepEqual(picks.body.jobs, [{ id: 'job-1', title: 'محاسب', count: 3 }]);
  assert.deepEqual(picks.body.branches, [{ key: 'daqqi', count: 2 }]);
  assert.deepEqual(picks.body.programs, [{ title: 'دبلومة', count: 2 }]);
  everyQueryBalanced();
});

test('the interviews page: upcoming is not-held, past is held, both only at interview or offer', async () => {
  const list = handlerOf(recruiting.router || recruiting, '/api/admin/hr/interviews');
  for (const tab of ['upcoming', 'past']) {
    db.reset([[/FROM job_applicants a/, [[row('a1', { stage: 'interview' })]]]]);
    const res = await call(list, { tab, view: 'interview', job: 'job-1', branch: 'daqqi', minExp: '1-3', grade: 'B', q: 'x', limit: '50', offset: '0' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual({ n: res.body.rows.length, total: res.body.total }, { n: 1, total: 1 });
    everyQueryBalanced();
    const sql = db.calls[0].sql;
    assert.match(sql, /a\.stage IN \('interview','offer'\)/);
    assert.equal(/ AND NOT \(a\.interview_grade IS NOT NULL/.test(sql), tab === 'upcoming');
    assert.match(sql, /LIMIT 50 OFFSET 0/);
  }
});

test('the interviews summary tallies both tabs, the stages of the open one, and the pickers', async () => {
  const summary = handlerOf(recruiting.router || recruiting, '/api/admin/hr/interviews/summary');
  db.reset([
    [/COUNT\(\*\) total, COALESCE\(SUM/, [[{ total: 10, past: 4 }]]],
    [/GROUP BY a\.stage/, [[{ stage: 'interview', n: 5 }, { stage: 'offer', n: 1 }]]],
    [/GROUP BY a\.job_id, j\.title/, [[{ id: 'job-1', title: 'محاسب', n: 6 }]]],
    [/GROUP BY branch/, [[{ branch: 'daqqi', n: 6 }]]],
    [/GROUP BY a\.interview_grade, a\.second_interview_grade/, [[{ g1: 'A', g2: 'B', n: 2 }, { g1: 'A', g2: null, n: 1 }, { g1: null, g2: null, n: 7 }]]],
  ]);
  const res = await call(summary, { tab: 'upcoming' });
  assert.deepEqual(res.body.tabs, { upcoming: 6, past: 4 });
  assert.deepEqual(res.body.stages, { interview: 5, offer: 1 });
  assert.deepEqual(res.body.grades, { A: 3, B: 2 });
  assert.deepEqual(res.body.jobs, [{ id: 'job-1', title: 'محاسب', count: 6 }]);
  assert.deepEqual(res.body.branches, [{ key: 'daqqi', count: 6 }]);
  everyQueryBalanced();
});
