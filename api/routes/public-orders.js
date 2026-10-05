'use strict';
// Checkout: what a client can pay with, reserving an order, Paymob's
// intention, its callback and webhook. The gateway itself is lib/paymobGateway.js,
// turning a successful payment into a paid order is lib/paymobFinalise.js, and
// the order's branch and type spellings are lib/orderFields.js.
const express = require('express');
const router = express.Router();
const { resolveCatalogPrice, priceMatches } = require('../lib/catalogPrice');
const logger = require('../lib/logger').child({ module: 'public-orders-route' });
const { pool } = require('../lib/db');
const { getPaymentGatewaySettings, isPaymobActive } = require('../lib/saasSettings');
const { paymobLimiter, publicLimiter } = require('../middleware/rateLimits');
const { branchIdForBranch } = require('../lib/branches');
const { DEFAULT_TENANT_ID } = require('../lib/tenantScope');
const {
  PAYMOB_HMAC_FIELDS,
  buildPaymobHmacPayload,
  verifyPaymobHmac,
  paymobMerchantOrderId,
  paymobTransactionId,
} = require('../lib/paymobHmac');
const { normalizeOrderTypeForDb, normalizedOrderType } = require('../lib/orderFields');
const { paymobReady, postPaymobJson, buildBillingData, paymobIntention, paymobCharge, paymobIntentionReady, paymobCapture, paymobSuccess } = require('../lib/paymobGateway');
const { finalisePaymobOrder, syncLeadDealValue } = require('../lib/paymobFinalise');

function gatewayUnavailable(res, reason = 'gateway_disabled') {
  return res.status(503).json({
    ok: false,
    reason,
    error: 'الدفع الإلكتروني غير متاح حاليا؛ يرجى استخدام الدفع اليدوي أو التواصل مع الإدارة.',
  });
}

function isDatabaseUnavailableError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return [
    'ECONNREFUSED',
    'PROTOCOL_CONNECTION_LOST',
    'ER_SERVER_LOST',
    'ER_ACCESS_DENIED_ERROR',
    'ER_BAD_DB_ERROR',
  ].includes(code) || /connect ECONNREFUSED|access denied|unknown database/i.test(message);
}


/**
 * Which manual channels the institute takes, for the customer screens.
 *
 * The admin edits this in الإعدادات ← وسائل الدفع, it is stored under
 * manual.supported_methods, and until now nothing customer-facing read it:
 * /checkout and /my-account each hardcoded their own list, in two different
 * vocabularies. Ticking a channel off changed nothing anyone could see.
 *
 * An empty stored list means the section has never been configured, not that
 * the institute refuses transfers — which is how most of its money arrives —
 * so it falls back to the defaults rather than leaving a customer with no way
 * to say how they paid. `manual.methods` is read too: it is the key
 * DEFAULT_PAYMENT_GATEWAY in lib/saasSettings.js seeds, and the merge leaves
 * both spellings on the stored object.
 */
function manualMethodsFor(config) {
  const manual = config?.manual || {};
  const stored = Array.isArray(manual.supported_methods) ? manual.supported_methods
    : Array.isArray(manual.methods) ? manual.methods : [];
  const known = ['cash', 'instapay', 'bank_transfer', 'vodafone_cash'];
  const clean = [...new Set(stored
    .map(entry => String(entry || '').trim().toLowerCase())
    .filter(entry => known.includes(entry)))];
  return clean.length ? clean : ['instapay', 'bank_transfer', 'vodafone_cash'];
}

// GET /api/public/payment-availability — can a visitor pay online right now?
// The customer-facing pages carried a hardcoded "الدفع الإلكتروني متوقف مؤقتاً"
// notice, so they told every customer online payment was off even once the
// gateway was fully configured, and there was no way for them to know better:
// nothing public reported gateway state. Answers only a boolean and the
// provider name — no keys, no ids, nothing that isn't already implied by the
// payment page a customer is about to be sent to.
router.get('/api/public/payment-availability', publicLimiter, async (req, res) => {
  try {
    const config = await getPaymentGatewaySettings(req.tenantId);
    res.json({
      online: paymobReady(config),
      provider: paymobReady(config) ? 'paymob' : null,
      mode: config?.mode || 'sandbox',
      manualMethods: manualMethodsFor(config),
    });
  } catch (e) {
    // A settings lookup that fails must not read as "we take cards" — fall
    // closed so the customer is offered the manual route that always works.
    // Which is also why the manual channels fall *open* here: a lookup failure
    // must not leave the only working payment path without a way to name it.
    logger.warn('[payment-availability]', e.message);
    res.json({
      online: false, provider: null, mode: 'sandbox',
      manualMethods: manualMethodsFor(null),
    });
  }
});


