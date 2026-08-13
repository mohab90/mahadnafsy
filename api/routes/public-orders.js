'use strict';
const express = require('express');
const router = express.Router();
const logger = require('../lib/logger').child({ module: 'public-orders-route' });
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { sendEmail } = require('../lib/email');
const { tryJson } = require('../lib/helpers');
const { getPaymentGatewaySettings, isPaymobActive } = require('../lib/saasSettings');
const { paymobLimiter, publicLimiter } = require('../middleware/rateLimits');
const { branchIdForBranch } = require('../lib/branches');
const { sendWhatsApp } = require('../lib/whatsapp');
const { awardPointsForPayment } = require('../lib/loyalty');
const { DEFAULT_TENANT_ID } = require('../lib/tenantScope');
const { postPaymentJournal } = require('../lib/finance');
const { assertWritable } = require('../lib/periodLock');
const { transitionLead } = require('../lib/leadState');
const { ensureSubscriberForOrder } = require('../lib/subscriberProvisioning');
const { createNotification } = require('../lib/notification');
const {
  PAYMOB_HMAC_FIELDS,
  buildPaymobHmacPayload,
  verifyPaymobHmac,
  paymobMerchantOrderId,
  paymobTransactionId,
} = require('../lib/paymobHmac');

const BRANCH_ALIASES = {
  DAQQI: 'DAQQI',
  DQI: 'DAQQI',
  DOKKI: 'DAQQI',
  TAGAMOA: 'TAGAMOA',
  ONLINE: 'ONLINE_EGYPT',
  ONLINE_EGYPT: 'ONLINE_EGYPT',
  ONLINE_SAUDI: 'ONLINE_SAUDI',
  ONLINE_ABROAD: 'ONLINE_ABROAD',
  INTERNATIONAL: 'ONLINE_ABROAD',
  OTHER: 'OTHER',
};

function normalizePaymentBranch(value) {
  const key = String(value || '').trim().toUpperCase().replace(/[-\s]+/g, '_');
  return BRANCH_ALIASES[key] || null;
}

function normalizeOrderTypeForDb(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'course') return 'COURSE';
  if (key === 'bundle') return 'BUNDLE';
  if (key === 'consultation' || key === 'standalone_payment' || key === 'standalone') return 'CONSULTATION';
  return 'CONSULTATION';
}

function normalizedOrderType(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'course') return 'course';
  if (key === 'bundle') return 'bundle';
  return 'consultation';
}

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

