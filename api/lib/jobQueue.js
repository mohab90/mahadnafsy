'use strict';

/** Durable MySQL queue with multi-worker claims, retries and stale-lock recovery. */
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const logger = require('./logger');

function recurringDedupeKey(jobType, periodMs, now = Date.now()) {
  return `${jobType}:${Math.floor(now / periodMs)}`;
}

function createJobQueue(db = pool) {
  async function enqueue(jobType, payload, {
    runAt = null,
    tenantId = 'mahad',
    maxAttempts = 5,
    dedupeKey = null,
  } = {}) {
    const id = uuidv4();
    const key = dedupeKey == null ? null : String(dedupeKey).slice(0, 160);
    try {
      await db.query(
        `INSERT INTO job_queue
           (id, tenant_id, job_type, payload_json, max_attempts, run_at, dedupe_key)
         VALUES (?,?,?,?,?, COALESCE(?, NOW()), ?)`,
        [id, tenantId, jobType, JSON.stringify(payload || {}), maxAttempts, runAt, key]
      );
      return id;
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY' || !key) throw error;
      const [[existing]] = await db.query(
        'SELECT id FROM job_queue WHERE tenant_id=? AND job_type=? AND dedupe_key=? LIMIT 1',
        [tenantId, jobType, key]
      );
      if (!existing?.id) throw error;
      return existing.id;
    }
  }

  async function claim(workerId, { jobId = null } = {}) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[job]] = await conn.query(
        `SELECT * FROM job_queue
          WHERE status='pending' AND run_at<=NOW()
            ${jobId ? 'AND id=?' : ''}
          ORDER BY run_at, created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        jobId ? [jobId] : []
      );
      if (!job) {
        await conn.commit();
        return null;
      }
      const attempts = Number(job.attempts || 0) + 1;
      const [result] = await conn.query(
        `UPDATE job_queue
            SET status='running', locked_at=NOW(), locked_by=?, attempts=?
          WHERE id=? AND status='pending'`,
        [workerId, attempts, job.id]
      );
      if (result.affectedRows !== 1) throw new Error(`job claim failed: ${job.id}`);
      await conn.commit();
      return { ...job, attempts, locked_by: workerId };
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    } finally {
      conn.release();
    }
  }

  async function complete(id, workerId) {
    const params = [id];
    const ownerClause = workerId ? ' AND locked_by=?' : '';
    if (workerId) params.push(workerId);
    const [result] = await db.query(
      `UPDATE job_queue
          SET status='done', done_at=NOW(), locked_at=NULL, locked_by=NULL
        WHERE id=? AND status='running'${ownerClause}`,
      params
    );
    return result.affectedRows === 1;
  }

  async function fail(id, err, attempts, maxAttempts, workerId) {
    const dead = Number(attempts) >= Number(maxAttempts);
    const params = [
      dead ? 'dead' : 'pending',
      String(err).slice(0, 1000),
      Math.min(60, 2 ** Number(attempts || 1)),
      id,
    ];
    const ownerClause = workerId ? ' AND locked_by=?' : '';
    if (workerId) params.push(workerId);
    const [result] = await db.query(
      `UPDATE job_queue
          SET status=?, last_error=?, run_at=DATE_ADD(NOW(), INTERVAL ? MINUTE),
              locked_at=NULL, locked_by=NULL
        WHERE id=? AND status='running'${ownerClause}`,
      params
    );
    return result.affectedRows === 1;
  }

  async function requeueStale(lockTimeoutSeconds = Number(process.env.JOB_LOCK_TIMEOUT_SECONDS || 900)) {
    const [result] = await db.query(
      `UPDATE job_queue
          SET status='pending', locked_at=NULL, locked_by=NULL, run_at=NOW(),
              last_error=CONCAT('Recovered stale worker lock at ', NOW())
        WHERE status='running'
          AND locked_at < DATE_SUB(NOW(), INTERVAL ? SECOND)`,
      [lockTimeoutSeconds]
    );
    return result.affectedRows;
  }

  async function healthSnapshot(lockTimeoutSeconds = Number(process.env.JOB_LOCK_TIMEOUT_SECONDS || 900)) {
    const [[row]] = await db.query(
      `SELECT
         SUM(status='pending') pending,
         SUM(status='running') running,
         SUM(status='done') done,
         SUM(status='dead') dead,
         SUM(status='running' AND locked_at < DATE_SUB(NOW(), INTERVAL ? SECOND)) stale
       FROM job_queue`,
      [lockTimeoutSeconds]
    );
    return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, Number(value || 0)]));
  }

  async function processBatch(handlers, workerId = 'worker', max = 10) {
    await requeueStale();
    let done = 0;
    for (let i = 0; i < max; i++) {
      const job = await claim(workerId);
      if (!job) break;
      try {
        const handler = handlers[job.job_type];
        if (typeof handler !== 'function') throw new Error(`no handler for ${job.job_type}`);
        const payload = typeof job.payload_json === 'string'
          ? JSON.parse(job.payload_json)
          : (job.payload_json || {});
        await handler(payload);
        if (!await complete(job.id, workerId)) throw new Error(`job ownership lost: ${job.id}`);
        done += 1;
      } catch (error) {
        await fail(job.id, error.message, job.attempts, job.max_attempts, workerId);
        logger.warn('[jobQueue] job failed', { type: job.job_type, err: error.message });
      }
    }
    return done;
  }

  return { claim, complete, enqueue, fail, healthSnapshot, processBatch, requeueStale };
}

module.exports = { ...createJobQueue(pool), createJobQueue, recurringDedupeKey };