router.post('/api/payments/paymob-init', paymobLimiter, async (req, res) => {
  try {
    const config = await getPaymentGatewaySettings(req.tenantId);
    if (!paymobReady(config)) return gatewayUnavailable(res, 'paymob_not_configured');

    const { orderId, currency: requestedCurrency = 'EGP', itemTitle } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

    // Charged from the reserved order, never from the request. The body used to
    // carry its own amount, so even with the catalogue enforced at reserve time
    // a second call here could ask Paymob for a different figure — and the
    // webhook would still credit the order in full.
    const [[reserved]] = await pool.query(
      'SELECT amount, currency, charge_amount, charge_currency FROM orders WHERE id=? AND tenant_id=? LIMIT 1',
      [orderId, req.tenantId || DEFAULT_TENANT_ID]);
    if (!reserved) return res.status(404).json({ error: 'الطلب مش موجود — احجز الأول' });
    const orderAmount = Number(reserved.amount);
    if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
      return res.status(409).json({ error: 'الطلب مالوش مبلغ صالح', code: 'INVALID_ORDER_AMOUNT' });
    }
    const charge = await paymobCharge(orderId, req.tenantId || DEFAULT_TENANT_ID, {
      ...reserved, currency: reserved.currency || requestedCurrency,
    });
    if (!charge) {
      return res.status(503).json({
        ok: false, code: 'FX_UNAVAILABLE',
        error: 'تعذر تحويل المبلغ للجنيه حاليا — جرّب تاني بعد شوية أو ادفع بطريقة تانية.',
      });
    }
    const { amount, currency } = charge;

    const paymob = config.paymob || {};

    // Paymob's dashboard shows the iframe as a label ("Iframe 1051699"), and
    // that whole label gets pasted into the settings field. Interpolated as-is
    // the URL became .../iframes/Iframe%201051699 and the payment page would
    // not load, so take the digits.
    const iframeIdEarly = String(paymob.iframe_id || '').replace(/\D+/g, '');
    if (!iframeIdEarly) throw new Error('Paymob iframe id is not a number');

    if (paymobIntentionReady(paymob)) {
      const amountCents = Math.round(Number(amount) * 100);
      const intention = await paymobIntention({
        paymob, amountCents, currency, orderId,
        itemTitle, billing: buildBillingData(req.body || {}),
      });

      // Unified Checkout is Paymob's own hosted page: it offers every method the
      // intention was created with, rather than the single one an iframe is
      // fixed to, and it is the flow the live keys are issued for. The iframe
      // stays as the destination when no public key is configured, since a
      // public key is the one thing Unified Checkout cannot do without.
      const publicKey = String(paymob.public_key || '').trim();
      const checkoutUrl = publicKey && intention.clientSecret
        ? `https://accept.paymob.com/unifiedcheckout/?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(intention.clientSecret)}`
        : `https://accept.paymob.com/api/acceptance/iframes/${iframeIdEarly}?payment_token=${encodeURIComponent(intention.key)}`;

      return res.json({
        ok: true,
        provider: 'paymob',
        flow: publicKey && intention.clientSecret ? 'unified_checkout' : 'intention_iframe',
        mode: config.mode || 'sandbox',
        iframeId: iframeIdEarly,
        paymentKey: intention.key,
        paymobOrderId: intention.intentionId || null,
        iframeUrl: checkoutUrl,
        charged: charge,
      });
    }

    const auth = await postPaymobJson('https://accept.paymob.com/api/auth/tokens', { api_key: paymob.api_key });
    if (!auth.token) throw new Error('Paymob auth token missing');

    const amountCents = Math.round(Number(amount) * 100);
    const order = await postPaymobJson('https://accept.paymob.com/api/ecommerce/orders', {
      auth_token: auth.token,
      delivery_needed: false,
      amount_cents: amountCents,
      currency,
      merchant_order_id: String(orderId),
      items: itemTitle ? [{ name: String(itemTitle).slice(0, 80), amount_cents: amountCents, quantity: 1 }] : [],
    });
    if (!order.id) throw new Error('Paymob order id missing');

    const paymentKey = await postPaymobJson('https://accept.paymob.com/api/acceptance/payment_keys', {
      auth_token: auth.token,
      amount_cents: amountCents,
      expiration: 3600,
      order_id: order.id,
      billing_data: buildBillingData(req.body || {}),
      currency,
      integration_id: Number(paymob.integration_id_card),
      lock_order_when_paid: true,
    });
    if (!paymentKey.token) throw new Error('Paymob payment key missing');

    const iframeId = iframeIdEarly;
    res.json({
      ok: true,
      provider: 'paymob',
      flow: 'legacy',
      mode: config.mode || 'sandbox',
      iframeId,
      paymentKey: paymentKey.token,
      paymobOrderId: order.id,
      iframeUrl: `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${encodeURIComponent(paymentKey.token)}`,
      charged: charge,
    });
  } catch (e) {
    logger.warn('[paymob-init]', e.message);
    if (isDatabaseUnavailableError(e)) return gatewayUnavailable(res, 'payment_config_unavailable');
    res.status(502).json({ ok: false, error: 'تعذر بدء الدفع الإلكتروني حاليا.', detail: e.message });
  }
});

