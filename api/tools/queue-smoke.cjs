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
  const [claimed] = await pool.query(
    "UPDATE job_queue SET status='running', locked_at=NOW(), locked_by=?, attempts=attempts+1 WHERE id=? AND status='pending'",
    [workerId, id]
  );
  if (claimed.affectedRows !== 1) throw new Error('could not claim smoke job');
  await jobQueue.complete(id);
  const [[row]] = await pool.query('SELECT id, status, attempts, last_error FROM job_queue WHERE id=? LIMIT 1', [id]);
  const failedId = await jobQueue.enqueue('uat_expected_failure', { at: new Date().toISOString() }, {
    tenantId: process.env.DEFAULT_TENANT_ID || 'tenant-default',
    maxAttempts: 2,
  });
  await pool.query(
    "UPDATE job_queue SET status='running', locked_at=NOW(), locked_by=?, attempts=1 WHERE id=? AND status='pending'",
    [workerId, failedId]
  );
  await jobQueue.fail(failedId, 'queue smoke expected failure', 1, 2);
  const [[failedRow]] = await pool.query('SELECT id, status, attempts, last_error FROM job_queue WHERE id=? LIMIT 1', [failedId]);
  const ok = row?.status === 'done' && row?.attempts >= 1 && failedRow?.status === 'pending' && /expected failure/.test(failedRow?.last_error || '');
  console.log(JSON.stringify({ ok, id, row, failedRow }, null, 2));
  await pool.end();
  if (!ok) process.exit(1);
})().catch(async (error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
