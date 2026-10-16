'use strict';

const { signerName } = require('../../lib/staffNames');
const express = require('express');
const router = express.Router();
const logger = require('../../lib/logger');
const { pool } = require('../../lib/db');
const { isItemPaymentType } = require('../../lib/agreedPrice');
const { queuePaymentReceipt } = require('../../lib/paymentReceipt');
const { logPaymentAudit, postPaymentJournal } = require('../../lib/finance');
const { ensureFreshFx, fxStaleError } = require('../../lib/fxRefresh');
const { recordPaymentCompensation } = require('../../lib/paymentCompensation');
const { assertWritable } = require('../../lib/periodLock');
const { convertLeadOfPayment } = require('../../lib/leadState');
const { enqueueFinanceEvent } = require('../../lib/financeOutbox');
const { applyCertificatePayment } = require('../../lib/certificatePayments');
const { grantCourseEntitlement } = require('../../lib/entitlements');
const { financialRecordMatches, resolveFinancialScope } = require('../../lib/financialScope');
const { resolvePaymentAccess, accessModeOf, paidRatioOf } = require('../../lib/paymentEntitlementAccess');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { deleteTransfer, importTransfers, isCashMethod, linkTransfer, recordTransfer, updateTransfer } = require('../../lib/incomingTransfers');
const { hasReason, notifyPaymentRejected, reasonOf, REASON_REQUIRED } = require('../../lib/paymentRejection');
const { writeAuditEvent } = require('../../lib/auditTrail');
const { getTenantSetting, setTenantSetting } = require('../../lib/tenantSettings');
const { groupAccounts, loadAccounts, mergeAccounts } = require('../../lib/transferAccounts');
const { mustLinkTransfer, TRANSFER_REQUIRED } = require('../../lib/paymentApprovalPolicy');