// ── Paymob: reserve pending order before payment (client calls this before iframe) ─────────
// No auth required — consultations and certificates don't require login.
// Reserve a seat, i.e. insert the pending order that the Paymob redirect is
// about to be created for. StandalonePayment.tsx calls this immediately before
// /api/payments/paymob-init, so the gateway check below is deliberate: without
// it, a disabled gateway would leave behind a pending order nobody can ever pay.
router.post('/api/orders/reserve', publicLimiter, async (req, res) => {
  let conn;
  try {
    const config = await getPaymentGatewaySettings(req.tenantId);
    if (!isPaymobActive(config)) return gatewayUnavailable(res, 'paymob_disabled');
    const {
      orderId, type, itemId, itemTitle, amount, currency, paymentMethod,
      customerEmail, customerName, customerPhone, bundleCourseIds,
      consultationData, extraCertRequestId, subscriberEmail, isInstallment, installmentLimit,
    } = req.body || {};
    if (!orderId || !type || !amount) return res.status(400).json({ error: 'Missing orderId, type, or amount' });

    // The price comes from the catalogue, not from the caller. This endpoint is
    // public — guests check out — and the amount used to be written straight
    // into orders.amount, which the Paymob webhook later reads back to decide
    // what the customer bought. A course could be ordered for any figure the
    // request cared to name.
    //
    // Refused rather than silently corrected: a mismatch means the page is
    // showing a price the catalogue no longer has, and quietly charging a
    // different one is its own kind of wrong.
    const orderTypeForPrice = normalizedOrderType(type);
    const catalogPrice = await resolveCatalogPrice(pool, {
      type: orderTypeForPrice,
      itemId,
      currency: currency || 'EGP',
      tenantId: req.tenantId || DEFAULT_TENANT_ID,
    });
    if (catalogPrice !== null && !priceMatches(amount, catalogPrice)) {
      logger.warn('[orders/reserve] price mismatch', {
        orderId, itemId, submitted: Number(amount), expected: catalogPrice,
      });
      return res.status(409).json({
        error: 'السعر اتغيّر — حدّث الصفحة وجرّب تاني',
        code: 'PRICE_MISMATCH',
        expected: catalogPrice,
      });
    }
    // Re-reserving an id that is already paid used to set it back to
    // 'pending'. The amount, type and item are not in the UPDATE list below so
    // they cannot be swapped after the fact, but the status walking backwards
    // is its own problem: the order stops counting as paid in every screen that
    // reads the column.
    const [[existing]] = await pool.query(
      'SELECT status FROM orders WHERE id=? AND tenant_id=? LIMIT 1',
      [orderId, req.tenantId || DEFAULT_TENANT_ID]);
    if (existing && String(existing.status || '').toLowerCase() === 'paid') {
      return res.status(409).json({ error: 'الطلب مدفوع بالفعل', code: 'ORDER_ALREADY_PAID' });
    }

    const extra = JSON.stringify({ bundleCourseIds, consultationData, extraCertRequestId, subscriberEmail, isInstallment, installmentLimit });
    const orderBranchId = branchIdForBranch(req.body?.branch || 'ONLINE_EGYPT');
    const orderType = normalizeOrderTypeForDb(type);
    conn = await pool.getConnection();
    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO orders (id, item_id, item_title, type, status, amount, currency,
         payment_method, customer_name, customer_email, customer_phone, notes, tenant_id, branch_id, created_at)
       VALUES (?,?,?,?,'pending',?,?,?,?,?,?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE
         notes      = IF(status='paid', notes,      VALUES(notes)),
         tenant_id  = IF(status='paid', tenant_id,  VALUES(tenant_id)),
         branch_id  = IF(status='paid', branch_id,  VALUES(branch_id)),
         status     = IF(status='paid', status,     'pending')`,
      [orderId, itemId||'', itemTitle||'', orderType, amount, currency||'EGP',
       paymentMethod||'', customerName||'', customerEmail||'', customerPhone||'', extra, req.tenantId || DEFAULT_TENANT_ID, orderBranchId]
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    logger.error('[orders/reserve]', e.message);
    if (isDatabaseUnavailableError(e)) return gatewayUnavailable(res, 'payment_config_unavailable');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (conn) conn.release();
  }
});


router.post('/api/paymob/verify', paymobLimiter, async (req, res) => {
  try {
    const config = await getPaymentGatewaySettings(req.tenantId);
    if (!isPaymobActive(config)) return gatewayUnavailable(res, 'paymob_disabled');
    const hmacSecret = config.paymob?.hmac_secret || process.env.PAYMOB_HMAC_SECRET || '';
    const params = req.body || {};
    const verified = verifyPaymobHmac(params, hmacSecret);
    if (!verified) return res.status(400).json({ ok: false, verified: false, paid: false, error: 'Invalid Paymob signature' });
    if (!paymobSuccess(params)) return res.json({ ok: true, verified: true, paid: false });

    const merchantOrderId = paymobMerchantOrderId(params);
    if (!merchantOrderId) return res.status(400).json({ ok: false, verified: true, paid: false, error: 'Missing merchant order id' });
    const result = await finalisePaymobOrder(merchantOrderId, paymobTransactionId(params), paymobCapture(params));
    // `found` only means the order exists. An order whose capture did not match
    // was deliberately NOT credited, and reporting it as paid would tell the
    // caller the opposite of what just happened.
    const refused = result.amountMismatch ? 'amount_mismatch' : result.currencyMismatch ? 'currency_mismatch' : null;
    res.json({
      ok: true, verified: true,
      paid: !!result.found && !refused,
      alreadyProcessed: !!result.alreadyProcessed,
      ...(refused ? { refused } : {}),
    });
  } catch (e) {
    logger.error('[paymob/verify]', e.message);
    if (isDatabaseUnavailableError(e)) return gatewayUnavailable(res, 'payment_config_unavailable');
    res.status(500).json({ ok: false, verified: false, paid: false, error: 'Internal server error' });
  }
});

router.post('/api/webhooks/paymob', paymobLimiter, async (req, res) => {
  try {
    const config = await getPaymentGatewaySettings(req.tenantId);
    if (!isPaymobActive(config)) return res.status(200).json({ ok: false, reason: 'paymob_disabled' });
    const hmacSecret = config.paymob?.hmac_secret || process.env.PAYMOB_HMAC_SECRET || '';
    const params = req.body?.obj ? { ...req.body.obj, hmac: req.query.hmac || req.body.hmac } : (req.body || {});
    if (!verifyPaymobHmac(params, hmacSecret)) return res.status(200).json({ ok: false, reason: 'invalid_signature' });
    if (paymobSuccess(params)) {
      const merchantOrderId = paymobMerchantOrderId(params);
      if (merchantOrderId) await finalisePaymobOrder(merchantOrderId, paymobTransactionId(params), paymobCapture(params));
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    logger.error('[paymob/webhook]', e.message);
    // A 200 here told Paymob the callback was delivered: a captured payment
    // whose crediting failed (database down, period lock, a deadlock) was never
    // sent again and the order stayed unpaid. finalisePaymobOrder is safe to
    // repeat — a lock, the order's own status, and the transaction id — so a
    // retry credits it once. A bad signature or a disabled gateway stays 200:
    // sending those again changes nothing.
    res.status(500).json({ ok: false, reason: 'processing_error' });
  }
});

router._test = {
  PAYMOB_HMAC_FIELDS,
  buildPaymobHmacPayload,
  verifyPaymobHmac,
  paymobMerchantOrderId,
  paymobTransactionId,
};

module.exports = router;
module.exports.syncLeadDealValue = syncLeadDealValue;
module.exports._paymobCharge = paymobCharge;
