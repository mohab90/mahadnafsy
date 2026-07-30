'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createJobQueue, recurringDedupeKey } = require('../lib/jobQueue');

test('recurring keys are stable within a window and change across windows', () => {
  assert.equal(recurringDedupeKey('daily', 1000, 1999), 'daily:1');
  assert.equal(recurringDedupeKey('daily', 1000, 2000), 'daily:2');
});

test('enqueue returns the existing id when a recurring job is duplicated', async () => {
  let calls = 0;
  const db = {
    async query(sql) {
      calls += 1;
      if (sql.includes('INSERT INTO job_queue')) {
        const error = new Error('duplicate');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      return [[{ id: 'existing-job' }]];
    },
  };

  const id = await createJobQueue(db).enqueue('daily', {}, { dedupeKey: 'daily:1' });
  assert.equal(id, 'existing-job');
  assert.equal(calls, 2);
});

test('claim increments attempts inside a transaction and records worker ownership', async () => {
  const calls = [];
  const conn = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
    async query(sql, params) {
      if (sql.includes('SELECT * FROM job_queue')) {
        return [[{ id: 'job-1', job_type: 'noop', attempts: 1, max_attempts: 3 }]];
      }
      calls.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };
  const job = await createJobQueue({ getConnection: async () => conn }).claim('worker-a');

  assert.equal(job.attempts, 2);
  assert.equal(job.locked_by, 'worker-a');
  assert.deepEqual(calls.slice(0, 2), ['begin', {
    sql: calls[1].sql,
    params: ['worker-a', 2, 'job-1'],
  }]);
  assert.match(calls[1].sql, /status='running'/);
  assert.deepEqual(calls.slice(-2), ['commit', 'release']);
});

test('failure uses the incremented attempt and moves an exhausted job to dead', async () => {
  let failureParams;
  const db = {
    async query(sql, params) {
      if (sql.includes('UPDATE job_queue')) failureParams = params;
      return [{ affectedRows: 1 }];
    },
  };

  const updated = await createJobQueue(db).fail('job-1', 'boom', 3, 3, 'worker-a');
  assert.equal(updated, true);
  assert.equal(failureParams[0], 'dead');
  assert.deepEqual(failureParams.slice(-2), ['job-1', 'worker-a']);
});
