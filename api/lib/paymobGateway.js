'use strict';
// Talking to Paymob: is the gateway set up, the intention a payment opens, the
// amount it is charged in, and what a callback says happened. Used by the
// checkout routes (routes/public-orders.js) and the finalisation.
const logger = require('./logger').child({ module: 'public-orders-route' });
const { pool } = require('./db');
const { tryJson } = require('./helpers');
const { getPaymentGatewaySettings, isPaymobActive } = require('./saasSettings');
const { postPaymentJournal, logPaymentAudit, toEgp } = require('./finance');

// Boolean, not the last truthy link in the chain — an && chain returns the
// value it stopped on, which here was the stored iframe id. Callers that only
// branch on it never noticed, but /api/public/payment-availability serialises
// this straight to an anonymous visitor, so it has to be a yes or a no.
function paymobReady(config) {
  const paymob = config?.paymob || {};
  return Boolean(
    isPaymobActive(config)
    && paymob.api_key
    && paymob.hmac_secret
    && paymob.integration_id_card
    && paymob.iframe_id
  );
}

async function postPaymobJson(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const json = tryJson(text, null);
    if (!response.ok) throw new Error(`Paymob HTTP ${response.status}: ${text.slice(0, 250)}`);
    return json || {};
  } finally {
    clearTimeout(timer);
  }
}

function buildBillingData(input = {}) {
  const nameParts = String(input.customerName || 'Mahad Customer').trim().split(/\s+/);
  return {
    first_name: nameParts[0] || 'Mahad',
    last_name: nameParts.slice(1).join(' ') || 'Customer',
    email: input.customerEmail || 'customer@example.com',
    phone_number: input.customerPhone || '01000000000',
    apartment: 'NA',
    floor: 'NA',
    street: 'NA',
    building: 'NA',
    shipping_method: 'NA',
    postal_code: 'NA',
    city: 'Cairo',
    country: 'EG',
    state: 'Cairo',
  };
}


// Where Paymob should send the customer and the payment notification. The
// legacy flow reads both from whatever is configured on the integration in
// Paymob's own dashboard; the intention flow below sends them with each
// payment, which is why it does not depend on that dashboard being correct.
function paymobCallbackUrls(paymob) {
  const webhook = String(paymob.webhook_url || '').trim();
  let origin = '';
  try { origin = new URL(webhook).origin; } catch { /* fall through */ }
  const callback = String(paymob.callback_url || '/success').trim();
  const redirection = /^https?:\/\//i.test(callback)
    ? callback
    : origin ? origin + (callback.startsWith('/') ? callback : '/' + callback) : '';
  return { notification: webhook, redirection };
}

// Paymob's Intention API mints a payment key the same iframes accept, but
// takes notification_url and redirection_url in the request body. It only
// works with a Unified (UIG) integration and the newer `egy_sk_` secret key,
// so it is used when both are present and the classic three-call flow remains
// for accounts that have neither.
// Every integration the merchant has configured. Unified Checkout offers the
// customer exactly the methods the intention was created with, so sending only
// the unified id meant the live page showed a mobile wallet field and nothing
// else — no card form at all, on a site whose customers pay by card.
function paymobPaymentMethods(paymob) {
  const ids = [paymob.integration_id_unified, paymob.integration_id_card, paymob.integration_id_wallet]
    .map(value => Number(String(value ?? '').replace(/\D+/g, '')))
    .filter(value => Number.isFinite(value) && value > 0);
  return [...new Set(ids)];
}

async function paymobIntention({ paymob, amountCents, currency, orderId, itemTitle, billing }) {
  const { notification, redirection } = paymobCallbackUrls(paymob);
  if (!notification || !redirection) throw new Error('Paymob webhook/callback URLs are not configured');
  const res = await fetch('https://accept.paymob.com/v1/intention/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Token ${paymob.secret_key}` },
    body: JSON.stringify({
      amount: amountCents,
      currency,
      payment_methods: paymobPaymentMethods(paymob),
      items: itemTitle ? [{ name: String(itemTitle).slice(0, 80), amount: amountCents, quantity: 1 }] : [],
      billing_data: billing,
      // Unique per attempt, not per order: Paymob refuses a reference it has
      // seen before, and our order id is stable by design because
      // checkout-intent is idempotent. The webhook maps it back by taking
      // everything before the "~" — a character no UUID contains.
      special_reference: `${orderId}~${Date.now().toString(36)}`,
      notification_url: notification,
      redirection_url: redirection,
    }),
  });
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch { /* non-JSON error page */ }
  const key = body?.payment_keys?.[0]?.key;
  if (!key) throw new Error(`Paymob intention failed (${res.status}): ${JSON.stringify(body?.detail || text).slice(0, 200)}`);
  return { key, clientSecret: body.client_secret, intentionId: body.id };
}

// Paymob Egypt charges in EGP only: a SAR order sent as SAR never reached its
// dashboard. The order keeps the customer's price; the EGP figure asked of
// Paymob is fixed on the order the first time, so a retried checkout charges
// the same amount and the webhook can check the capture against it.
// Returns null when no fresh exchange rate is available — guessing one would
// charge the customer a wrong price.
async function paymobCharge(orderId, tenantId, order) {
  const currency = String(order.currency || 'EGP').toUpperCase();
  if (currency === 'EGP') return { amount: Number(order.amount), currency: 'EGP' };
  if (Number(order.charge_amount) > 0 && String(order.charge_currency || '').toUpperCase() === 'EGP') {
    return { amount: Number(order.charge_amount), currency: 'EGP' };
  }
  let egp;
  try { egp = await toEgp(order.amount, currency, tenantId); } catch (e) {
    logger.warn('[paymob-init] no EGP rate for order', { orderId, currency, reason: e.message });
    return null;
  }
  if (!(egp > 0)) return null;
  await pool.query(
    'UPDATE orders SET charge_amount=?, charge_currency=?, charge_fx_rate=? WHERE id=? AND tenant_id=?',
    [egp, 'EGP', egp / Number(order.amount), orderId, tenantId]);
  return { amount: egp, currency: 'EGP' };
}

const paymobIntentionReady = paymob => Boolean(paymob?.secret_key && paymob?.integration_id_unified);


// The captured figure, out of the same signed payload the HMAC covers.
function paymobCapture(params) {
  const cents = Number(params.amount_cents ?? params.obj?.amount_cents);
  const currency = params.currency ?? params.obj?.currency ?? null;
  return {
    amountCents: Number.isFinite(cents) ? Math.round(cents) : null,
    currency: currency ? String(currency) : null,
  };
}

function paymobSuccess(params) {
  return String(params.success ?? params.obj?.success ?? '').toLowerCase() === 'true';
}

module.exports = { paymobReady, postPaymobJson, buildBillingData, paymobCallbackUrls, paymobPaymentMethods, paymobIntention, paymobCharge, paymobIntentionReady, paymobCapture, paymobSuccess };