// This is the only manual status transition endpoint for an existing payment.
// Refunds are deliberately handled by the refund workflow because they require
// approval and a reversing journal entry.
router.patch('/api/admin/payments/:id/status', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { id } = req.params;
    const { status, reviewNote } = req.body || {};
    const scope = resolveFinancialScope(req, { requestedBranch: req.body.branch || null });
    if (!['paid', 'failed', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'الحالة دي غير صحيحة — الاسترداد له مسار خاص (طلب استرداد).', code: 'PAYMENT_STATUS_INVALID' });
    }
    if (String(reviewNote || '').length > 2000) return res.status(400).json({ error: 'ملاحظة المراجعة أطول من المسموح (2000 حرف).', code: 'REVIEW_NOTE_TOO_LONG' });
    // A rejection is explained: the reason is asked for, kept on the payment and
    // sent to whoever took it (lib/paymentRejection.js).
    const rejectionReason = status === 'failed' ? reasonOf(reviewNote, req.body?.reason) : '';
    if (status === 'failed' && !hasReason(rejectionReason)) return res.status(REASON_REQUIRED.status).json(REASON_REQUIRED.body);
    const tenantId = req.tenantId;
    const actor = req.user?.email || req.user?.uid || 'admin';
    await conn.beginTransaction();
    transactionStarted = true;
    const [[payment]] = await conn.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency, payment_type,
              payment_method, transaction_id, is_installment, course_expected, \`date\`,
              note, status, staff_id, staff_name, branch_id, source, item_title, cert_type,
              certificate_request_id
       FROM payments
       WHERE id=? AND tenant_id=? AND deleted_at IS NULL FOR UPDATE`,
      [id, tenantId]
    );
    if (!payment) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'الدفعة دي مش موجودة — يمكن اتحذفت، حدّث الصفحة.', code: 'PAYMENT_NOT_FOUND' });
    }
    if (!financialRecordMatches(scope, payment)) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(403).json({ error: 'الدفعة دي خارج نطاق صلاحياتك المالية (فرع أو موظف تاني).', code: 'PAYMENT_OUT_OF_SCOPE' });
    }
    await assertWritable(payment.date, conn, tenantId);
    const oldStatus = payment.status || 'pending';
    if (oldStatus === 'refunded') {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'الدفعة دي مستردّة ومينفعش تتعدّل.', code: 'PAYMENT_REFUNDED' });
    }
    if (oldStatus === 'paid' && status !== 'paid') {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'الدفعة دي مدفوعة بالفعل — لتغييرها استخدم التصحيح أو الاسترداد.', code: 'PAYMENT_ALREADY_PAID' });
    }
    if (oldStatus === status) {
      await conn.commit(); transactionStarted = false;
      return res.json({ ok: true, id, status, unchanged: true });
    }

    const becomingPaid = status === 'paid';
    // Approving is the other way a payment reaches paid, and it is the moment
    // the accounts team says the money arrived — so it is where the method has
    // to be known. Recording one already refuses to settle without it; without
    // the same rule here a pending row with no method would simply be approved
    // into the same unreconcilable state (see subscriber-payments.js).
    //
    // Nothing can edit a stored method, so an approver who finds one missing is
    // asked for it here rather than being left with a row they cannot approve.
    const suppliedMethod = String(req.body.paymentMethod || req.body.payment_method || '').trim().slice(0, 100);
    const settledMethod = String(payment.payment_method || '').trim() || suppliedMethod;
    if (becomingPaid && !settledMethod) {
      await conn.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'لازم تحدد طريقة الدفع قبل ما تأكد السداد. من غيرها مش هيبقى معروف الفلوس وصلت إزاي.' });
    }
    if (becomingPaid) {
      // Confirming money is somebody else's job than recording it. A collection
      // officer approves nobody's — the manager does — and nobody approves a
      // payment they recorded themselves.
      const approverRole = String(req.staffRecord?.role || '').toLowerCase();
      if (!req.isSuperAdmin && approverRole === 'collection') {
        await conn.rollback(); transactionStarted = false;
        return res.status(403).json({ error: 'اعتماد المدفوعات شغل المسئول', code: 'COLLECTION_CANNOT_APPROVE' });
      }
      if (!req.isSuperAdmin && payment.staff_id && String(payment.staff_id) === String(req.staffRecord?.id || '')) {
        await conn.rollback(); transactionStarted = false;
        return res.status(403).json({ error: 'مينفعش تعتمد دفعة انت اللي سجلتها', code: 'PAYMENT_SELF_APPROVAL' });
      }
      // A collection booking is confirmed against the transfer that brought
      // it: «يتاكد من المدفوعات ويربطه بتحويل».
      const [[recorder]] = payment.staff_id
        ? await conn.query('SELECT role FROM staff WHERE tenant_id=? AND id=? LIMIT 1', [tenantId, payment.staff_id])
        : [[null]];
      const transfer = req.body?.transfer && typeof req.body.transfer === 'object' ? req.body.transfer : null;
      if (String(recorder?.role || '').toLowerCase() === 'collection' && !transfer && !isCashMethod(settledMethod)) {
        await conn.rollback(); transactionStarted = false;
        return res.status(400).json({ error: 'اربط الدفعة بالتحويل اللي وصل قبل الاعتماد', code: 'TRANSFER_REQUIRED' });
      }
      // The manager accepts; anyone else ties the payment to the transfer that
      // brought it (cash excepted) — see lib/paymentApprovalPolicy.js.
      if (!transfer && mustLinkTransfer(req, settledMethod)) {
        await conn.rollback(); transactionStarted = false;
        return res.status(TRANSFER_REQUIRED.status).json(TRANSFER_REQUIRED.body);
      }
      if (transfer) {
        await linkTransfer(conn, {
          tenantId, paymentId: id, link: transfer,
          actor: { id: req.staffRecord?.id, name: signerName(req) },
        });
      }
      const rawAmount = Number(payment.amount) || 0;
      if (rawAmount <= 0) throw new Error('Paid payment must have a positive amount');
      const fx = await ensureFreshFx(tenantId, payment.currency);
      if (!fx.usable) {
        await conn.rollback(); transactionStarted = false;
        const stale = fxStaleError(payment.currency, fx.snapshot);
        return res.status(stale.statusCode).json({ error: stale.message, code: stale.code });
      }
      const journalId = await postPaymentJournal({
        paymentId: id, amount: rawAmount, currency: payment.currency, payType: payment.payment_type,
        // Passed as it came out of the row. payments.date is DATETIME, so this
        // is a Date, and slicing its string form gave «Wed Jul 15» — which the
        // journal rejected, making every approval answer 500. postPaymentJournal
        // normalises whichever form it is handed.
        date: payment.date || new Date(), actor, tenantId,
      }, conn);
      if (!journalId) throw new Error('Payment journal posting failed');
    }

    await conn.query(
      `UPDATE payments
       SET status=?, payment_method=?, note=CASE WHEN ?='' THEN note
         ELSE CONCAT(COALESCE(note,''),IF(COALESCE(note,'')='','',' | '),'Review: ',?) END
       WHERE id=? AND tenant_id=? AND deleted_at IS NULL`,
      [status, settledMethod || payment.payment_method || null,
        String(rejectionReason || reviewNote || ''), String(rejectionReason || reviewNote || ''), id, tenantId]
    );

    if (becomingPaid && payment.subscriber_id) {
      const courseIds = [];
      // Only course money opens a course: a carnet names one and is not it.
      const opensItem = isItemPaymentType(payment.payment_type);
      if (opensItem && payment.course_id) courseIds.push(payment.course_id);
      if (opensItem && payment.bundle_id) {
        const [bundleCourses] = await conn.query(
          `SELECT bc.course_id FROM bundle_courses bc
           JOIN bundles b ON b.id=bc.bundle_id AND b.tenant_id=bc.tenant_id
           WHERE bc.tenant_id=? AND bc.bundle_id=?`,
          [tenantId, payment.bundle_id]
        );
        courseIds.push(...bundleCourses.map(row => row.course_id));
      }
      for (const courseId of [...new Set(courseIds)]) {
        let accessType = 'full';
        let paidRatio = null;
        // A pending booking approved for less than its price opens its first payment's videos, like an instalment.
        if (Number(payment.course_expected) > 0) {
          const resolved = await resolvePaymentAccess({
            db: conn,
            tenantId,
            subscriberId: payment.subscriber_id,
            courseId: payment.course_id || null,
            bundleId: payment.bundle_id || null,
            currentPaymentId: id,
            currentAmount: payment.amount,
            currency: payment.currency,
            expectedAmount: payment.course_expected,
            lenient: !payment.is_installment,
          });
          accessType = accessModeOf(resolved);
          paidRatio = paidRatioOf(resolved);
        }
        await grantCourseEntitlement({
          tenantId, subscriberId: payment.subscriber_id, courseId,
          bundleId: payment.bundle_id || null, accessType,
          // Was a flat 2 lectures for anyone short of the full price, so 90%
          // paid and 6% paid opened the same two. The ratio sizes it instead;
          // lectureLimit stays null so grantCourseEntitlement derives it from
          // the course's own published count.
          lectureLimit: null,
          paidRatio,
          branchId: payment.branch_id || 'branch-other',
          source: 'payment_status_review', actor,
        }, conn);
      }
      await conn.query(
        `UPDATE subscribers SET is_active=1, updated_at=NOW()
         WHERE id=? AND tenant_id=?`,
        [payment.subscriber_id, tenantId]
      );
      if (String(payment.payment_type || '').toUpperCase() === 'CERTIFICATE') {
        await applyCertificatePayment(payment, conn, tenantId);
      }

      const [[subscriber]] = await conn.query(
        'SELECT assigned_sales_id, lead_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1',
        [payment.subscriber_id, tenantId]
      );
      // The same commission the other path pays.
      //
      // Approving a pending payment used to compute its own: it read
      // staff.commission_rate directly and never consulted commission_rules,
      // so a role on a 5% rule whose staff row said 10 earned double here than
      // it would have on a payment recorded as paid outright. It also filed the
      // row under the server clock's month rather than the payment's own date,
      // so a payment dated 30 September approved on 1 October landed in
      // October and missed the September payroll run that pays it. And it never
      // wrote the instructor's share at all.
      //
      // recordPaymentCompensation is that rule, and it is now the only copy.
      await recordPaymentCompensation({
        paymentId: id,
        tenantId,
        commissionStaffId: payment.staff_id || subscriber?.assigned_sales_id || null,
        actor,
      }, conn);
      if (subscriber?.lead_id) {
        await convertLeadOfPayment({
          tenantId,
          leadId: subscriber.lead_id,
          db: conn,
          actor,
          reason: 'Lead converted after manual payment approval',
          metadata: { subscriberId: payment.subscriber_id, paymentId: id },
        });
      }
      await enqueueFinanceEvent({
        tenantId,
        eventType: 'sync_lead_deal_value',
        refType: 'payment',
        refId: id,
        payload: { subscriberId: payment.subscriber_id },
      }, conn);
    }

    await conn.query(
      `UPDATE orders SET status=?, updated_at=NOW()
       WHERE (id=? OR transaction_id=?) AND tenant_id=? AND deleted_at IS NULL
         AND branch_id <=> ?`,
      [status, id, payment.transaction_id || id, tenantId, payment.branch_id || null]
    );
    await logPaymentAudit(id, 'update', oldStatus, status, payment.amount, payment.subscriber_id, actor, tenantId, conn, true);
    await conn.commit();
    transactionStarted = false;

    if (becomingPaid && payment.subscriber_id) {
      // Recorded pending and approved now: the client heard nothing before.
      queuePaymentReceipt(tenantId, id);
      setImmediate(async () => {
        try {
          const [[subscriber]] = await pool.query(
            'SELECT phone FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1',
            [payment.subscriber_id, tenantId]
          );
          // Queued, one per payment: retried by the outbox, not lost here.
          const recipient = require('../../lib/phoneNumber').toDialable(subscriber?.phone);
          if (recipient) {
            await require('../../lib/outbox').enqueue({
              channel: 'whatsapp', recipient, tenantId, refType: 'payment', refId: id,
              dedupeKey: `payment-confirmed-wa:${id}`,
              payload: { message: `✅ تم تأكيد دفعتك: ${payment.amount} ${payment.currency || 'EGP'} — معهد الدراسات النفسية`, category: 'payment' },
            });
          }
        } catch (error) {
          logger.warn('[patch-payment] confirmation notification failed:', error.message);
        }
      });
    }
    if (status === 'failed') {
      // Told after the rejection is committed; whoever took the payment learns why (lib/paymentRejection.js).
      const [[client]] = payment.subscriber_id
        ? await pool.query('SELECT name, client_code, assigned_sales_id, assigned_cs_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [payment.subscriber_id, tenantId])
        : [[null]];
      await notifyPaymentRejected({
        tenantId, reason: rejectionReason, amount: payment.amount, currency: payment.currency,
        clientName: client?.name, clientCode: client?.client_code, subscriberId: payment.subscriber_id,
        recordedBy: payment.staff_id, assignedSalesId: client?.assigned_sales_id, assignedCsId: client?.assigned_cs_id,
        rejectedBy: req.staffRecord?.id, rejectedByName: req.staffRecord?.name || signerName(req),
      });
    }
    res.json({ ok: true, id, status });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[patch-payment]', error.message);
    const statusCode = error.statusCode || error.status || 500;
    res.status(statusCode).json({ error: statusCode < 500 ? error.message : 'Internal server error' });
  } finally {
    conn.release();
  }
});

