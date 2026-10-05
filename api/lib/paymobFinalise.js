'use strict';
// A Paymob payment that went through becomes a paid order: the payment row,
// the entitlement, the journal, the receipt — once, however many times Paymob
// calls. Reached from the callback and the webhook in routes/public-orders.js.
const logger = require('./logger').child({ module: 'public-orders-route' });
const crypto = require('crypto');
const { pool } = require('./db');
const { queuePaymentReceipt } = require('./paymentReceipt');
const { branchIdForBranch } = require('./branches');
const { grantCourseEntitlement } = require('./entitlements');
const { sendWhatsApp } = require('./whatsapp');
const { awardPointsForPayment } = require('./loyalty');
const { DEFAULT_TENANT_ID } = require('./tenantScope');
const { postPaymentJournal, logPaymentAudit, toEgp } = require('./finance');
const { assertWritable } = require('./periodLock');
const { transitionLead } = require('./leadState');
const { findLeadByContact } = require('./leadMatching');
const { enqueueFinanceEvent } = require('./financeOutbox');
const { ensureSubscriberForOrder } = require('./subscriberProvisioning');
const { createNotification } = require('./notification');
const { cairoToday } = require('./dates');
const { getTenantSetting } = require('./tenantSettings');
const { consultationSettings, settleConsultationForOrder } = require('./consultationRequests');
const { normalizePaymentBranch, normalizedOrderType, appendTenantScope } = require('./orderFields');
const { paymobCharge } = require('./paymobGateway');

// ── Paymob: shared helper — finalises an order after verified payment ─────────
// In-flight guard, so two concurrent webhooks for one order cannot both enter
// the transaction below.
//
// The Set alone could not do this job. It lives in one Node process, and the API
// is deployed behind a process manager — a second worker (or a second instance)
// has its own empty Set and walks straight past it. The database is the only
// thing all workers share, so the real guard is a named lock there, exactly as
// the public lead routes already do it. The Set stays in front of it as a free
// same-process short-circuit that avoids taking a connection at all.
//
// Costs one extra pooled connection for the duration, because GET_LOCK is held
// by the session that took it and the work below opens its own. Paymob webhook
// volume is low; correctness here is worth one connection.
const _paymobProcessingOrders = new Set();

/**
 * @param {string} tenantId  the institute whose Paymob secret verified the
 *   callback. Only its own orders are credited: the order is looked up by id,
 *   and an institute with a Paymob account of its own could otherwise sign a
 *   «paid» callback for another institute's order and have it credited.
 */
async function finalisePaymobOrder(merchantOrderId, transactionId, capture = null, tenantId = DEFAULT_TENANT_ID) {
  // Race condition guard: if already being processed by another concurrent webhook, skip
  if (_paymobProcessingOrders.has(merchantOrderId)) {
    logger.warn(`[paymob] Order ${merchantOrderId} already in-flight — skipping duplicate webhook`);
    return { found: true, alreadyProcessed: true };
  }
  _paymobProcessingOrders.add(merchantOrderId);
  // Hashed because a merchant order id is caller-shaped and GET_LOCK names are
  // capped at 64 characters.
  const lockName = `paymob:${crypto.createHash('sha256').update(String(merchantOrderId)).digest('hex').slice(0, 40)}`;
  let lockConn;
  try {
    lockConn = await pool.getConnection();
    const [[lock]] = await lockConn.query('SELECT GET_LOCK(?,10) AS acquired', [lockName]);
    if (Number(lock?.acquired) !== 1) {
      // Another worker holds it, which means another worker is finalising this
      // same order. Reporting it as already processed is what the caller does
      // with a genuine duplicate, and Paymob retries regardless.
      logger.warn(`[paymob] Order ${merchantOrderId} locked by another worker — skipping duplicate webhook`);
      return { found: true, alreadyProcessed: true };
    }
    try {
      return await _finalisePaymobOrderInner(merchantOrderId, transactionId, capture, tenantId);
    } finally {
      await lockConn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    }
  } finally {
    if (lockConn) lockConn.release();
    _paymobProcessingOrders.delete(merchantOrderId);
  }
}

