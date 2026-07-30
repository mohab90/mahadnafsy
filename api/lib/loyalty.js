'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');
const logger = require('./logger').child({ lib: 'loyalty' });

function normalizePoints(points) {
  const n = Number(points);
  if (!Number.isInteger(n) || n <= 0) {
    const err = new Error('points must be a positive integer');
    err.statusCode = 400;
    throw err;
  }
  return n;
}

function requireTenantId(tenantId) {
  const value = String(tenantId || '').trim();
  if (!value) {
    const err = new Error('tenant id is required');
    err.statusCode = 400;
    throw err;
  }
  return value;
}

async function getBalance(tenantId, subscriberId) {
  const scopedTenantId = requireTenantId(tenantId);
  const [[row]] = await pool.query(
    `SELECT id, loyalty_points
     FROM subscribers
     WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [subscriberId, scopedTenantId]
  );
  if (!row) {
    const err = new Error('subscriber not found');
    err.statusCode = 404;
    throw err;
  }
  return Number(row.loyalty_points || 0);
}

async function addLedger(conn, data) {
  await conn.query(
    `INSERT INTO loyalty_ledger
       (id, tenant_id, subscriber_id, points, balance_after, reason, reference_type, reference_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      data.tenantId || null,
      data.subscriberId,
      data.points,
      data.balanceAfter,
      data.reason || 'manual',
      data.referenceType || null,
      data.referenceId || null,
      data.createdBy || null,
    ]
  );
}

async function awardPoints(tenantId, subscriberId, points, options = {}) {
  const scopedTenantId = requireTenantId(tenantId);
  const amount = normalizePoints(points);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[subscriber]] = await conn.query(
      `SELECT id, tenant_id, loyalty_points
       FROM subscribers
       WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
       FOR UPDATE`,
      [subscriberId, scopedTenantId]
    );
    if (!subscriber) {
      const err = new Error('subscriber not found');
      err.statusCode = 404;
      throw err;
    }

    const balanceAfter = Number(subscriber.loyalty_points || 0) + amount;
    await conn.query(
      'UPDATE subscribers SET loyalty_points = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
      [balanceAfter, subscriberId, scopedTenantId]
    );
    await addLedger(conn, {
      ...options,
      tenantId: scopedTenantId,
      subscriberId,
      points: amount,
      balanceAfter,
    });
    await conn.commit();
    return { subscriberId, points: amount, balance: balanceAfter };
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.warn('awardPoints failed', { subscriberId, error: error.message });
    throw error;
  } finally {
    conn.release();
  }
}

async function redeemPoints(tenantId, subscriberId, points, options = {}) {
  const scopedTenantId = requireTenantId(tenantId);
  const amount = normalizePoints(points);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[subscriber]] = await conn.query(
      `SELECT id, tenant_id, loyalty_points
       FROM subscribers
       WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
       FOR UPDATE`,
      [subscriberId, scopedTenantId]
    );
    if (!subscriber) {
      const err = new Error('subscriber not found');
      err.statusCode = 404;
      throw err;
    }

    const current = Number(subscriber.loyalty_points || 0);
    if (current < amount) {
      const err = new Error('insufficient loyalty points');
      err.statusCode = 409;
      throw err;
    }

    const balanceAfter = current - amount;
    await conn.query(
      'UPDATE subscribers SET loyalty_points = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
      [balanceAfter, subscriberId, scopedTenantId]
    );
    await addLedger(conn, {
      ...options,
      tenantId: scopedTenantId,
      subscriberId,
      points: -amount,
      balanceAfter,
    });
    await conn.commit();
    return { subscriberId, points: -amount, balance: balanceAfter };
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.warn('redeemPoints failed', { subscriberId, error: error.message });
    throw error;
  } finally {
    conn.release();
  }
}

async function listLedger(tenantId, subscriberId, limit = 100) {
  const scopedTenantId = requireTenantId(tenantId);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 300);
  const [rows] = await pool.query(
    `SELECT id, points, balance_after, reason, reference_type, reference_id, created_by, created_at
     FROM loyalty_ledger
     WHERE subscriber_id = ? AND tenant_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [subscriberId, scopedTenantId, safeLimit]
  );
  return rows;
}

function pointsForAmount(amount) {
  const egpPerPoint = Math.max(parseInt(process.env.LOYALTY_EGP_PER_POINT || '100', 10) || 100, 1);
  return Math.floor((Number(amount) || 0) / egpPerPoint);
}

async function awardPointsForPayment(payment) {
  if (!payment?.subscriberId && !payment?.subscriber_id) return { skipped: true, reason: 'missing subscriber' };
  const subscriberId = payment.subscriberId || payment.subscriber_id;
  const referenceId = payment.paymentId || payment.id;
  if (!referenceId) return { skipped: true, reason: 'missing payment id' };

  const points = pointsForAmount(payment.amount);
  if (points <= 0) return { skipped: true, reason: 'amount below threshold' };

  try {
    let tenantId = payment.tenantId || payment.tenant_id || null;
    if (!tenantId) {
      // Compatibility for trusted payment producers that predate tenant-aware
      // loyalty calls. Subscriber ids are global primary keys.
      const [[subscriber]] = await pool.query(
        'SELECT tenant_id FROM subscribers WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [subscriberId]
      );
      tenantId = subscriber?.tenant_id || null;
    }
    return await awardPoints(tenantId, subscriberId, points, {
      reason: payment.reason || 'paid_payment',
      referenceType: 'payment',
      referenceId,
      createdBy: payment.createdBy || 'system',
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return { skipped: true, reason: 'already awarded' };
    }
    throw error;
  }
}

module.exports = {
  awardPoints,
  awardPointsForPayment,
  redeemPoints,
  getBalance,
  listLedger,
};