// ── Incoming transfers — what arrived, and which payment each one confirmed ──

// The transfers on the ledger; ?unlinked=1 for the ones still free to confirm a payment.
router.get('/api/admin/incoming-transfers', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const unlinked = String(req.query.unlinked || '') === '1';
    const [rows] = await pool.query(
      `SELECT t.id, t.amount, t.currency, t.method, t.reference, t.sender_name, t.sender_phone, t.received_on,
              t.note, t.recorded_by_name, t.payment_id, t.linked_at, t.created_at, s.name AS customer_name,
              t.parent_transfer_id, t.original_amount, p.amount AS payment_amount
         FROM incoming_transfers t
         LEFT JOIN payments p ON p.id=t.payment_id AND p.tenant_id=t.tenant_id
         LEFT JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=t.tenant_id
        WHERE t.tenant_id=?${unlinked ? ' AND t.payment_id IS NULL' : ''}
        ORDER BY t.received_on DESC, t.created_at DESC LIMIT 3000`, [req.tenantId]);
    res.json(rows.map(row => ({
      id: row.id, amount: Number(row.amount) || 0, currency: row.currency, method: row.method, reference: row.reference,
      senderName: row.sender_name, senderPhone: row.sender_phone, receivedOn: row.received_on, note: row.note,
      recordedByName: row.recorded_by_name, paymentId: row.payment_id, linkedAt: row.linked_at,
      customerName: row.customer_name || null, createdAt: row.created_at,
      // «باقي ربط من تحويل 3,000»: a remainder, and what the whole transfer was.
      parentTransferId: row.parent_transfer_id || null,
      originalAmount: row.original_amount != null ? Number(row.original_amount) : null,
      paymentAmount: row.payment_amount != null ? Number(row.payment_amount) : null,
    })));
  } catch (error) {
    logger.error('[incoming-transfers/list]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Record a transfer as it arrived, before (or without) a payment to confirm.
router.post('/api/admin/incoming-transfers', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    if (!req.isSuperAdmin && String(req.staffRecord?.role || '').toLowerCase() === 'collection') {
      return res.status(403).json({ error: 'تسجيل التحويلات الواردة شغل المسئول' });
    }
    const aliases = await accountAliases(req.tenantId);
    const id = await recordTransfer(pool, {
      tenantId: req.tenantId, transfer: { ...(req.body || {}), method: renamed(aliases, req.body?.method) },
      actor: { id: req.staffRecord?.id, name: signerName(req) },
    });
    res.json({ ok: true, id });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) logger.error('[incoming-transfers/create]', error.message);
    res.status(statusCode).json({ error: statusCode < 500 ? error.message : 'Internal server error' });
  }
});

