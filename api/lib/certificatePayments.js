'use strict';

const { getTenantSetting } = require('./tenantSettings');
const { cairoDayOf, cairoToday } = require('./dates');
const { basePriceForCurrency, certificateDue, certificateTypeCodes } = require('./certificatePricing');
const { certificateKey, certificatePrices, setItemMoney } = require('./itemMoney');
const { logClientEvent } = require('./clientHistory');
const { withFreshCode } = require('./certificateCodes');

// What a certificate costs: the figure the desk typed (the dialog fills in the
// price list's), else the price list's own — never the payment. A request
// opened by a payment took the amount paid as its price: «لما بندخل ان العميل
// دفع 500 من سعر الشهاده بيسجل ان الشهاده كلها ب500», so it read fully paid.
async function certificatePricing(db, tenantId) {
  const content = await getTenantSetting('content', { tenantId, fallback: {}, db }).catch(() => ({}));
  try { return JSON.parse(content?.extra_cert_pricing || '{}') || {}; } catch { return {}; }
}

async function certificatePrice(db, tenantId, { stated, type, currency, nationality }) {
  if (Number(stated) > 0) return Number(stated);
  return basePriceForCurrency(await certificatePricing(db, tenantId), type, currency, nationality) || null;
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
    `SELECT id, subscriber_id, course_id, type, status, price, paid_amount, currency, nationality
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
    // The price agreed for this client's certificate, else the price list's, else the request's own; a request still without one takes the
    // certificate's, not "whatever was paid is the price".
    const agreed = await certificatePrices(db, { tenantId, subscriberIds: [request.subscriber_id] });
    const price = certificateDue(await certificatePricing(db, tenantId), { ...request, currency }, agreed.get(requestId))
      || await certificatePrice(db, tenantId, { stated: payment.price, type: request.type, currency, nationality: request.nationality });
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
    // Never «whatever was paid is the price» for an INSTALMENT (8 Oct 2026): with no stated price and none on the
    // price list, a part payment leaves the request without a price, and it is not «PAID» until the desk gives
    // it one. A payment not marked as an instalment is the whole of it, and is its price.
    const isInstallment = Boolean(Number(payment.is_installment) || payment.isInstallment === true);
    // The client's own nationality prices it and is kept on the request, so the price list is read the same way afterwards.
    const [[client]] = await db.query('SELECT name, nationality FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [payment.subscriber_id, tenantId]).catch(() => [[]]);
    const nationality = client?.nationality || null;
    const price = await certificatePrice(db, tenantId, { stated: payment.price, type: requestedType, currency, nationality }) || (isInstallment ? null : amount);
    await withFreshCode(code => db.query(
      `INSERT INTO certificate_requests
         (id, certificate_code, subscriber_id, course_id, type, status, price, paid_amount, currency, note, tenant_id, requested_at, name_ar, nationality)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        requestId, code, payment.subscriber_id, payment.course_id || null, requestedType,
        settle && price > 0 && amount >= price ? 'PAID' : 'PRICED', price || null, settle ? amount : 0, currency,
        payment.note || null, tenantId,
        // payment.date is a DATETIME — a Date — when the payment comes from its
        // row, and String(Date).slice(0, 10) is «Mon Oct 12», not a date.
        cairoDayOf(payment.date) || cairoToday(),
        certificateNameOf(client?.name),
        nationality,
      ]
    ));
  }

  return requestId;
}

/**
 * The ONE writer of a certificate's price (7 Nov 2026: «عدّلت سعر شهادة العميل وشباك الدفع ما أخدهاش»). `own` — the default — is a price agreed for this client's
 * certificate: it wins over the price list everywhere the certificate is priced (certificateDue) and is kept in client_item_money like a course's. `own: false` is the
 * price list's figure stored on the request, with any agreed price dropped. The request's own column and the expected price on its payments follow, and the change
 * — who, old price, new price — goes into the client's history. Run inside the caller's transaction.
 */
async function setCertificatePrice(db, { tenantId, requestId, price, own = true, actor = null }) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) throw Object.assign(new Error('السعر لازم يكون رقم أكبر من صفر'), { statusCode: 400 });
  const [[request]] = await db.query(
    'SELECT id, subscriber_id, type, price, currency, nationality FROM certificate_requests WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE', [requestId, tenantId]);
  if (!request) throw Object.assign(new Error('طلب الشهادة مش موجود'), { statusCode: 404 });
  const agreed = request.subscriber_id ? await certificatePrices(db, { tenantId, subscriberIds: [request.subscriber_id] }) : new Map();
  const was = certificateDue(await certificatePricing(db, tenantId), request, agreed.get(String(request.id)));
  await db.query('UPDATE certificate_requests SET price=? WHERE id=? AND tenant_id=?', [value, request.id, tenantId]);
  await db.query('UPDATE payments SET course_expected=? WHERE certificate_request_id=? AND tenant_id=? AND deleted_at IS NULL', [value, request.id, tenantId]);
  if (request.subscriber_id) {
    await setItemMoney(db, { tenantId, subscriberId: request.subscriber_id, itemKey: certificateKey(request.id), price: own ? value : 0 });
    if (was !== value) {
      await logClientEvent(db, {
        tenantId, subscriberId: request.subscriber_id, action: 'price_changed', actor,
        label: `سعر الشهادة ${request.type}: ${was.toLocaleString('en-US')} ← ${value.toLocaleString('en-US')} ${request.currency || 'EGP'}${own ? '' : ' (سعر القائمة)'}`,
      });
    }
  }
  return { was, now: value };
}

