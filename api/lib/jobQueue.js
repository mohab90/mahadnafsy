'use strict';
/**
 * Durable DB-backed job queue (Top20 #8). Replaces fire-and-forget setInterval
 * work with claimable, retryable jobs that survive restarts and give visibility.
 * Single-process safe via an optimistic claim (UPDATE ... WHERE status='pending').
 */
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const logger = require('./logger');

async function enqueue(jobType, payload, { runAt = null, tenantId = 'mahad', maxAttempts = 5 } = {}) {
  const id = uuidv4();
  await pool.query(
    `INSERT INTO job_queue (id, tenant_id, job_type, payload_json, max_attempts, run_at)
     VALUES (?,?,?,?,?, COALESCE(?, NOW()))`,
    [id, tenantId, jobType, JSON.stringify(payload || {}), maxAttempts, runAt]
  );
  return id;
}

// Atomically claim the next due job (optimistic lock). Returns the row or null.
async function claim(workerId) {
  const [[job]] = await pool.query(
    "SELECT * FROM job_queue WHERE status='pending' AND run_at<=NOW() ORDER BY run_at LIMIT 1"
  );
  if (!job) return null;
  const [r] = await pool.query(
    "UPDATE job_queue SET status='running', locked_at=NOW(), locked_by=?, attempts=attempts+1 WHERE id=? AND status='pending'",
    [workerId, job.id]
  );
  return r.affectedRows === 1 ? job : null; // lost the race → skip
}

async function complete(id) {
  await pool.query("UPDATE job_queue SET status='done', done_at=NOW() WHERE id=?", [id]);
}

async function fail(id, err, attempts, maxAttempts) {
  const dead = attempts >= maxAttempts;
  await pool.query(
    "UPDATE job_queue SET status=?, last_error=?, run_at=DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id=?",
    [dead ? 'dead' : 'pending', String(err).slice(0, 1000), Math.min(60, 2 ** attempts), id]
  );
}

// Drain up to `max` jobs using a handler map { jobType: async (payload) => {} }.
async function processBatch(handlers, workerId = 'worker', max = 10) {
  let done = 0;
  for (let i = 0; i < max; i++) {
    const job = await claim(workerId);
    if (!job) break;
    try {
      const h = handlers[job.job_type];
      if (typeof h !== 'function') throw new Error('no handler for ' + job.job_type);
      const payload = typeof job.payload_json === 'string' ? JSON.parse(job.payload_json) : (job.payload_json || {});
      await h(payload);
      await complete(job.id);
      done++;
    } catch (e) {
      await fail(job.id, e.message, job.attempts, job.max_attempts);
      logger.warn('[jobQueue] job failed', { type: job.job_type, err: e.message });
    }
  }
  return done;
}

module.exports = { enqueue, claim, complete, fail, processBatch };
