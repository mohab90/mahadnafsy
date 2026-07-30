'use strict';

const crypto = require('crypto');
const { uuidv4 } = require('./id');

const OPEN_STATUSES = ['created', 'under_review'];
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');

function idempotencyHash({ tenantId, orderId, provider = 'manual', key }) {
  return hash(`${tenantId}:${provider}:${String(key || orderId).slice(0, 300)}`);
}

async function getOrCreatePaymentIntent(db, {
  tenantId, order, subscriberId, actor, provider = 'manual', idempotencyKey, requestedIntentId,
}) {
  if (provider !== 'manual') {
    const error = new Error('Online payment provider is disabled pending provider approval');
    error.status = 503;
    error.code = 'PAYMOB_DISABLED';
    throw error;
  }
  if (requestedIntentId) {
    const [[existing]] = await db.query(
      `SELECT * FROM payment_intents
        WHERE id=? AND tenant_id=? AND order_id=? AND subscriber_id=? AND provider='manual'
        LIMIT 1 FOR UPDATE`,
      [requestedIntentId, tenantId, order.id, subscriberId]
    );
    if (!existing) {
      const error = new Error('Payment intent does not match this order');
      error.status = 409;
      error.code = 'PAYMENT_INTENT_MISMATCH';
      throw error;
    }
    if (existing.status === 'paid' || existing.status === 'cancelled') {
      const error = new Error(`Payment intent is ${existing.status}`);
      error.status = 409;
      error.code = 'PAYMENT_INTENT_CLOSED';
      throw error;
    }
    if (existing.status === 'failed' || existing.status === 'expired') {
      await db.query(
        `UPDATE payment_intents
            SET status='created',failure_code=NULL,expires_at=DATE_ADD(NOW(),INTERVAL 48 HOUR)
          WHERE id=? AND tenant_id=?`,
        [existing.id, tenantId]
      );
      existing.status = 'created';
    }
    return existing;
  }

  const keyHash = idempotencyHash({ tenantId, orderId: order.id, provider, key: idempotencyKey });
  const [[byKey]] = await db.query(
    'SELECT * FROM payment_intents WHERE tenant_id=? AND idempotency_hash=? LIMIT 1 FOR UPDATE',
    [tenantId, keyHash]
  );
  if (byKey) return byKey;
  const [[active]] = await db.query(
    `SELECT * FROM payment_intents
      WHERE tenant_id=? AND order_id=? AND status IN ('created','under_review')
      LIMIT 1 FOR UPDATE`,
    [tenantId, order.id]
  );
  if (active) return active;

  const id = uuidv4();
  await db.query(
    `INSERT INTO payment_intents
       (id,tenant_id,order_id,subscriber_id,provider,amount,currency,status,
        idempotency_hash,expires_at,created_by)
     VALUES (?,?,?,?,?,?,?,'created',?,DATE_ADD(NOW(),INTERVAL 48 HOUR),?)`,
    [id, tenantId, order.id, subscriberId, provider, order.amount, order.currency, keyHash, actor]
  );
  return {
    id, tenant_id: tenantId, order_id: order.id, subscriber_id: subscriberId,
    provider, amount: order.amount, currency: order.currency, status: 'created',
  };
}

async function createPaymentAttempt(db, { tenantId, intentId, proofId, actor }) {
  const [[row]] = await db.query(
    'SELECT COALESCE(MAX(attempt_no),0)+1 AS next_no FROM payment_attempts WHERE tenant_id=? AND intent_id=?',
    [tenantId, intentId]
  );
  const id = uuidv4();
  await db.query(
    `INSERT INTO payment_attempts
       (id,tenant_id,intent_id,attempt_no,provider,status,proof_id,safe_reference,metadata_json)
     VALUES (?,?,?,?,'manual','proof_submitted',?,?,?)`,
    [id, tenantId, intentId, Number(row?.next_no || 1), proofId, proofId, JSON.stringify({ actor })]
  );
  await db.query(
    `UPDATE payment_intents
        SET status='under_review',failure_code=NULL,expires_at=DATE_ADD(NOW(),INTERVAL 48 HOUR)
      WHERE id=? AND tenant_id=? AND status IN ('created','failed','expired')`,
    [intentId, tenantId]
  );
  return id;
}

async function settlePaymentAttempt(db, {
  tenantId, intentId, attemptId, approved, paymentId = null, failureCode = null,
}) {
  const status = approved ? 'succeeded' : 'failed';
  await db.query(
    'UPDATE payment_attempts SET status=?,payment_id=?,error_code=? WHERE id=? AND intent_id=? AND tenant_id=?',
    [status, paymentId, failureCode, attemptId, intentId, tenantId]
  );
  await db.query(
    'UPDATE payment_intents SET status=?,payment_id=?,failure_code=? WHERE id=? AND tenant_id=?',
    [approved ? 'paid' : 'failed', paymentId, failureCode, intentId, tenantId]
  );
}

module.exports = {
  OPEN_STATUSES,
  createPaymentAttempt,
  getOrCreatePaymentIntent,
  idempotencyHash,
  settlePaymentAttempt,
};
