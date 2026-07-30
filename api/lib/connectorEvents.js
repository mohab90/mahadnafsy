'use strict';

const crypto = require('node:crypto');
const { pool } = require('./db');

const MAX_ATTEMPTS = 8;
const clamp = (value, max = 100) => Math.min(Math.max(Number(value) || 20, 1), max);

async function enqueueConnectorEvent({
  tenantId, provider, externalEventId, payload,
}, db = pool) {
  if (!tenantId || !provider || !externalEventId) {
    throw Object.assign(new Error('Connector event identity is required'), { statusCode: 400 });
  }
  const id = crypto.randomUUID();
  const [result] = await db.query(
    `INSERT IGNORE INTO connector_events
       (id,tenant_id,provider,external_event_id,payload_json,status,next_attempt_at)
     VALUES (?,?,?,?,?,'pending',NOW())`,
    [id, tenantId, String(provider).slice(0, 40), String(externalEventId).slice(0, 191), JSON.stringify(payload || {})]
  );
  if (!result.affectedRows) {
    const [[existing]] = await db.query(
      'SELECT id,status FROM connector_events WHERE tenant_id=? AND provider=? AND external_event_id=? LIMIT 1',
      [tenantId, provider, externalEventId]
    );
    return { id: existing.id, duplicate: true, status: existing.status };
  }
  return { id, duplicate: false, status: 'pending' };
}

async function claimEvents(db, workerId, limit) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM connector_events
        WHERE (status IN ('pending','failed') AND next_attempt_at<=NOW())
           OR (status='processing' AND locked_at<DATE_SUB(NOW(),INTERVAL 10 MINUTE))
        ORDER BY next_attempt_at,received_at LIMIT ? FOR UPDATE`,
      [clamp(limit)]
    );
    if (rows.length) {
      await conn.query(
        `UPDATE connector_events SET status='processing',locked_at=NOW(),locked_by=?
          WHERE id IN (${rows.map(() => '?').join(',')})`,
        [workerId, ...rows.map(row => row.id)]
      );
    }
    await conn.commit();
    return rows;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

async function drainConnectorEvents(handlers, { db = pool, limit = 20 } = {}) {
  const workerId = `connector-${process.pid}-${crypto.randomUUID()}`;
  const rows = await claimEvents(db, workerId, limit);
  let processed = 0;
  for (const row of rows) {
    try {
      const handler = handlers[row.provider];
      if (typeof handler !== 'function') throw new Error(`No connector handler for ${row.provider}`);
      const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
      await handler({ event: row, payload });
      await db.query(
        `UPDATE connector_events
            SET status='processed',processed_at=NOW(),locked_at=NULL,locked_by=NULL,last_error=NULL
          WHERE id=? AND tenant_id=? AND locked_by=?`,
        [row.id, row.tenant_id, workerId]
      );
      processed += 1;
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      await db.query(
        `UPDATE connector_events
            SET status=?,attempts=?,last_error=?,locked_at=NULL,locked_by=NULL,
                next_attempt_at=DATE_ADD(NOW(),INTERVAL ? MINUTE)
          WHERE id=? AND tenant_id=? AND locked_by=?`,
        [
          dead ? 'dead' : 'failed', attempts, String(error.message || error).slice(0, 2000),
          Math.min(2 ** attempts, 360), row.id, row.tenant_id, workerId,
        ]
      );
    }
  }
  return { claimed: rows.length, processed };
}

module.exports = { MAX_ATTEMPTS, enqueueConnectorEvent, claimEvents, drainConnectorEvents };