/**
 * The price a certificate payment is recorded against. The server's: the one agreed for this client's certificate, else the price list's, else the request's own.
 * A figure the screen sent that differs from it is a price change: recorded only by an account that may set a client's price (`canSetPrice`), refused with 409 for
 * anyone else — never taken silently. Returns { price, own, existing } — `own` when the sent figure is a change the caller must write with setCertificatePrice.
 */
async function decideCertificatePrice(db, tenantId, { requestId = null, type, currency, nationality = null, stated = null, canSetPrice = false }) {
  const pricing = await certificatePricing(db, tenantId);
  let request = null;
  if (requestId) {
    [[request]] = await db.query(
      'SELECT id, subscriber_id, type, price, currency, nationality FROM certificate_requests WHERE id=? AND tenant_id=? LIMIT 1', [requestId, tenantId]);
  }
  const agreed = request ? await certificatePrices(db, { tenantId, subscriberIds: [request.subscriber_id] }) : new Map();
  const shape = request ? { ...request, currency } : { type, currency, nationality, price: null };
  const server = certificateDue(pricing, shape, request ? agreed.get(String(request.id)) : 0);
  const sent = Number(stated) > 0 ? Number(stated) : 0;
  const existing = Boolean(request);
  if (!sent || Math.abs(sent - server) < 0.005) return { price: server || null, own: false, existing };
  if (!server) return { price: sent, own: false, existing };
  if (!canSetPrice) {
    throw Object.assign(new Error('سعر الشهادة اتغير، افتح من جديد'), { statusCode: 409, code: 'PRICE_CHANGED', price: server });
  }
  return { price: sent, own: true, existing };
}

/** «خلي اسم العميل مدام ثلاثي او اكثر يكون هو الاسم علي الشهاده» (8 Oct 2026). */
function certificateNameOf(clientName) {
  const name = String(clientName || '').trim().replace(/\s+/g, ' ');
  return name.split(' ').filter(Boolean).length >= 3 ? name : null;
}

/**
 * What a certificate request costs and what was paid on it, from the payments themselves.
 *
 * «بعض الشهادات مكتوب سعرها غلط في جدول عملاء الاونلاين … محتاجة مراجعة دقيقة جدا» (15 Oct 2026). The
 * request's paid_amount was only ever added to: voiding a certificate payment left it standing, and
 * correcting one (a new payment recorded, the old one voided) counted the money twice. So the paid and
 * the remaining on a client's row could be wrong in either direction. This reads the payments that are
 * still there. A request with no payment row at all — the ones imported «مدفوعة» from the Dokki sheet —
 * keeps what it was imported with.
 */
async function syncCertificateRequest(db, tenantId, requestId) {
  const id = String(requestId || '').trim();
  if (!id) return null;
  const [[request]] = await db.query(
    'SELECT id, type, status, price, paid_amount, currency, nationality FROM certificate_requests WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE', [id, tenantId]);
  if (!request) return null;
  const [[any]] = await db.query('SELECT COUNT(*) AS n FROM payments WHERE certificate_request_id=? AND tenant_id=?', [id, tenantId]);
  if (!Number(any.n)) return { id, changed: false, paid: Number(request.paid_amount) || 0 };
  const currency = String(request.currency || 'EGP').toUpperCase();
  const [[sum]] = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM payments
      WHERE certificate_request_id=? AND tenant_id=? AND status='paid' AND deleted_at IS NULL AND UPPER(currency)=?`, [id, tenantId, currency]);
  const paid = Number(sum.paid) || 0;
  const due = Number(request.price) > 0
    ? Number(request.price)
    : basePriceForCurrency(await certificatePricing(db, tenantId), request.type, currency, request.nationality);
  // Only the unpaid/paid pair is moved here: a certificate already on its way keeps its stage.
  const movable = ['PENDING', 'PRICED', 'PAID'].includes(request.status);
  const status = !movable ? request.status : (due > 0 && paid >= due ? 'PAID' : (request.status === 'PENDING' && paid === 0 ? 'PENDING' : 'PRICED'));
  const changed = Math.abs(paid - (Number(request.paid_amount) || 0)) > 0.001 || status !== request.status;
  if (changed) await db.query('UPDATE certificate_requests SET paid_amount=?, status=? WHERE id=? AND tenant_id=?', [paid, status, id, tenantId]);
  return { id, changed, paid, status };
}

module.exports = { applyCertificatePayment, certificateNameOf, certificatePrice, certificatePricing, decideCertificatePrice, setCertificatePrice, syncCertificateRequest };