// The names an account has been merged away from, and the name it now goes by: a transfer typed in or
// imported under an old name lands on the account it was merged into (see merge-accounts below).
async function accountAliases(tenantId) {
  const aliases = await getTenantSetting('transfer_account_aliases', { tenantId, fallback: {} }).catch(() => ({}));
  return aliases && typeof aliases === 'object' ? aliases : {};
}
const renamed = (aliases, method) => aliases[String(method || '').trim()] || method;

// The managers' correction of a transfer somebody entered wrong: the old values
// go to the audit trail (lib/incomingTransfers.js updateTransfer / deleteTransfer).
const managesTransfers = req => req.isSuperAdmin || ['admin', 'manager'].includes(String(req.staffRecord?.role || '').toLowerCase());
router.put('/api/admin/incoming-transfers/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  if (!managesTransfers(req)) return res.status(403).json({ error: 'تعديل التحويلات للمديرين', code: 'MANAGERS_ONLY' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const before = await updateTransfer(conn, { tenantId: req.tenantId, transferId: req.params.id, transfer: req.body || {} });
    await writeAuditEvent({ action: 'incoming_transfer.updated', entityType: 'incoming_transfer', entityId: req.params.id, metadata: { before, by: signerName(req) }, req, db: conn });
    await conn.commit();
    res.json({ ok: true, linked: Boolean(before.payment_id) });
  } catch (error) {
    await conn.rollback().catch(() => {});
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) logger.error('[incoming-transfers/update]', error.message);
    res.status(statusCode).json({ error: statusCode < 500 ? error.message : 'Internal server error', code: error.code });
  } finally { conn.release(); }
});
router.delete('/api/admin/incoming-transfers/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  if (!managesTransfers(req)) return res.status(403).json({ error: 'حذف التحويلات للمديرين', code: 'MANAGERS_ONLY' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const before = await deleteTransfer(conn, { tenantId: req.tenantId, transferId: req.params.id });
    await writeAuditEvent({ action: 'incoming_transfer.deleted', entityType: 'incoming_transfer', entityId: req.params.id, severity: 'warning', metadata: { before, by: signerName(req) }, req, db: conn });
    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback().catch(() => {});
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) logger.error('[incoming-transfers/delete]', error.message);
    res.status(statusCode).json({ error: statusCode < 500 ? error.message : 'Internal server error', code: error.code });
  } finally { conn.release(); }
});

