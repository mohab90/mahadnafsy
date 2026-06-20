'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { sendEmail } = require('../lib/email');
const { sendWhatsApp } = require('../lib/whatsapp');
const { tryJson } = require('../lib/helpers');
const { paymobLimiter } = require('../middleware/rateLimits');
const { postPaymentJournal } = require('../lib/finance');

// ── Paymob: SUSPENDED — account currently inactive ───────────────────────────
// All Paymob endpoints return 503 until the account is reactivated.
router.post('/api/payments/paymob-init', (req, res) => {
  res.status(503).json({ error: 'الدفع الإلكتروني غير متاح حالياً — يرجى التواصل مع الإدارة عبر واتساب.' });
});

// ── Paymob: reserve pending order before payment (client calls this before iframe) ─────────
// No auth required — consultations and certificates don't require login.
router.post('/api/orders/reserve', async (req, res) => {
  try {
    const {
      orderId, type, itemId, itemTitle, amount, currency, paymentMethod,
      customerEmail, customerName, customerPhone, bundleCourseIds,
      consultationData, extraCertRequestId, subscriberEmail, isInstallment, installmentLimit,
    } = req.body || {};
    if (!orderId || !type || !amount) return res.status(400).json({ error: 'Missing orderId, type, or amount' });
    const extra = JSON.stringify({ bundleCourseIds, consultationData, extraCertRequestId, subscriberEmail, isInstallment, installmentLimit });
    await pool.query(
      `INSERT INTO orders (id, item_id, item_title, type, status, amount, currency,
         payment_method, customer_name, customer_email, customer_phone, notes, created_at)
       VALUES (?,?,?,?,'pending',?,?,?,?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE status='pending', notes=VALUES(notes)`,
      [orderId, itemId||'', itemTitle||'', type, amount, currency||'EGP',
       paymentMethod||'', customerName||'', customerEmail||'', customerPhone||'', extra]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[orders/reserve]', e.message); logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
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
     course_id, bundle_id, notes, staff_id, staff_name, created_at, paid_at
     FROM orders WHERE id = ? LIMIT 1`, [merchantOrderId]);
  if (!order) { logger.warn(`[paymob] Order not found: ${merchantOrderId}`); return { found: false }; }
  if (order.status === 'paid') return { found: true, alreadyProcessed: true };

  // Additional idempotency check: if transactionId already in payments table, skip
  if (transactionId) {
    const [[existingPay]] = await pool.query(
      'SELECT id FROM payments WHERE transaction_id = ? LIMIT 1', [transactionId]
    );
    if (existingPay) {
      logger.info(`[paymob] transactionId ${transactionId} already recorded — skipping`);
      return { found: true, alreadyProcessed: true };
    }
  }

  const extra = (() => { try { return JSON.parse(order.notes || '{}'); } catch { return {}; } })();

  const payId = `paymob-${merchantOrderId}`;
  const payCourseId = order.type === 'course' ? (order.item_id || null) : null;
  const payBundleId = order.type === 'bundle' ? (order.item_id || null) : null;

  // Find subscriber by email (read before transaction to avoid long lock)
  const [[sub]] = await pool.query(
    'SELECT id FROM subscribers WHERE email = ? LIMIT 1',
    [(order.customer_email || '').toLowerCase().trim()]
  );

  // ── Atomic transaction: mark order paid + enroll + record payment ──────────
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Mark order paid
    await conn.query("UPDATE orders SET status='paid', transaction_id=? WHERE id=?", [transactionId, merchantOrderId]);

    // 2. Auto-enroll subscriber for course or bundle payments
    if ((order.type === 'course' || order.type === 'bundle') && sub) {
      // SECURITY: always fetch bundle courses from DB — never trust client-supplied bundleCourseIds
      let courseIds;
      if (order.type === 'bundle') {
        const [[bundleRow]] = await conn.query(
          'SELECT course_ids_json FROM bundles WHERE id = ? LIMIT 1',
          [order.item_id]
        );
        const dbCourseIds = bundleRow ? tryJson(bundleRow.course_ids_json, []) : [];
        // Fall back to client-supplied list only if bundle row not found (data integrity fallback)
        courseIds = dbCourseIds.length ? dbCourseIds
          : (Array.isArray(extra.bundleCourseIds) ? extra.bundleCourseIds : [order.item_id]);
      } else {
        courseIds = [order.item_id];
      }
      for (const cid of courseIds) {
        await conn.query(
          `INSERT INTO enrollments (id, subscriber_id, course_id, enrolled_at, access_type)
           VALUES (?,?,?,NOW(),'full') ON DUPLICATE KEY UPDATE access_type='full'`,
          [uuidv4(), sub.id, cid]
        );
      }
      logger.info(`[paymob] Enrolled ${order.customer_email} in ${courseIds.join(',')} (order ${merchantOrderId})`);
    }

    // 3. Auto-create consultation record
    if (extra.consultationData) {
      const cd = extra.consultationData;
      await conn.query(
        `INSERT IGNORE INTO consultations
           (id, client_name, client_email, client_phone, therapist_id, therapist_name,
            session_type, session_date, status, amount, currency, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())`,
        [cd.id||uuidv4(), cd.clientName||'', cd.clientEmail||'', cd.clientPhone||'',
         cd.therapistId||'', cd.therapistName||'', cd.sessionType||'individual',
         cd.sessionDate||'', 'pending', order.amount, order.currency]
      );
    }

    // 4. Record in payments table (ON DUPLICATE KEY guards against double-webhook)
    await conn.query(
      `INSERT INTO payments
         (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method,
          transaction_id, is_installment, course_expected, note, date, status, created_at)
       VALUES (?,?,?,?,?,?,'COURSE','online_paymob',?,0,?,?,NOW(),'paid',NOW())
       ON DUPLICATE KEY UPDATE transaction_id=COALESCE(transaction_id, VALUES(transaction_id)), status='paid'`,
      [
        payId,
        sub?.id || null,
        payCourseId,
        payBundleId,
        order.amount,
        order.currency || 'EGP',
        transactionId || null,
        order.amount,   // course_expected = full order amount (what customer agreed to pay)
        `دفع إلكتروني Paymob — طلب ${merchantOrderId}${transactionId ? ' | معاملة ' + transactionId : ''}`
      ]
    );

    await conn.commit();
    logger.info(`[paymob] Transaction committed: order ${merchantOrderId}, payment ${payId}`);
    // Ledger-first: post the cash/revenue journal for this online payment (post-commit).
    postPaymentJournal({ paymentId: payId, amount: order.amount, currency: order.currency || 'EGP', payType: 'COURSE', actor: 'paymob' });
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
        const [[subRow]] = await pool.query('SELECT assigned_sales_id FROM subscribers WHERE id=? LIMIT 1', [sub.id]);
        const finalStaffId = subRow?.assigned_sales_id || null;
        if (!finalStaffId) return;
        const [[rule]] = await pool.query(`
          SELECT id, percentage_value FROM commission_rules
          WHERE is_active=1 AND calc_type='PERCENTAGE'
            AND (staff_id=? OR (staff_id IS NULL AND JSON_CONTAINS(COALESCE(apply_to_roles,'[]'), JSON_QUOTE((SELECT role FROM staff WHERE id=? LIMIT 1)))))
            AND effective_from <= CURDATE() AND (effective_to IS NULL OR effective_to >= CURDATE())
            AND (min_payment IS NULL OR min_payment <= ?)
          ORDER BY staff_id DESC, priority ASC LIMIT 1
        `, [finalStaffId, finalStaffId, Number(order.amount)]).catch(() => [[null]]);
        let commRate = rule?.percentage_value || 0;
        if (!commRate) {
          const [[stf]] = await pool.query('SELECT commission_rate FROM staff WHERE id=? LIMIT 1', [finalStaffId]).catch(() => [[null]]);
          commRate = stf?.commission_rate || 0;
        }
        if (commRate > 0) {
          const commAmount = parseFloat((Number(order.amount) * commRate / 100).toFixed(2));
          const now = new Date();
          await pool.query(
            `INSERT INTO crm_commissions (id, staff_id, payment_id, rule_id, client_id, client_type, payment_amount, commission_amount, calc_details, month, year, status, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,'PENDING',NOW()) ON DUPLICATE KEY UPDATE commission_amount=VALUES(commission_amount)`,
            [uuidv4(), finalStaffId, payId, rule?.id||null, sub.id, 'subscriber',
             Number(order.amount), commAmount,
             JSON.stringify({ rate: commRate, calc_type: 'PERCENTAGE', rule_id: rule?.id||null, trigger: 'paymob_payment' }),
             now.getMonth()+1, now.getFullYear()]
          );
          logger.info(`[paymob] Commission ${commAmount} (${commRate}%) → staff ${finalStaffId}`);
        }
      } catch (commErr) { logger.warn('[paymob] commission calc error:', commErr.message); }
    });
  }
  // Notify admin on new Paymob payment
  const adminPhone = process.env.ADMIN_WHATSAPP_PHONE;
  if (adminPhone) {
    const msg = `💳 دفعة أونلاين جديدة!\nالعميل: ${order.customer_name || order.customer_email || '—'}\nالمبلغ: ${order.amount} ${order.currency || 'EGP'}\nالطلب: ${merchantOrderId}`;
    sendWhatsApp(adminPhone.replace(/\D/g, ''), msg).catch(() => {});
  }
  // Auto-update lead deal_value and convert lead on successful payment
  if (sub?.id && order.amount > 0) {
    syncLeadDealValue(sub.id).catch(() => {});
    // Auto-convert matched lead to 'converted' on successful payment
    setImmediate(async () => {
      try {
        const [[subRow]] = await pool.query('SELECT lead_id, phone, email FROM subscribers WHERE id = ? LIMIT 1', [sub.id]);
        if (!subRow) return;
        let leadId = subRow.lead_id;
        if (!leadId && (subRow.phone || subRow.email)) {
          const normPhone = subRow.phone ? subRow.phone.replace(/\D/g, '').replace(/^(20|0020)?([0-9]{10})$/, '0$2') : null;
          const q = normPhone
            ? `SELECT id FROM leads WHERE (REGEXP_REPLACE(phone,'[^0-9]','') LIKE ? OR LOWER(email)=LOWER(?)) AND hidden=0 ORDER BY created_at DESC LIMIT 1`
            : 'SELECT id FROM leads WHERE LOWER(email)=LOWER(?) AND hidden=0 ORDER BY created_at DESC LIMIT 1';
          const params = normPhone ? [`%${normPhone.slice(-9)}`, subRow.email || ''] : [subRow.email];
          const [[found]] = await pool.query(q, params);
          leadId = found?.id || null;
        }
        if (leadId) {
          await pool.query("UPDATE leads SET status='converted' WHERE id=? AND LOWER(status) NOT IN ('converted','lost')", [leadId]);
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
        <p>يمكنك البدء في التعلم الآن من خلال <a href="https://mahadnafsy.com/dashboard" style="color:#7c3aed">لوحة التحكم</a>.</p>
        <p style="color:#9ca3af;font-size:12px">معهد نفسي — mahadnafsy.com</p>
      </div>`
    ).catch(e => logger.warn('[email] payment confirmation failed:', e.message));
  }

  return { found: true, alreadyProcessed: false };
}
// Lead deal-value sync now lives in lib/leadDealValue.js (single source of truth).
// Re-exported below so existing `require('./public-orders').syncLeadDealValue` callers keep working.
const { syncLeadDealValue } = require('../lib/leadDealValue');

// HMAC_FIELDS shared between redirect callback and webhook
const PAYMOB_HMAC_FIELDS = [
  'amount_cents','created_at','currency','error_occured','has_parent_transaction',
  'id','integration_id','is_3d_secure','is_auth','is_capture','is_refunded',
  'is_standalone_payment','is_voided','order','owner','pending',
  'source_data.pan','source_data.sub_type','source_data.type','success',
];

// ── Paymob: verify — SUSPENDED ──────────────────────────────────────────────
router.post('/api/paymob/verify', paymobLimiter, (req, res) => {
  res.status(503).json({ error: 'الدفع الإلكتروني غير متاح حالياً — يرجى التواصل مع الإدارة.', verified: false });
});

// ── Paymob: webhook — SUSPENDED ──────────────────────────────────────────────
router.post('/api/webhooks/paymob', paymobLimiter, (req, res) => {
  // Always respond 200 to Paymob to prevent retries, but do nothing
  res.status(200).json({ ok: false, reason: 'gateway_suspended' });
});


module.exports = router;
// Shared with admin-utils.js (refund flow re-syncs the lead's deal value)
module.exports.syncLeadDealValue = syncLeadDealValue;
