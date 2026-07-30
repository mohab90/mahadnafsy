'use strict';

const CERTIFICATE_TYPES = new Set([
  'SOCIAL_SOLIDARITY', 'AIN_SHAMS', 'EXPERIENCE_EXTERNAL', 'PRACTICE_EXTERNAL',
  'NATIONAL_COUNCIL', 'AMERICAN_BOARD', 'INSTITUTE', 'OTHER',
]);

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

async function applyCertificatePayment(payment, db, tenantId, options = {}) {
  const settle = options.settle !== false;
  const requestId = String(payment.certificate_request_id || '').trim();
  if (!requestId) return null;

  const [[request]] = await db.query(
    `SELECT id, subscriber_id, course_id, type, status, price, paid_amount, currency
     FROM certificate_requests
     WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
    [requestId, tenantId]
  );
  const amount = Number(payment.amount) || 0;
  const currency = String(payment.currency || 'EGP').toUpperCase();

  if (request) {
    if (String(request.subscriber_id || '') !== String(payment.subscriber_id || '')) {
      throw conflict('Certificate request belongs to another subscriber');
    }
    if (request.currency && String(request.currency).toUpperCase() !== currency) {
      throw conflict('Certificate request currency does not match payment currency');
    }
    if (!settle) return requestId;
    const previousPaid = Number(request.paid_amount) || 0;
    const price = Number(request.price) || 0;
    if (price > 0 && previousPaid >= price) throw conflict('Certificate request is already fully paid');
    const paidAmount = previousPaid + amount;
    await db.query(
      `UPDATE certificate_requests
       SET paid_amount=?, currency=COALESCE(currency,?),
           status=CASE WHEN price IS NULL OR price<=? THEN 'PAID' ELSE 'PRICED' END
       WHERE id=? AND tenant_id=?`,
      [paidAmount, currency, paidAmount, requestId, tenantId]
    );
  } else {
    const requestedType = String(payment.cert_type || '').toUpperCase();
    if (!CERTIFICATE_TYPES.has(requestedType)) {
      throw conflict('Certificate type is required for a new certificate request');
    }
    await db.query(
      `INSERT INTO certificate_requests
         (id, subscriber_id, course_id, type, status, price, paid_amount, currency, note, tenant_id, requested_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        requestId, payment.subscriber_id, payment.course_id || null, requestedType,
        settle ? 'PAID' : 'PRICED', amount, settle ? amount : 0, currency,
        payment.note || null, tenantId,
        String(payment.date || new Date().toISOString()).slice(0, 10),
      ]
    );
  }

  return requestId;
}

module.exports = { applyCertificatePayment };