async function _finalisePaymobOrderInner(merchantOrderId, transactionId, capture = null, verifiedTenantId = DEFAULT_TENANT_ID) {
  const [[order]] = await pool.query(
    `SELECT id, type, item_id, item_title, amount, currency, charge_amount, charge_currency, payment_method, customer_name,
     customer_email, customer_phone, status, transaction_id, coupon_code, subscriber_id,
     course_id, bundle_id, notes, staff_id, staff_name, tenant_id, branch_id, created_at, paid_at
     FROM orders WHERE id = ? AND COALESCE(tenant_id, ?) = ? LIMIT 1`,
    [merchantOrderId, DEFAULT_TENANT_ID, verifiedTenantId || DEFAULT_TENANT_ID]);
  if (!order) { logger.warn(`[paymob] Order not found for this tenant: ${merchantOrderId}`); return { found: false }; }
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

  // What Paymob says it captured has to be what the order asked for. The
  // gateway signs amount_cents, so this is not about a forged payload — it is
  // about the order and the intention drifting apart between reservation and
  // capture, and about a partial capture being booked as a full one.
  // A foreign-currency order was charged in EGP (paymobCharge); that is what
  // Paymob captured, so that is what the capture is checked against.
  const charged = Number(order.charge_amount) > 0 && order.charge_currency
    ? { amount: order.charge_amount, currency: order.charge_currency }
    : { amount: order.amount, currency: order.currency };
  if (capture && Number.isFinite(capture.amountCents)) {
    const expectedCents = Math.round(Number(charged.amount || 0) * 100);
    if (expectedCents > 0 && capture.amountCents !== expectedCents) {
      logger.error('[paymob] captured amount does not match the order — not crediting', {
        merchantOrderId, transactionId,
        capturedCents: capture.amountCents, expectedCents,
        capturedCurrency: capture.currency || null, orderCurrency: charged.currency || null,
      });
      return { found: true, amountMismatch: true };
    }
    if (capture.currency && charged.currency
        && String(capture.currency).toUpperCase() !== String(charged.currency).toUpperCase()) {
      logger.error('[paymob] captured currency does not match the order — not crediting', {
        merchantOrderId, transactionId,
        capturedCurrency: capture.currency, orderCurrency: charged.currency,
      });
      return { found: true, currencyMismatch: true };
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
    await assertWritable(cairoToday(), conn, tenantId);

    // Registration alone never creates a subscribers row (only users + leads —
    // see auth.js), so a customer paying for the first time has no subscriber
    // yet. Without this, enrollment below was silently skipped whenever `sub`
    // was falsy — the payment succeeded but the customer never got the course
    // (LMS-01). ensureSubscriberForOrder creates one, linked to a matching
    // lead when found, exactly like the manual-transfer-proof path already did.
    // By the client the order names when it has no email: a customer who signs
    // in with a number has none, and the capture — the money already taken —
    // failed here with nothing enrolled.
    sub = await ensureSubscriberForOrder(conn, {
      tenantId,
      subscriberId: order.subscriber_id || null,
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
    await conn.query(
      "UPDATE orders SET status='paid', transaction_id=?, subscriber_id=COALESCE(subscriber_id,?), paid_at=COALESCE(paid_at,NOW()) WHERE id=? AND tenant_id=?",
      [transactionId, sub?.id || null, merchantOrderId, tenantId]);

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
      // Through the entitlement authority, like every other grant.
      //
      // This used to be its own INSERT. It wrote access_type='full' whatever
      // had been paid, recorded no entitlement_source, no granted_by, no
      // expiry and no entitlement_events row — and its ON DUPLICATE KEY UPDATE
      // set access_type='full' unconditionally, so it would raise a
      // deliberately limited grant to full, which is the one move
      // grantCourseEntitlement is written to refuse.
      //
      // 1,533 enrolments in the table record no reason for existing; this was
      // the last writer that could still add to them.
      for (const cid of courseIds) {
        await grantCourseEntitlement({
          tenantId: sub.tenant_id || tenantId,
          subscriberId: sub.id,
          courseId: cid,
          accessType: 'full',
          bundleId: orderType === 'bundle' ? order.item_id : null,
          branchId: sub.branch_id || branchIdForBranch(sub.branch),
          source: 'paymob_order',
          actor: order.customer_email || 'paymob',
        }, conn);
      }
      logger.info(`[paymob] Enrolled ${order.customer_email} in ${courseIds.join(',')} (order ${merchantOrderId})`);
    }

    // 3. The consultation this order pays for.
    //
    // It looked for extra.consultationData, which the checkout has never
    // written, so a consultation paid by card recorded nothing. The checkout
    // opens the consultation against the order now; this settles it, and opens
    // one from the order's details for an order placed before that.
    if (String(order.type || '').toUpperCase() === 'CONSULTATION') {
      const content = await getTenantSetting('content', { tenantId, fallback: {}, db: conn });
      await settleConsultationForOrder(conn, {
        tenantId, order, subscriberId: sub?.id || null,
        autoConfirm: consultationSettings(content).autoConfirm,
      });
    }

    // 4. Record in payments table.
    //
    // This INSERT is deliberately plain — do NOT add ON DUPLICATE KEY UPDATE.
    // It is the last line of defence against a double webhook, and it works by
    // failing: `payId` is derived from the order id, so a second run raises a
    // duplicate on the primary key (and on uq idx_payments_txn), the catch below
    // rolls the whole transaction back, and nothing is booked twice.
    //
    // The two checks above this transaction — order already 'paid', transaction
    // id already recorded — are reads outside it, so two webhooks arriving
    // together can both pass them. Only this constraint stops the pair, and it
    // has to stop the *journal* posting further down, not just this row:
    // swallowing the duplicate here would let postPaymentJournal run a second
    // time and book the same revenue twice.
    await conn.query(
      `INSERT INTO payments
         (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method,
          transaction_id, is_installment, course_expected, branch, branch_id, tenant_id, note, source, date, status, created_at)
       VALUES (?,?,?,?,?,?,'COURSE','online_paymob',?,0,?,?,?,?,?,'paymob',NOW(),'paid',NOW())`,
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
    // A card payment leaves the same trail as one entered by hand. This path
    // wrote none, so the only online payment the institute has ever taken had
    // no audit row against it — the actor is the provider rather than a person,
    // which is exactly the case an audit trail exists to record.
    await logPaymentAudit(payId, 'create', null, 'paid', order.amount, sub?.id || null,
      'paymob', tenantId, conn, true);

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

    // Enqueued inside the transaction, so the job is as durable as the payment
    // that owes it: roll back and it disappears with the payment, commit and it
    // is guaranteed to run. This used to be a setImmediate after the commit
    // whose catch only logged — a deadlock or a restart there lost the sales
    // rep's commission with nothing to retry it and no record that it was owed.
    if (sub?.id && Number(order.amount) > 0) {
      await enqueueFinanceEvent({
        tenantId,
        eventType: 'record_commission',
        refType: 'payment',
        refId: payId,
        payload: {
          paymentId: payId,
          subscriberId: sub.id,
          amount: Number(order.amount),
          branchId: order.branch_id || null,
        },
      }, conn);
    }

    await conn.commit();
    awardPointsForPayment({
      id: payId,
      subscriberId: sub?.id || null,
      amount: order.amount,
      currency: order.currency || 'EGP',
      tenantId,
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

  // Post-commit side effects (non-critical, do not block the response).
  // Commission is NOT here any more: it is queued inside the transaction above
  // and run by the finance outbox worker, so a failure retries instead of being
  // lost to a warning line. See lib/commissionCalc.js.
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
    sendWhatsApp(adminPhone.replace(/\D/g, ''), msg, { tenantId, category: 'staff_alert' }).catch(() => {});
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
          // The lead this finds is marked converted below, so a loose match
          // closes a stranger's lead on someone else's payment. See
          // lib/leadMatching.js for what the previous tail match could return.
          const found = await findLeadByContact(pool, {
            tenantId: subTenantId, phone: subRow.phone, email: subRow.email,
          });
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

  // The receipt, the same one every paid payment gets (lib/paymentReceipt.js).
  queuePaymentReceipt(tenantId, payId);

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
    const totalWhere = appendTenantScope(
      'WHERE subscriber_id = ? AND amount > 0 AND deleted_at IS NULL', '', tenantId, totalParams);
    const [[totals]] = await db.query(
      `SELECT COALESCE(SUM(amount_egp),0) AS total FROM payments ${totalWhere}`,
      totalParams
    );
    const total = Number(Number(totals?.total || 0).toFixed(2));
    if (!total) return;
    // Find linked lead — first try direct lead_id link, then phone/email match
    let leadId = sub.lead_id;
    if (!leadId && (sub.phone || sub.email)) {
      // `total` is written onto this lead's deal_value below. Matching on the
      // last 9 digits meant that figure could land on a different customer's
      // lead — lib/leadMatching.js matches the number itself.
      const found = await findLeadByContact(db, {
        tenantId, phone: sub.phone, email: sub.email,
      });
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

module.exports = { finalisePaymobOrder, syncLeadDealValue };
