'use strict';

// lib/dataRetention.js trims what only ever grew; each statement must be
// bounded (a LIMIT and a time cutoff) and each window settable per server.

const assert = require('node:assert/strict');
const test = require('node:test');
const { retentionRules, ruleSql, runDataRetention } = require('../lib/dataRetention');

test('every rule is batched and cut off by age', () => {
  for (const rule of retentionRules({})) {
    const sql = ruleSql(rule);
    assert.match(sql, /< \? LIMIT \?$/, rule.name);
    assert.ok(rule.days >= 30, rule.name);
  }
});

test('the windows follow the environment; 0 is off and a tiny value is raised to a week', () => {
  const byName = env => Object.fromEntries(retentionRules(env).map(rule => [rule.name, rule.days]));
  assert.equal(byName({ RETENTION_JOB_QUEUE_DAYS: '0' })['job_queue done'], 0);
  assert.equal(byName({ RETENTION_LOGIN_HISTORY_DAYS: '1' }).login_history, 7);
  assert.equal(byName({ RETENTION_LOGIN_HISTORY_DAYS: 'abc' }).login_history, 365);
});

test('a batch that comes back full is followed by another, a short one ends the rule', async () => {
  const calls = [];
  const affected = [2, 2, 1];
  const pool = { query: async (sql, params) => { calls.push([sql, params]); return [{ affectedRows: sql.includes('job_queue') ? affected.shift() : 0 }]; } };
  const summary = await runDataRetention({ pool, logger: null, batch: 2, gapMs: 0, now: Date.UTC(2026, 9, 21) });
  assert.equal(summary['job_queue done'], 5);
  assert.equal(calls.filter(([sql]) => sql.includes('job_queue')).length, 3);
  assert.equal(calls[0][1][0].toISOString(), '2026-09-21T00:00:00.000Z', '30 days before now');
});

test('a table the database lacks skips its own rule only', async () => {
  const pool = { query: async sql => { if (sql.includes('login_history')) throw new Error('no such table'); return [{ affectedRows: 0 }]; } };
  const warned = [];
  const summary = await runDataRetention({ pool, logger: { warn: (...a) => warned.push(a.join(' ')) }, gapMs: 0 });
  assert.equal(summary.login_history, 0);
  assert.ok('admin_notifications read' in summary);
  assert.match(warned[0], /login_history failed/);
});
