'use strict';
// The scores this job maintains decide the order reps work their pipeline, so
// the rules worth pinning are: it only writes when the score actually changed,
// it never touches terminal leads, and it must not disturb updated_at — that
// column drives the stale-lead reports and this job's own sweep order.
const { test } = require('node:test');
const assert = require('node:assert');
const { refreshLeadScores, CLOSED_STATUSES } = require('../lib/leadScoreRefresh');

/** Minimal pool double: records every query and returns canned SELECT rows. */
function mockPool(selectRows) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/^\s*SELECT/i.test(sql)) return [selectRows, []];
      return [{ affectedRows: 1 }, []];
    },
  };
}

const lead = (over = {}) => ({
  id: 'l1', tenant_id: 't1', status: 'new', interest_level: 'HIGH',
  next_follow_up_date: null, interested_course_ids_json: null,
  created_at: '2026-01-01 00:00:00', score: 0, crm_json: null, ...over,
});

test('writes only the leads whose score actually changed', async () => {
  const pool = mockPool([lead({ id: 'a', score: 0 }), lead({ id: 'b', score: 0 })]);
  const { scanned, updated } = await refreshLeadScores(pool);
  assert.equal(scanned, 2);
  assert.equal(updated, 2);
  assert.equal(pool.queries.filter(q => /^UPDATE/i.test(q.sql)).length, 2);
});

test('a lead already holding the right score is not rewritten', async () => {
  // Score it once to learn the expected value, then feed that value back in.
  const probe = mockPool([lead()]);
  await refreshLeadScores(probe);
  const written = probe.queries.find(q => /^UPDATE/i.test(q.sql));
  const settledScore = written.params[0];

  const pool = mockPool([lead({ score: settledScore })]);
  const { scanned, updated } = await refreshLeadScores(pool);
  assert.equal(scanned, 1);
  assert.equal(updated, 0, 'an unchanged score must not cost a write');
  assert.equal(pool.queries.filter(q => /^UPDATE/i.test(q.sql)).length, 0);
});

test('the update preserves updated_at explicitly', async () => {
  // leads.updated_at is ON UPDATE current_timestamp(), so without an explicit
  // assignment every rescore would mark neglected leads as freshly worked and
  // hide them from the stale-lead reports.
  const pool = mockPool([lead()]);
  await refreshLeadScores(pool);
  const written = pool.queries.find(q => /^UPDATE/i.test(q.sql));
  assert.match(written.sql, /updated_at\s*=\s*updated_at/);
});

test('terminal statuses are excluded from the sweep', async () => {
  const pool = mockPool([]);
  await refreshLeadScores(pool);
  const select = pool.queries.find(q => /^\s*SELECT/i.test(q.sql));
  assert.match(select.sql, /status NOT IN/);
  for (const status of ['converted', 'lost', 'archived']) {
    assert.ok(select.params.includes(status), `${status} must be excluded`);
  }
  // Re-scoring a closed lead is pure write cost on the busiest table.
  assert.ok(CLOSED_STATUSES.includes('converted'));
});

test('hidden and soft-deleted leads are never rescored', async () => {
  const pool = mockPool([]);
  await refreshLeadScores(pool);
  const select = pool.queries.find(q => /^\s*SELECT/i.test(q.sql));
  assert.match(select.sql, /hidden = 0/);
  assert.match(select.sql, /deleted_at IS NULL/);
});

test('the batch is always capped, however the caller is called', async () => {
  for (const [requested, expected] of [[50, 50], [999999, 10000], [0, 2000], [-5, 2000]]) {
    const pool = mockPool([]);
    await refreshLeadScores(pool, { limit: requested });
    const select = pool.queries.find(q => /^\s*SELECT/i.test(q.sql));
    assert.equal(select.params.at(-1), expected, `limit ${requested}`);
  }
});

test('a tenant filter is applied when one is given, and omitted when not', async () => {
  const scoped = mockPool([]);
  await refreshLeadScores(scoped, { tenantId: 't1' });
  const a = scoped.queries.find(q => /^\s*SELECT/i.test(q.sql));
  assert.match(a.sql, /l\.tenant_id = \?/);
  assert.equal(a.params[0], 't1');

  const all = mockPool([]);
  await refreshLeadScores(all);
  const b = all.queries.find(q => /^\s*SELECT/i.test(q.sql));
  assert.doesNotMatch(b.sql, /l\.tenant_id = \?/);
});

test('every write is tenant-scoped', async () => {
  const pool = mockPool([lead({ tenant_id: 't-9' })]);
  await refreshLeadScores(pool);
  const written = pool.queries.find(q => /^UPDATE/i.test(q.sql));
  assert.match(written.sql, /tenant_id = \?/);
  assert.ok(written.params.includes('t-9'));
});
