'use strict';
/**
 * Delete or correct a payment — managers only (lib/paymentCorrections.js).
 *
 *   DELETE /api/admin/payments/:id   { reason }
 *   PATCH  /api/admin/payments/:id   { reason, amount?, currency?, courseId?, courseExpected?,
 *                                      paymentMethod?, date?, note?, transactionId? }
 *
 * A new amount, currency or course is recorded as the corrected payment
 * through the ordinary path, then the old one is voided; a changed currency
 * needs the amount entered again in it.
 */
const { signerName } = require('../lib/staffNames');
const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'payment-corrections' });
const { pool } = require('../lib/db');
const { canCorrectPayments, voidPayment, editPaymentDetails } = require('../lib/paymentCorrections');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');

const actorOf = req => signerName(req);

function managersOnly(req, res, next) {
  if (canCorrectPayments(req)) return next();
  return res.status(403).json({ error: 'تعديل ومسح الدفعات للمدير بس', code: 'MANAGER_ONLY' });
}

function fail(res, error, where) {
  const status = error?.statusCode || error?.status;
  if (status && status < 500) return res.status(status).json({ error: error.message, code: error.code });
  logger.error(where, error);
  return res.status(500).json({ error: 'Internal server error' });
}

async function inTransaction(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally { conn.release(); }
}

