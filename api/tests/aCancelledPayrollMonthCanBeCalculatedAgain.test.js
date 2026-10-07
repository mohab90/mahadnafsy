'use strict';

// MED-14 of the external audit (7 Oct 2026): a payroll run, once cancelled,
// closed its month and branch for good. The unique key keeps one run per month
// and branch, the calculation refused a cancelled one, and nothing on the
// screen reopens it. A cancelled run is now calculated again from scratch.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-payroll-cancel-secret-0123456789-abcdefghij';

const db = {
  calls: [], script: [],
  async query(sql, params = []) {
    const flat = String(sql).replace(/\s+/g, ' ').trim();
    db.calls.push({ sql: flat, params });
    for (const [pattern, answer] of db.script) if (pattern.test(flat)) return typeof answer === 'function' ? answer(params) : answer;
    return [[]];
  },
  reset(script) { db.calls = []; db.script = script; },
};
const conn = { query: (...a) => db.query(...a), async beginTransaction() {}, async commit() {}, async rollback() { db.calls.push({ sql: 'ROLLBACK' }); }, release() {} };
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query: (...a) => db.query(...a), execute: (...a) => db.query(...a), getConnection: async () => conn },
  cached: async (_k, _t, fn) => fn(), cacheInvalidate() {}, requireDb: (_q, _s, n) => n(), isDbDown: () => false,
  getStaffIdByEmail: async () => null,
});
stub('../lib/hrPolicy', { getEffectiveHrPolicy: async () => ({ work_days_per_month: '26', workday_minutes: '480' }) });

const router = require('../routes/hr/payroll');
const handler = router.stack.find(l => l.route && l.route.path === '/api/admin/hr/payroll/calculate' && l.route.methods.post)
  .route.stack.slice(-1)[0].handle;

async function calculate(runStatus) {
  db.reset([[/SELECT id,status FROM payroll_runs WHERE month=\?/, [[{ id: 'run-9', status: runStatus }]]]]);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ body: { month: 9, year: 2026 }, tenantId: 'tenant-default', staffRecord: { id: 'st-hr' }, user: { uid: 'u' } }, res);
  return res;
}

test('a cancelled month is calculated again, its old approval cleared', async () => {
  const res = await calculate('CANCELLED');
  assert.notEqual(res.body?.error, 'لا يمكن إعادة احتساب مسير معتمد أو مدفوع');
  const reopen = db.calls.find(call => /^UPDATE payroll_runs SET status='CALCULATED'/.test(call.sql));
  assert.ok(reopen, 'the run is set back to CALCULATED');
  assert.match(reopen.sql, /approved_by=NULL,approved_at=NULL/);
  assert.ok(db.calls.some(call => /^DELETE FROM payroll_items WHERE payroll_run_id=\?/.test(call.sql)), 'its old lines are rebuilt');
});

test('an approved or paid month still is not', async () => {
  for (const status of ['APPROVED', 'PAID']) {
    const res = await calculate(status);
    assert.equal(res.statusCode, 409, status);
    assert.ok(!db.calls.some(call => /^UPDATE payroll_runs SET status='CALCULATED'/.test(call.sql)), status);
  }
});
