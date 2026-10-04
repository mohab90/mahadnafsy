'use strict';
// The CRM screens aggregate leads.score, so the rules worth pinning are: the job
// writes the shared SQL formula and nothing else, it reaches every visible lead
// (not a capped slice), it only writes rows whose score moved, and it never
// disturbs updated_at — that column drives the stale-lead reports.
const { test } = require('node:test');
const assert = require('node:assert');
const { refreshLeadScores } = require('../lib/leadScoreRefresh');
const { LEAD_SCORE_SQL } = require('../lib/leadScoreSql');

/** Pool double: serves `ids` in primary-key pages and records every query. */
function mockPool(ids, { changed = () => 1 } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/^\s*SELECT id FROM leads/i.test(sql)) {
        const after = params[0];
        const size = params.at(-1);
        return [ids.filter(id => id > after).slice(0, size).map(id => ({ id })), []];
      }
      return [{ affectedRows: changed(params[0]) }, []];
    },
  };
}
const updates = pool => pool.queries.filter(q => /^\s*UPDATE leads l/i.test(q.sql));

test('every visible lead is reached, batch after batch, not a capped slice', async () => {
  const ids = Array.from({ length: 23 }, (_, i) => `lead-${String(i).padStart(3, '0')}`);
  const pool = mockPool(ids);
  const { scanned } = await refreshLeadScores(pool, { batch: 5 });
  assert.equal(scanned, 23);
  const written = updates(pool).flatMap(q => q.params[1]);
  assert.deepEqual(written, ids, 'each lead appears in exactly one batch, in key order');
});

test('the update writes the shared formula and only where the score moved', async () => {
  const pool = mockPool(['a', 'b']);
  await refreshLeadScores(pool);
  const [update] = updates(pool);
  assert.ok(update.sql.includes(`SET l.score = ${LEAD_SCORE_SQL}`), 'the formula the screens used, not a copy');
  assert.ok(update.sql.includes(`l.score <> ${LEAD_SCORE_SQL}`), 'an unchanged score must not cost a write');
});

test('the update preserves updated_at explicitly', async () => {
  // leads.updated_at is ON UPDATE current_timestamp(), so without an explicit
  // assignment every rescore would mark neglected leads as freshly worked.
  const pool = mockPool(['a']);
  await refreshLeadScores(pool);
  assert.match(updates(pool)[0].sql, /l\.updated_at = l\.updated_at/);
});

test('hidden and soft-deleted leads are not scored; closed ones are', async () => {
  const pool = mockPool([]);
  await refreshLeadScores(pool);
  const select = pool.queries[0];
  assert.match(select.sql, /hidden = 0/);
  assert.match(select.sql, /deleted_at IS NULL/);
  assert.doesNotMatch(select.sql, /status NOT IN/, 'the KPI mean covers closed leads, so they are kept current too');
});

test('communications are matched on tenant as well as lead', async () => {
  const pool = mockPool(['a']);
  await refreshLeadScores(pool);
  assert.match(updates(pool)[0].sql, /lc\.lead_id = l\.id AND lc\.tenant_id = l\.tenant_id/);
});

test('the batch size is bounded, however the caller asks', async () => {
  for (const [requested, expected] of [[50, 50], [999999, 20000], [0, 5000], [-5, 5000], ['x', 5000]]) {
    const pool = mockPool([]);
    await refreshLeadScores(pool, { batch: requested });
    assert.equal(pool.queries[0].params.at(-1), expected, `batch ${requested}`);
  }
});

test('a tenant filter is applied when one is given, and omitted when not', async () => {
  const scoped = mockPool([]);
  await refreshLeadScores(scoped, { tenantId: 't1' });
  assert.match(scoped.queries[0].sql, /tenant_id = \?/);
  assert.equal(scoped.queries[0].params[1], 't1');

  const all = mockPool([]);
  await refreshLeadScores(all);
  assert.doesNotMatch(all.queries[0].sql, /tenant_id = \?/);
});

test('updated counts the rows the database actually changed', async () => {
  const pool = mockPool(['a', 'b', 'c'], { changed: () => 2 });
  const { scanned, updated } = await refreshLeadScores(pool);
  assert.equal(scanned, 3);
  assert.equal(updated, 2);
});
