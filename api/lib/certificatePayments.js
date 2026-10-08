'use strict';

const { getTenantSetting } = require('./tenantSettings');
const { basePriceForCurrency, certificateTypeCodes } = require('./certificatePricing');

// What a certificate costs: the figure the desk typed (the dialog fills in the
// price list's), else the price list's own — never the payment. A request
// opened by a payment took the amount paid as its price: «لما بندخل ان العميل
// دفع 500 من سعر الشهاده بيسجل ان الشهاده كلها ب500», so it read fully paid.
async function certificatePricing(db, tenantId) {
  const content = await getTenantSetting('content', { tenantId, fallback: {}, db }).catch(() => ({}));
  try { return JSON.parse(content?.extra_cert_pricing || '{}') || {}; } catch { return {}; }
}

async function certificatePrice(db, tenantId, { stated, type, currency }) {
  if (Number(stated) > 0) return Number(stated);
  return basePriceForCurrency(await certificatePricing(db, tenantId), type, currency) || null;
}

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
    // A request still without a price takes the certificate's, not "whatever
    // was paid is the price".
    const price = Number(request.price) > 0 ? Number(request.price)
      : await certificatePrice(db, tenantId, { stated: payment.price, type: request.type, currency });
    if (price > 0 && previousPaid >= price) throw conflict('Certificate request is already fully paid');
    const paidAmount = previousPaid + amount;
    await db.query(
      `UPDATE certificate_requests
       SET paid_amount=?, currency=COALESCE(currency,?), price=?,
           status=CASE WHEN ? IS NULL OR ?<=? THEN 'PAID' ELSE 'PRICED' END
       WHERE id=? AND tenant_id=?`,
      [paidAmount, currency, price || null, price || null, price || 0, paidAmount, requestId, tenantId]
    );
  } else {
    // The eight built-in types and every one «تسعير الشهادات» lists (014, 015…):
    // only the eight were accepted, so a certificate of any newer type the desk
    // picked was refused — 17 times on 5–7 Oct.
    const requestedType = String(payment.cert_type || '').toUpperCase();
    if (!certificateTypeCodes(await certificatePricing(db, tenantId)).has(requestedType)) {
      throw conflict('اختار نوع الشهادة قبل تسجيل دفعها');
    }
    const price = await certificatePrice(db, tenantId, { stated: payment.price, type: requestedType, currency }) || amount;
    const [[client]] = await db.query('SELECT name FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [payment.subscriber_id, tenantId]).catch(() => [[]]);
    await db.query(
      `INSERT INTO certificate_requests
         (id, subscriber_id, course_id, type, status, price, paid_amount, currency, note, tenant_id, requested_at, name_ar)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        requestId, payment.subscriber_id, payment.course_id || null, requestedType,
        settle && amount >= price ? 'PAID' : 'PRICED', price, settle ? amount : 0, currency,
        payment.note || null, tenantId,
        String(payment.date || new Date().toISOString()).slice(0, 10),
        certificateNameOf(client?.name),
      ]
    );
  }

  return requestId;
}

/** «خلي اسم العميل مدام ثلاثي او اكثر يكون هو الاسم علي الشهاده» (8 Oct 2026). */
function certificateNameOf(clientName) {
  const name = String(clientName || '').trim().replace(/\s+/g, ' ');
  return name.split(' ').filter(Boolean).length >= 3 ? name : null;
}

module.exports = { applyCertificatePayment, certificateNameOf, certificatePrice };