// The payments page lists website orders by the order's id; a confirmed order's
// money is the payments row it produced, found the way PATCH /admin/orders finds it.
async function paymentIdFor(conn, tenantId, id) {
  const [[direct]] = await conn.query('SELECT id FROM payments WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [id, tenantId]);
  if (direct) return direct.id;
  const [[order]] = await conn.query('SELECT transaction_id FROM orders WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [id, tenantId]);
  if (!order?.transaction_id) return id;
  const [[twin]] = await conn.query(
    `SELECT id FROM payments WHERE tenant_id=? AND deleted_at IS NULL AND (id=? OR transaction_id=?)
      ORDER BY created_at DESC LIMIT 1`, [tenantId, order.transaction_id, order.transaction_id]);
  return twin ? twin.id : id;
}

router.delete('/api/admin/payments/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), managersOnly, async (req, res) => {
  try {
    const result = await inTransaction(async conn => {
      const paymentId = await paymentIdFor(conn, req.tenantId, req.params.id);
      const voided = await voidPayment(conn, { tenantId: req.tenantId, paymentId, actor: actorOf(req), reason: req.body?.reason });
      if (paymentId !== req.params.id) {
        await conn.query('UPDATE orders SET deleted_at=NOW() WHERE id=? AND tenant_id=? AND deleted_at IS NULL', [req.params.id, req.tenantId]);
      }
      return voided;
    });
    res.json({ ok: true, ...result });
  } catch (error) { fail(res, error, '[payments void]'); }
});

router.patch('/api/admin/payments/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), managersOnly, async (req, res) => {
  try {
    const body = req.body || {};
    const reason = String(body.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'اكتب سبب التعديل', code: 'REASON_REQUIRED' });
    const [[pay]] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method, date, note,
              transaction_id, status, staff_id, is_installment, course_expected, branch, source, cert_type, certificate_request_id, item_title
         FROM payments WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1`, [req.params.id, req.tenantId]);
    if (!pay) return res.status(404).json({ error: 'الدفعة مش موجودة', code: 'NOT_FOUND' });

    const currency = body.currency ? String(body.currency).toUpperCase() : pay.currency;
    const currencyChanged = currency !== pay.currency;
    const amount = body.amount !== undefined && body.amount !== '' ? Number(body.amount) : Number(pay.amount);
    if (currencyChanged && (body.amount === undefined || body.amount === '')) {
      return res.status(400).json({ error: 'غيّرت العملة — اكتب المبلغ المدفوع بالعملة الجديدة', code: 'AMOUNT_REQUIRED' });
    }
    const target = body.courseId === undefined ? null : String(body.courseId || '');
    const bundleId = target && target.startsWith('bundle:') ? target.slice(7) : (target === null ? pay.bundle_id : null);
    const courseId = target && !target.startsWith('bundle:') ? target : (target === null ? pay.course_id : null);
    const moneyChanged = currencyChanged || Math.abs(amount - Number(pay.amount)) > 0.001
      || (courseId || null) !== (pay.course_id || null) || (bundleId || null) !== (pay.bundle_id || null);

    if (!moneyChanged) {
      const result = await inTransaction(conn => editPaymentDetails(conn, {
        tenantId: req.tenantId, paymentId: pay.id, actor: actorOf(req), reason,
        changes: { paymentMethod: body.paymentMethod, date: body.date, note: body.note, transactionId: body.transactionId },
      }));
      return res.json({ ok: true, mode: 'edited', ...result });
    }

    // A different payment: recorded the way every payment is, then the old one voided.
    const keepsTxn = Boolean(pay.transaction_id) && (body.transactionId === undefined || body.transactionId === pay.transaction_id);
    const sameItemSamePrice = !currencyChanged && (courseId || null) === (pay.course_id || null) && (bundleId || null) === (pay.bundle_id || null);
    const expected = body.courseExpected !== undefined && body.courseExpected !== ''
      ? Number(body.courseExpected)
      : (sameItemSamePrice && pay.course_expected != null ? Number(pay.course_expected) : undefined);
    const payment = {
      amount, currency,
      paymentType: String(pay.payment_type || 'OTHER').toLowerCase(),
      courseId: courseId || undefined, bundleId: bundleId || undefined,
      paymentMethod: body.paymentMethod !== undefined ? body.paymentMethod : pay.payment_method,
      // A transaction number is unique: the old row holds it until it is voided, then it moves (below).
      transactionId: keepsTxn ? undefined : (body.transactionId || undefined),
      date: body.date || String(pay.date instanceof Date ? pay.date.toISOString() : pay.date).slice(0, 10),
      note: [body.note !== undefined ? body.note : pay.note, `تصحيح لدفعة ${pay.id}: ${reason}`].filter(Boolean).join(' | ').slice(0, 2000),
      isInstallment: Boolean(pay.is_installment),
      ...(expected !== undefined ? { courseExpected: expected } : {}),
      staffId: pay.staff_id || undefined,
      status: String(pay.status || 'paid').toLowerCase() === 'pending' ? 'pending' : 'paid',
      branch: pay.branch || undefined,
      certType: pay.cert_type || undefined,
      itemTitle: pay.item_title || undefined,
    };
    const captured = { statusCode: 200, body: null };
    const fakeRes = {
      status(code) { captured.statusCode = code; return this; },
      json(payload) { captured.body = payload; return this; },
      set() { return this; },
    };
    const recorder = require('./subscriber-payments').recordSubscriberPayment;
    // Inherits the request (auth, tenant, staff, req.get) with the corrected payment as its body.
    const asRecording = Object.create(req);
    asRecording.body = { subscriber_id: pay.subscriber_id, payment };
    await recorder(asRecording, fakeRes);
    if (captured.statusCode >= 400 || !captured.body) {
      return res.status(captured.statusCode || 500).json(captured.body || { error: 'تعذر تسجيل الدفعة المصححة' });
    }
    const newId = captured.body.id || null;
    try {
      await inTransaction(async conn => {
        await voidPayment(conn, { tenantId: req.tenantId, paymentId: pay.id, actor: actorOf(req), reason: `اتعدّلت: ${reason}` });
        if (keepsTxn && newId) {
          await conn.query('UPDATE payments SET transaction_id=NULL WHERE id=? AND tenant_id=?', [pay.id, req.tenantId]);
          await conn.query('UPDATE payments SET transaction_id=? WHERE id=? AND tenant_id=?', [pay.transaction_id, newId, req.tenantId]);
        }
      });
    } catch (error) {
      // The old one could not be voided: undo the new one rather than leave both.
      if (newId) {
        await inTransaction(conn => voidPayment(conn, {
          tenantId: req.tenantId, paymentId: newId, actor: actorOf(req), reason: 'تراجع عن تعديل ما كملش',
        })).catch(undo => logger.error('[payments correct] could not undo the new payment', undo));
      }
      throw error;
    }
    res.json({ ok: true, mode: 'replaced', oldId: pay.id, newId, result: captured.body });
  } catch (error) { fail(res, error, '[payments correct]'); }
});

module.exports = router;
