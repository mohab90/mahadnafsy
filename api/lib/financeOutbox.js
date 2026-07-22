'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');
const logger = require('./logger').child({ lib: 'financeOutbox' });

const MAX_ATTEMPTS = 6;

async function enqueueFinanceEvent({ tenantId, eventType, refType = null, refId = null, payload = {}, dedupeKey = null }, db = pool) {
  if (!tenantId || !eventType) throw new Error('tenantId and eventType are required');
  const key = dedupeKey || (refId ? `${eventType}:${refType || 'ref'}:${refId}` : null);
  await db.query(
    `INSERT INTO finance_outbox
       (id,tenant_id,event_type,ref_type,ref_id,dedupe_key,payload_json,status,attempts,next_attempt_at)
     VALUES (?,?,?,?,?,?,?,'pending',0,NOW())
     ON DUPLICATE KEY UPDATE id=id`,
    [uuidv4(), tenantId, eventType, refType, refId, key, JSON.stringify(payload || {})]
  );
}

async function drainFinanceOutbox(handlers, limit = 20) {
  const workerId = `finance-${process.pid}-${uuidv4()}`;
  const batchSize = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const conn = await pool.getConnection();
  let rows = [];
  try {
    await conn.beginTransaction();
    [rows] = await conn.query(
      `SELECT * FROM finance_outbox
        WHERE ((status IN ('pending','failed') AND COALESCE(next_attempt_at,NOW())<=NOW())
           OR (status='processing' AND locked_at<DATE_SUB(NOW(),INTERVAL 15 MINUTE)))
        ORDER BY created_at ASC LIMIT ? FOR UPDATE`,
      [batchSize]
    );
    if (rows.length) {
      await conn.query(
        `UPDATE finance_outbox SET status='processing',locked_at=NOW(),locked_by=?,updated_at=NOW()
          WHERE id IN (${rows.map(() => '?').join(',')})`,
        [workerId, ...rows.map(row => row.id)]
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
  let processed = 0;
  for (const row of rows) {
    try {
      const handler = handlers[row.event_type];
      if (typeof handler !== 'function') throw new Error(`No handler for ${row.event_type}`);
      const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json || '{}') : (row.payload_json || {});
      await handler({ ...row, payload });
      await pool.query(
        "UPDATE finance_outbox SET status='processed',error_message=NULL,locked_at=NULL,locked_by=NULL,updated_at=NOW() WHERE id=? AND tenant_id=? AND locked_by=?",
        [row.id, row.tenant_id, workerId]
      );
      processed++;
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      const backoffMinutes = Math.min(24 * 60, 2 ** attempts);
      await pool.query(
        `UPDATE finance_outbox SET status=?,attempts=?,error_message=?,
           next_attempt_at=DATE_ADD(NOW(),INTERVAL ? MINUTE),locked_at=NULL,locked_by=NULL,updated_at=NOW()
         WHERE id=? AND tenant_id=? AND locked_by=?`,
        [dead ? 'dead' : 'failed', attempts, String(error.message || error).slice(0, 2000), backoffMinutes, row.id, row.tenant_id, workerId]
      );
      logger.warn('event processing failed', { id: row.id, tenantId: row.tenant_id, eventType: row.event_type, attempts });
    }
  }
  return processed;
}

async function retryFinanceEvent(id, tenantId) {
  const [result] = await pool.query(
    `UPDATE finance_outbox SET status='pending',attempts=0,error_message=NULL,next_attempt_at=NOW(),locked_at=NULL,locked_by=NULL,updated_at=NOW()
      WHERE id=? AND tenant_id=? AND status IN ('failed','dead')`,
    [id, tenantId]
  );
  return result.affectedRows > 0;
}

module.exports = { MAX_ATTEMPTS, enqueueFinanceEvent, drainFinanceOutbox, retryFinanceEvent };