// «رفع ملف التحويلات»: the accounts team's sheet, read on the screen (shared/transferSheet.ts).
router.post('/api/admin/incoming-transfers/import', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    if (!req.isSuperAdmin && String(req.staffRecord?.role || '').toLowerCase() === 'collection') {
      return res.status(403).json({ error: 'تسجيل التحويلات الواردة شغل المسئول' });
    }
    const aliases = await accountAliases(req.tenantId);
    const result = await importTransfers(pool, {
      tenantId: req.tenantId,
      transfers: Array.isArray(req.body?.transfers) ? req.body.transfers.map(row => ({ ...row, method: renamed(aliases, row?.method) })) : req.body?.transfers,
      actor: { id: req.staffRecord?.id, name: signerName(req) },
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) logger.error('[incoming-transfers/import]', error.message);
    res.status(statusCode).json({ error: statusCode < 500 ? error.message : 'Internal server error' });
  }
});

// «في حساب 1010 وحساب 1079 دول حساب واحد … وحسابين 4645»: the ledger's accounts, which of them are one
// account (lib/transferAccounts.js), and the one-click merge onto the account the settings list knows.
router.get('/api/admin/incoming-transfers/accounts', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  if (!managesTransfers(req)) return res.status(403).json({ error: 'دمج الحسابات للمديرين', code: 'MANAGERS_ONLY' });
  try {
    const content = await getTenantSetting('content', { tenantId: req.tenantId, fallback: {} });
    const registered = String(content['finance.payment_methods'] || '').split('||').map(name => name.trim()).filter(Boolean);
    const { accounts, sheets } = await loadAccounts(pool, req.tenantId);
    const groups = groupAccounts(accounts, { sheets, registered });
    res.json({
      registered,
      accounts: accounts.map(account => ({ ...account, registered: registered.includes(account.name) })).sort((a, b) => b.rows - a.rows),
      groups,
    });
  } catch (error) {
    logger.error('[incoming-transfers/accounts]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/incoming-transfers/merge-accounts', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  if (!managesTransfers(req)) return res.status(403).json({ error: 'دمج الحسابات للمديرين', code: 'MANAGERS_ONLY' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await mergeAccounts(conn, { tenantId: req.tenantId, from: req.body?.from, to: req.body?.to });
    await writeAuditEvent({
      action: 'incoming_transfer.accounts_merged', entityType: 'incoming_transfer', entityId: result.target, severity: 'warning',
      metadata: { from: req.body?.from, to: result.target, moved: result.moved, left: result.stuck.length, by: signerName(req) }, req, db: conn,
    });
    await conn.commit();
    // Remember it, so the old name typed or imported later goes to the same account.
    const aliases = await accountAliases(req.tenantId);
    for (const name of new Set((req.body?.from || []).map(item => String(item || '').trim()))) {
      if (name && name !== result.target) aliases[name] = result.target;
    }
    await setTenantSetting('transfer_account_aliases', aliases, { tenantId: req.tenantId, actorId: req.staffRecord?.id || req.user?.uid || null });
    res.json({ ok: true, ...result });
  } catch (error) {
    await conn.rollback().catch(() => {});
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) logger.error('[incoming-transfers/merge-accounts]', error.message);
    res.status(statusCode).json({ error: statusCode < 500 ? error.message : 'Internal server error' });
  } finally { conn.release(); }
});

module.exports = router;