function appendTenantScope(sql, alias, tenantId, params) {
  const prefix = alias ? `${alias}.` : '';
  const effectiveTenantId = tenantId || DEFAULT_TENANT_ID;
  if (effectiveTenantId === DEFAULT_TENANT_ID) {
    params.push(DEFAULT_TENANT_ID);
    return `${sql} AND (${prefix}tenant_id = ? OR ${prefix}tenant_id IS NULL)`;
  }
  params.push(effectiveTenantId);
  return `${sql} AND ${prefix}tenant_id = ?`;
}

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
    });
  } catch (e) {
    // A settings lookup that fails must not read as "we take cards" — fall
    // closed so the customer is offered the manual route that always works.
    logger.warn('[payment-availability]', e.message);
    res.json({ online: false, provider: null, mode: 'sandbox' });
  }
});

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
async function paymobIntention({ paymob, amountCents, currency, orderId, itemTitle, billing }) {
  const { notification, redirection } = paymobCallbackUrls(paymob);
  if (!notification || !redirection) throw new Error('Paymob webhook/callback URLs are not configured');
  const res = await fetch('https://accept.paymob.com/v1/intention/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Token ${paymob.secret_key}` },
    body: JSON.stringify({
      amount: amountCents,
      currency,
      payment_methods: [Number(paymob.integration_id_unified)],
      items: itemTitle ? [{ name: String(itemTitle).slice(0, 80), amount: amountCents, quantity: 1 }] : [],
      billing_data: billing,
      special_reference: String(orderId),
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

const paymobIntentionReady = paymob => Boolean(paymob?.secret_key && paymob?.integration_id_unified);

router.post('/api/payments/paymob-init', paymobLimiter, async (req, res) => {
  try {
    const config = await getPaymentGatewaySettings(req.tenantId);
    if (!paymobReady(config)) return gatewayUnavailable(res, 'paymob_not_configured');

    const { orderId, amount, currency = 'EGP', itemTitle } = req.body || {};
    if (!orderId || !amount || Number(amount) <= 0) return res.status(400).json({ error: 'orderId and positive amount are required' });

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
      return res.json({
        ok: true,
        provider: 'paymob',
        flow: 'intention',
        mode: config.mode || 'sandbox',
        iframeId: iframeIdEarly,
        paymentKey: intention.key,
        paymobOrderId: intention.intentionId || null,
        iframeUrl: `https://accept.paymob.com/api/acceptance/iframes/${iframeIdEarly}?payment_token=${encodeURIComponent(intention.key)}`,
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
    const extra = JSON.stringify({ bundleCourseIds, consultationData, extraCertRequestId, subscriberEmail, isInstallment, installmentLimit });
    const orderBranchId = branchIdForBranch(req.body?.branch || 'ONLINE_EGYPT');
    const orderType = normalizeOrderTypeForDb(type);
    conn = await pool.getConnection();
    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO orders (id, item_id, item_title, type, status, amount, currency,
         payment_method, customer_name, customer_email, customer_phone, notes, tenant_id, branch_id, created_at)
       VALUES (?,?,?,?,'pending',?,?,?,?,?,?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE status='pending', notes=VALUES(notes), tenant_id=VALUES(tenant_id), branch_id=VALUES(branch_id)`,
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

// ── Paymob: shared helper — finalises an order after verified payment ─────────
// In-flight order processing guard — prevents concurrent webhook calls for the same order
// from both entering the DB transaction simultaneously (race condition protection)
const _paymobProcessingOrders = new Set();

async function finalisePaymobOrder(merchantOrderId, transactionId) {
  // Race condition guard: if already being processed by another concurrent webhook, skip
  if (_paymobProcessingOrders.has(merchantOrderId)) {
    logger.warn(`[paymob] Order ${merchantOrderId} already in-flight — skipping duplicate webhook`);
    return { found: true, alreadyProcessed: true };
  }
  _paymobProcessingOrders.add(merchantOrderId);
  try {
    return await _finalisePaymobOrderInner(merchantOrderId, transactionId);
  } finally {
    _paymobProcessingOrders.delete(merchantOrderId);
  }
}

async function _finalisePaymobOrderInner(merchantOrderId, transactionId) {
  const [[order]] = await pool.query(
    `SELECT id, type, item_id, item_title, amount, currency, payment_method, customer_name,
     customer_email, customer_phone, status, transaction_id, coupon_code, subscriber_id,
     course_id, bundle_id, notes, staff_id, staff_name, tenant_id, branch_id, created_at, paid_at
     FROM orders WHERE id = ? LIMIT 1`, [merchantOrderId]);
  if (!order) { logger.warn(`[paymob] Order not found: ${merchantOrderId}`); return { found: false }; }
  if (String(order.status || '').toLowerCase() === 'paid') return { found: true, alreadyProcessed: true };
  const tenantId = order.tenant_id || DEFAULT_TENANT_ID;
  const orderType = normalizedOrderType(order.type);

  // Additional idempotency check: if transactionId already in payments table, skip
  if (transactionId) {
    const [[existingPay]] = await pool.query(
      `SELECT id FROM payments WHERE transaction_id=? AND tenant_id=? LIMIT 1`,
      [transactionId, tenantId]
    );
    if (existingPay) {
      logger.info(`[paymob] transactionId ${transactionId} already recorded — skipping`);
      return { found: true, alreadyProcessed: true };
    }
  }

  const extra = (() => { try { return JSON.parse(order.notes || '{}'); } catch { return {}; } })();

  const payId = `paymob-${merchantOrderId}`;
  const payCourseId = orderType === 'course' ? (order.item_id || null) : null;
  const payBundleId = orderType === 'bundle' ? (order.item_id || null) : null;

  // ── Atomic transaction: ensure subscriber + mark order paid + enroll + record payment ──
  const conn = await pool.getConnection();
  let sub;
  try {
    await conn.beginTransaction();
    await assertWritable(new Date().toISOString().slice(0, 10), conn, tenantId);

    // Registration alone never creates a subscribers row (only users + leads —
    // see auth.js), so a customer paying for the first time has no subscriber
    // yet. Without this, enrollment below was silently skipped whenever `sub`
    // was falsy — the payment succeeded but the customer never got the course
    // (LMS-01). ensureSubscriberForOrder creates one, linked to a matching
    // lead when found, exactly like the manual-transfer-proof path already did.
    sub = await ensureSubscriberForOrder(conn, {
      tenantId,
      email: order.customer_email,
      name: order.customer_name,
      phone: order.customer_phone,
      fallbackBranch: normalizePaymentBranch(extra?.branch) || 'ONLINE_EGYPT',
    });
    const [[leadBranchRow]] = await conn.query(
      'SELECT l.branch FROM leads l JOIN subscribers s ON s.lead_id = l.id WHERE s.id = ? AND (l.tenant_id = ? OR l.tenant_id IS NULL) LIMIT 1',
      [sub.id, tenantId]
    ).catch(() => [[null]]);
    const paymentBranch = normalizePaymentBranch(sub?.branch)
      || normalizePaymentBranch(leadBranchRow?.branch)
      || normalizePaymentBranch(extra?.branch)
      || 'ONLINE_EGYPT';

    // 1. Mark order paid
    await conn.query("UPDATE orders SET status='paid', transaction_id=? WHERE id=? AND tenant_id=?", [transactionId, merchantOrderId, tenantId]);

    // 2. Auto-enroll subscriber for course or bundle payments
    if ((orderType === 'course' || orderType === 'bundle') && sub) {
      // SECURITY: always fetch bundle courses from DB — never trust client-supplied bundleCourseIds
      let courseIds;
      if (orderType === 'bundle') {
        const [bundleRows] = await conn.query(
          `SELECT bc.course_id FROM bundle_courses bc
           JOIN bundles b ON b.id=bc.bundle_id AND b.tenant_id=bc.tenant_id
           JOIN courses c ON c.id=bc.course_id AND c.tenant_id=bc.tenant_id AND c.deleted_at IS NULL
           WHERE bc.tenant_id=? AND bc.bundle_id=?`,
          [tenantId, order.item_id]
        );
        courseIds = bundleRows.map(row => row.course_id);
        if (!courseIds.length) throw new Error('Paid bundle has no tenant-owned courses');
      } else {
        const [[course]] = await conn.query('SELECT id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [order.item_id, tenantId]);
        if (!course) throw new Error('Paid course does not belong to tenant');
        courseIds = [order.item_id];
      }
      for (const cid of courseIds) {
        await conn.query(
          `INSERT INTO enrollments (id, subscriber_id, course_id, enrolled_at, access_type, tenant_id, branch_id)
           VALUES (?,?,?,NOW(),'full',?,?) ON DUPLICATE KEY UPDATE access_type='full', tenant_id=VALUES(tenant_id), branch_id=VALUES(branch_id)`,
          [uuidv4(), sub.id, cid, sub.tenant_id || 'tenant-default', sub.branch_id || branchIdForBranch(sub.branch)]
        );
      }
      logger.info(`[paymob] Enrolled ${order.customer_email} in ${courseIds.join(',')} (order ${merchantOrderId})`);
    }

    // 3. Auto-create consultation record
    if (extra.consultationData) {
      const cd = extra.consultationData;
      await conn.query(
        `INSERT IGNORE INTO consultations
           (id, tenant_id, client_name, client_email, client_phone, therapist_id, therapist_name,
            session_type, session_date, status, amount, currency, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
        [cd.id||uuidv4(), tenantId, cd.clientName||'', cd.clientEmail||'', cd.clientPhone||'',
         cd.therapistId||'', cd.therapistName||'', cd.sessionType||'individual',
         cd.sessionDate||'', 'pending', order.amount, order.currency]
      );
    }

    // 4. Record in payments table (ON DUPLICATE KEY guards against double-webhook)
    await conn.query(
      `INSERT INTO payments
         (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method,
          transaction_id, is_installment, course_expected, branch, branch_id, tenant_id, note, date, status, created_at)
       VALUES (?,?,?,?,?,?,'COURSE','online_paymob',?,0,?,?,?,?,?,NOW(),'paid',NOW())`,
      [
        payId,
        sub?.id || null,
        payCourseId,
        payBundleId,
        order.amount,
        order.currency || 'EGP',
        transactionId || null,
        order.amount,   // course_expected = full order amount (what customer agreed to pay)
        paymentBranch,
        branchIdForBranch(paymentBranch),
        tenantId,
        `دفع إلكتروني Paymob — طلب ${merchantOrderId}${transactionId ? ' | معاملة ' + transactionId : ''}`
      ]
    );
    const journalId = await postPaymentJournal({
      paymentId: payId,
      amount: order.amount,
      currency: order.currency || 'EGP',
      payType: 'COURSE',
      actor: 'paymob',
      tenantId,
    }, conn);
    if (!journalId) throw new Error('Paymob payment journal posting failed');

    // 5. Close the linked lead in the CRM pipeline — atomically with the payment,
    // through the central transition service so the timeline stays consistent.
    // force:true because a confirmed provider payment is ground truth: a tenant's
    // custom pipeline must not be able to veto it. This used to run after commit
    // in a fire-and-forget setImmediate whose 409 from validateTransition was
    // swallowed, leaving paying customers sitting in the pipeline as open leads —
    // sales kept chasing them, conversion rate read low, and staff KPIs
    // undercounted their own wins.
    if (sub?.lead_id) {
      await transitionLead({
        tenantId,
        leadId: sub.lead_id,
        toStatus: 'converted',
        actor: 'paymob-callback',
        reason: 'تحوّل لمشترك بعد دفعة إلكترونية مؤكدة',
        metadata: { paymentId: payId, subscriberId: sub.id, orderId: merchantOrderId },
        db: conn,
        force: true,
      });
    }

    await conn.commit();
    awardPointsForPayment({
      id: payId,
      subscriberId: sub?.id || null,
      amount: order.amount,
      createdBy: 'paymob',
    }).catch(error => logger.warn('[paymob] loyalty award failed', { paymentId: payId, error: error.message }));
    logger.info(`[paymob] Transaction committed: order ${merchantOrderId}, payment ${payId}`);
  } catch (e) {
    await conn.rollback();
    logger.error('[paymob] finalisePaymobOrder transaction rolled back:', e.message);
    throw e;
  } finally {
    conn.release();
  }

  // ── Post-commit side effects (non-critical, don't block response) ──────────
  // Calculate commission for assigned sales staff on Paymob payment
  if (sub?.id && order.amount > 0) {
    setImmediate(async () => {
      try {
        const [[subRow]] = await pool.query(
          'SELECT assigned_sales_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1',
          [sub.id, tenantId]
        );
        const finalStaffId = subRow?.assigned_sales_id || null;
        if (!finalStaffId) return;
        const [[rule]] = await pool.query(`
          SELECT id, percentage_value FROM commission_rules
          WHERE tenant_id=? AND is_active=1 AND calc_type='PERCENTAGE'
            AND (staff_id=? OR (staff_id IS NULL AND JSON_CONTAINS(COALESCE(apply_to_roles,'[]'), JSON_QUOTE((SELECT role FROM staff WHERE id=? AND tenant_id=? LIMIT 1)))))
            AND effective_from <= CURDATE() AND (effective_to IS NULL OR effective_to >= CURDATE())
            AND (min_payment IS NULL OR min_payment <= ?)
          ORDER BY staff_id DESC, priority ASC LIMIT 1
        `, [tenantId, finalStaffId, finalStaffId, tenantId, Number(order.amount)]).catch(() => [[null]]);
        let commRate = rule?.percentage_value || 0;
        if (!commRate) {
          const [[stf]] = await pool.query(
            'SELECT commission_rate FROM staff WHERE id=? AND tenant_id=? LIMIT 1',
            [finalStaffId, tenantId]
          ).catch(() => [[null]]);
          commRate = stf?.commission_rate || 0;
        }
        if (commRate > 0) {
          const commAmount = parseFloat((Number(order.amount) * commRate / 100).toFixed(2));
          const now = new Date();
          await pool.query(
            `INSERT INTO crm_commissions (id, tenant_id, branch_id, staff_id, payment_id, rule_id, client_id, client_type, payment_amount, commission_amount, calc_details, month, year, status, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',NOW()) ON DUPLICATE KEY UPDATE commission_amount=VALUES(commission_amount)`,
            [uuidv4(), tenantId, order.branch_id || 'branch-other', finalStaffId, payId, rule?.id||null, sub.id, 'subscriber',
             Number(order.amount), commAmount,
             JSON.stringify({ rate: commRate, calc_type: 'PERCENTAGE', rule_id: rule?.id||null, trigger: 'paymob_payment' }),
             now.getMonth()+1, now.getFullYear()]
          );
          logger.info(`[paymob] Commission ${commAmount} (${commRate}%) → staff ${finalStaffId}`);
        }
      } catch (commErr) { logger.warn('[paymob] commission calc error:', commErr.message); }
    });
  }
  // In-app notification so the dashboard bell surfaces online revenue to the
  // accountant/admin. The WhatsApp ping below only reaches one env-configured
  // number and is silently skipped when ADMIN_WHATSAPP_PHONE is unset, so it was
  // possible for an online payment to land with nobody being told at all.
  createNotification(
    'payment',
    '💳 دفعة أونلاين جديدة',
    `${order.customer_name || order.customer_email || 'عميل'} — ${order.amount} ${order.currency || 'EGP'}`,
    {
      paymentId: payId,
      orderId: merchantOrderId,
      subscriberId: sub?.id || null,
      amount: order.amount,
      currency: order.currency || 'EGP',
      link: '/dashboard?tab=payments',
    },
    tenantId,
  ).catch(() => {});

  // Notify admin on new Paymob payment
  const adminPhone = process.env.ADMIN_WHATSAPP_PHONE;
  if (adminPhone) {
    const msg = `💳 دفعة أونلاين جديدة!\nالعميل: ${order.customer_name || order.customer_email || '—'}\nالمبلغ: ${order.amount} ${order.currency || 'EGP'}\nالطلب: ${merchantOrderId}`;
    sendWhatsApp(adminPhone.replace(/\D/g, ''), msg, { tenantId }).catch(() => {});
  }
  // Auto-update lead deal_value and convert lead on successful payment
  if (sub?.id && order.amount > 0) {
    syncLeadDealValue(sub.id, pool, tenantId).catch(() => {});
    // Fallback only: when the subscriber carries no lead_id, try to discover an
    // unlinked lead by phone/email. The linked case is already converted inside
    // the payment transaction above, so this no longer runs for it.
    if (!sub.lead_id) setImmediate(async () => {
      try {
        const [[subRow]] = await pool.query('SELECT lead_id, phone, email, tenant_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [sub.id, tenantId]);
        if (!subRow) return;
        const subTenantId = subRow.tenant_id || tenantId || DEFAULT_TENANT_ID;
        let leadId = subRow.lead_id;
        if (!leadId && (subRow.phone || subRow.email)) {
          const normPhone = subRow.phone ? subRow.phone.replace(/\D/g, '').replace(/^(20|0020)?([0-9]{10})$/, '0$2') : null;
          const [[found]] = await pool.query(
            `SELECT id FROM leads
             WHERE tenant_id=? AND hidden=0
               AND ((? IS NOT NULL AND REGEXP_REPLACE(phone,'[^0-9]','') LIKE ?) OR email = ?)
             ORDER BY created_at DESC LIMIT 1`,
            [subTenantId, normPhone, normPhone ? `%${normPhone.slice(-9)}` : '', subRow.email || '']
          );
          leadId = found?.id || null;
        }
        if (leadId) {
          await transitionLead({
            tenantId: subTenantId, leadId, toStatus: 'converted', actor: 'paymob-callback',
            reason: 'Lead converted after confirmed provider payment', metadata: { subscriberId: sub.id },
          });
          logger.info(`[paymob] Lead ${leadId} auto-converted after payment`);
        }
      } catch (e) { logger.warn('[paymob] lead auto-convert error:', e.message); }
    });
  }

  // ── Send payment confirmation email to customer ───────────────────────────
  const customerEmail = order.customer_email;
  if (customerEmail) {
    const itemName = extra.courseName || extra.bundleName || `طلب #${merchantOrderId}`;
    const amountFmt = `${order.amount} ${order.currency || 'EGP'}`;
    sendEmail(customerEmail,
      `✅ تم استلام دفعتك — ${itemName}`,
      `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#7c3aed">شكراً ${order.customer_name || 'عزيزنا'}! 🎉</h2>
        <p>تم استلام دفعتك بنجاح وتم تفعيل اشتراكك.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;background:#f5f3ff;font-weight:bold">المنتج</td><td style="padding:8px">${itemName}</td></tr>
          <tr><td style="padding:8px;background:#f5f3ff;font-weight:bold">المبلغ</td><td style="padding:8px">${amountFmt}</td></tr>
          <tr><td style="padding:8px;background:#f5f3ff;font-weight:bold">رقم الطلب</td><td style="padding:8px">${merchantOrderId}</td></tr>
          <tr><td style="padding:8px;background:#f5f3ff;font-weight:bold">رقم المعاملة</td><td style="padding:8px">${transactionId || '—'}</td></tr>
        </table>
        <p>يمكنك البدء في التعلم الآن من خلال <a href="https://mahadnafsy.com/my-account" style="color:#7c3aed">لوحة التحكم</a>.</p>
        <p style="color:#9ca3af;font-size:12px">معهد الدراسات النفسية — mahadnafsy.com</p>
      </div>`,
      { tenantId }
    ).catch(e => logger.warn('[email] payment confirmation failed:', e.message));
  }

  return { found: true, alreadyProcessed: false };
}
// Finds the lead linked to this subscriber (by lead_id or phone/email match)
// and sets deal_value = sum of all payments for that subscriber.
async function syncLeadDealValue(subscriberId, db = pool, expectedTenantId = null, strict = false) {
  try {
    const subParams = expectedTenantId ? [subscriberId, expectedTenantId] : [subscriberId];
    const [[sub]] = await db.query(
      `SELECT id, lead_id, phone, email, tenant_id FROM subscribers
       WHERE id=?${expectedTenantId ? ' AND tenant_id=?' : ''} LIMIT 1`,
      subParams
    );
    if (!sub) return;
    const tenantId = sub.tenant_id || DEFAULT_TENANT_ID;
    // Sum all payments for this subscriber
    const totalParams = [subscriberId];
    const totalWhere = appendTenantScope('WHERE subscriber_id = ? AND amount > 0', '', tenantId, totalParams);
    const [[totals]] = await db.query(
      `SELECT COALESCE(SUM(amount_egp),0) AS total FROM payments ${totalWhere}`,
      totalParams
    );
    const total = Number(Number(totals?.total || 0).toFixed(2));
    if (!total) return;
    // Find linked lead — first try direct lead_id link, then phone/email match
    let leadId = sub.lead_id;
    if (!leadId && (sub.phone || sub.email)) {
      // Normalize phone to last-9-digits pattern to handle +2010xxx vs 010xxx vs 10xxx format differences
      const normPhone = sub.phone ? sub.phone.replace(/\D/g, '').replace(/^(20|0020)?([0-9]{10})$/, '0$2') : null;
      const params = normPhone ? [`%${normPhone.slice(-9)}`, sub.email || ''] : [sub.email];
      const base = normPhone
        ? `WHERE (REGEXP_REPLACE(phone,'[^0-9]','') LIKE ? OR email = ?) AND hidden=0`
        : 'WHERE email = ? AND hidden=0';
      const where = appendTenantScope(base, '', tenantId, params);
      const [[found]] = await db.query(`SELECT id FROM leads ${where} ORDER BY created_at DESC LIMIT 1`, params);
      leadId = found?.id || null;
    }
    if (!leadId) return;
    // Update lead's deal_value. Schema is managed by numbered migrations.
    try {
      const updateParams = [total, leadId];
      const updateWhere = appendTenantScope('id = ?', '', tenantId, updateParams);
      await db.query(`UPDATE leads SET deal_value = ? WHERE ${updateWhere}`, updateParams);
      logger.info(`[deal-value] lead ${leadId} deal_value set to ${total} EGP (sub ${subscriberId})`);
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR') {
        logger.error('[deal-value] leads.deal_value missing; run database migrations before accepting payments');
      }
    }
  } catch (e) {
    logger.warn('[deal-value] syncLeadDealValue error:', e.message);
    if (strict) throw e;
  }
}

function paymobSuccess(params) {
  return String(params.success ?? params.obj?.success ?? '').toLowerCase() === 'true';
}

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
    const result = await finalisePaymobOrder(merchantOrderId, paymobTransactionId(params));
    res.json({ ok: true, verified: true, paid: !!result.found, alreadyProcessed: !!result.alreadyProcessed });
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
      if (merchantOrderId) await finalisePaymobOrder(merchantOrderId, paymobTransactionId(params));
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    logger.error('[paymob/webhook]', e.message);
    res.status(200).json({ ok: false, reason: 'processing_error' });
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
