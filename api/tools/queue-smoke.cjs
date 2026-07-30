#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { pool } = require('../lib/db');
const jobQueue = require('../lib/jobQueue');

(async () => {
  const id = await jobQueue.enqueue('uat_noop', { at: new Date().toISOString() }, {
    tenantId: process.env.DEFAULT_TENANT_ID || 'tenant-default',
    maxAttempts: 2,
  });
  const workerId = `queue-smoke-${process.pid}`;
  const claimed = await jobQueue.claim(workerId, { jobId: id });
  if (claimed?.id !== id || claimed.attempts !== 1) throw new Error('could not claim smoke job');
  if (!await jobQueue.complete(id, workerId)) throw new Error('could not complete owned smoke job');
  const [[row]] = await pool.query('SELECT id, status, attempts, last_error FROM job_queue WHERE id=? LIMIT 1', [id]);
  const failedId = await jobQueue.enqueue('uat_expected_failure', { at: new Date().toISOString() }, {
    tenantId: process.env.DEFAULT_TENANT_ID || 'tenant-default',
    maxAttempts: 2,
  });
  const failedClaim = await jobQueue.claim(workerId, { jobId: failedId });
  if (failedClaim?.id !== failedId) throw new Error('could not claim expected-failure job');
  await jobQueue.fail(failedId, 'queue smoke expected failure', failedClaim.attempts, failedClaim.max_attempts, workerId);
  const [[failedRow]] = await pool.query('SELECT id, status, attempts, last_error FROM job_queue WHERE id=? LIMIT 1', [failedId]);
  const failoverId = await jobQueue.enqueue('uat_worker_failover', { at: new Date().toISOString() }, {
    tenantId: process.env.DEFAULT_TENANT_ID || 'tenant-default',
    maxAttempts: 3,
  });
  const abandoned = await jobQueue.claim('queue-smoke-dead-worker', { jobId: failoverId });
  if (abandoned?.id !== failoverId) throw new Error('could not claim failover job');
  await pool.query(
    "UPDATE job_queue SET locked_at=DATE_SUB(NOW(), INTERVAL 10 SECOND) WHERE id=? AND status='running'",
    [failoverId]
  );
  const recoveredCount = await jobQueue.requeueStale(1);
  const recovered = await jobQueue.claim('queue-smoke-survivor', { jobId: failoverId });
  if (recovered?.id !== failoverId || recovered.attempts !== 2) {
    throw new Error('survivor could not reclaim abandoned job');
  }
  if (!await jobQueue.complete(failoverId, 'queue-smoke-survivor')) {
    throw new Error('survivor could not complete recovered job');
  }
  const [[failoverRow]] = await pool.query(
    'SELECT id, status, attempts, locked_by, last_error FROM job_queue WHERE id=? LIMIT 1',
    [failoverId]
  );
  const ok = row?.status === 'done'
    && row?.attempts >= 1
    && failedRow?.status === 'pending'
    && /expected failure/.test(failedRow?.last_error || '')
    && recoveredCount >= 1
    && failoverRow?.status === 'done'
    && failoverRow?.attempts === 2
    && !failoverRow?.locked_by
    && /Recovered stale worker lock/.test(failoverRow?.last_error || '');
  console.log(JSON.stringify({ ok, id, row, failedRow, failoverRow, recoveredCount }, null, 2));
  await pool.end();
  if (!ok) process.exit(1);
})().catch(async (error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
