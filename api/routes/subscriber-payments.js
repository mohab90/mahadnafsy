'use strict';
const logger = require('../lib/logger');
const { createHash } = require('node:crypto');
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');
const { pool, autoAssignStaff } = require('../lib/db');
const { mailer, sendEmail: sendEmailBase, htmlEmail } = require('../lib/email');
const { sendWhatsApp } = require('../lib/whatsapp');
const { sanitize } = require('../lib/helpers');
const { createNotification } = require('../lib/notification');
const { recordPaymentCompensation } = require('../lib/paymentCompensation');
const { logPaymentAudit, postPaymentJournal } = require('../lib/finance');
const { logLeadEvent } = require('../lib/crm');
const { transitionLead } = require('../lib/leadState');
const { enqueueFinanceEvent } = require('../lib/financeOutbox');
const { enqueueEmailSequence } = require('../lib/emailSequence');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { safeDateOnly } = require('../lib/dates');
const { branchIdForBranch } = require('../lib/branches');
const { assertWritable } = require('../lib/periodLock');
const { hasPermission } = require('../constants/permissions');
const { applyCertificatePayment } = require('../lib/certificatePayments');
const { financialRecordMatches, resolveFinancialScope } = require('../lib/financialScope');
const { grantCourseSelections } = require('../lib/entitlements');
const { getNextClientCode } = require('../lib/mappers');
const { leadScope } = require('../lib/leadAccess');
const { VALID_BRANCHES } = require('../constants/permissions');
const { resolvePaymentAccess } = require('../lib/paymentEntitlementAccess');

const TRANSIENT_TX_ERRORS = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
const transactionBackoff = attempt => new Promise(resolve =>
  setTimeout(resolve, 25 * attempt + Math.floor(Math.random() * 25))
);

router.post('/api/admin/subscriber-payments', requireAuth, requireAdminOrStaff, requirePermission('manage_payments'), async (req, res) => {
  const sendEmail = (to, subject, html) => sendEmailBase(to, subject, html, { tenantId: req.tenantId });
  let conn;
  try {
    let { subscriber_id } = req.body;
    const { payment } = req.body;
    const leadId = String(req.body.lead_id || '').trim();
    const subscriberDraft = req.body.subscriber || {};
    const createFromDraftRequested = !subscriber_id && !leadId && subscriberDraft && typeof subscriberDraft === 'object';
    if ((!subscriber_id && !leadId && !createFromDraftRequested) || !payment) {
      return res.status(400).json({ error: 'subscriber_id, lead_id, or subscriber draft and payment required' });
    }
    const paymentAmount = Number(payment.amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0 || paymentAmount > 10000000) {
      return res.status(400).json({ error: 'payment.amount must be a finite positive amount' });
    }
    const paymentCurrency = String(payment.currency || 'EGP').toUpperCase();
    if (!['EGP', 'SAR', 'USD'].includes(paymentCurrency)) {
      return res.status(400).json({ error: 'Unsupported payment currency' });
    }
    const requestedStatus = String(payment.status || 'paid').toLowerCase();
    if (!['paid', 'pending'].includes(requestedStatus)) {
      return res.status(400).json({ error: 'New manual payments must be paid or pending' });
    }
    // Recording and approving money are separate responsibilities.
    const canApprovePayment = Boolean(
      req.isSuperAdmin || (req.staffRecord && hasPermission(req.staffRecord, 'manage_financial'))
    );
    const storedStatus = requestedStatus === 'paid' && !canApprovePayment ? 'pending' : requestedStatus;
    const scope = resolveFinancialScope(req, {
      requestedBranch: payment.branch || req.body.branch || null,
      allowAssigned: true,
    });
    // Validate subscriber exists — also fetch assigned_sales_id for commission lookup
    let createFromLead = false;
    let createFromDraft = false;
    let subRow;
    if (subscriber_id) {
      [[subRow]] = await pool.query(
        `SELECT id,name,email,phone,lead_id,assigned_sales_id,assigned_sales_name,
                assigned_cs_id,assigned_cs_name,tenant_id,branch,branch_id,client_code
           FROM subscribers
          WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1`,
        [subscriber_id, req.tenantId]
      );
      if (!subRow) return res.status(404).json({ error: 'Subscriber not found' });
    } else if (leadId) {
      const accessScope = leadScope(req, 'l');
      if (accessScope.none) return res.status(404).json({ error: 'Lead not found' });
      const [[lead]] = await pool.query(
        `SELECT l.id,l.client_code,l.name,l.email,l.phone,l.branch,l.branch_id,
                l.assigned_sales_id,l.assigned_sales_name,l.assigned_cs_id,l.assigned_cs_name,
                l.source,l.notes,l.tenant_id
           FROM leads l
          WHERE l.tenant_id=? AND l.id=? AND l.hidden=0${accessScope.sql}
          LIMIT 1`,
        [req.tenantId, leadId, ...accessScope.params]
      );
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      const [[existing]] = await pool.query(
        `SELECT id,name,email,phone,lead_id,assigned_sales_id,assigned_sales_name,
                assigned_cs_id,assigned_cs_name,tenant_id,branch,branch_id,client_code
           FROM subscribers
          WHERE tenant_id=? AND deleted_at IS NULL
            AND (lead_id=? OR (?<>'' AND phone=?) OR (?<>'' AND email = ?))
          ORDER BY created_at ASC LIMIT 1`,
        [
          req.tenantId, lead.id,
          String(lead.phone || ''), String(lead.phone || ''),
          String(lead.email || ''), String(lead.email || ''),
        ]
      );
      if (existing) {
        subscriber_id = existing.id;
        subRow = existing;
      } else {
        createFromLead = true;
        subscriber_id = uuidv4();
        const rawBranch = String(lead.branch || '').toUpperCase();
        const branch = VALID_BRANCHES.has(rawBranch) ? rawBranch : 'ONLINE_EGYPT';
        subRow = {
          ...lead,
          id: subscriber_id,
          lead_id: lead.id,
          email: sanitize(subscriberDraft.email || lead.email || '', 255).toLowerCase(),
          branch,
          branch_id: lead.branch_id || branchIdForBranch(branch),
          client_code: lead.client_code || null,
        };
      }
    } else {
      if (!req.isSuperAdmin && !hasPermission(req.staffRecord, 'manage_subscribers')) {
        return res.status(403).json({ error: 'Insufficient permissions to create subscriber' });
      }
      const safeName = sanitize(subscriberDraft.name || '', 300);
      const safeEmail = sanitize(subscriberDraft.email || '', 255).trim().toLowerCase();
      const safePhone = sanitize(subscriberDraft.phone || '', 30).trim();
      if (!safeName || !safePhone) {
        return res.status(400).json({ error: 'Subscriber name and phone are required' });
      }
      const rawBranch = String(subscriberDraft.branch || payment.branch || '').toUpperCase();
      const branch = VALID_BRANCHES.has(rawBranch) ? rawBranch : null;
      if (!branch) return res.status(400).json({ error: 'Valid subscriber branch is required' });
      const [[existing]] = await pool.query(
        `SELECT id FROM subscribers
          WHERE tenant_id=? AND deleted_at IS NULL
            AND (phone=? OR (?<>'' AND email = ?))
          LIMIT 1`,
        [req.tenantId, safePhone, safeEmail, safeEmail]
      );
      if (existing) {
        return res.status(409).json({ error: 'Subscriber already exists', existingId: existing.id });
      }
      createFromDraft = true;
      subscriber_id = uuidv4();
      subRow = {
        id: subscriber_id,
        name: safeName,
        email: safeEmail || null,
        phone: safePhone,
        lead_id: null,
        assigned_sales_id: null,
        assigned_sales_name: null,
        assigned_cs_id: null,
        assigned_cs_name: null,
        tenant_id: req.tenantId,
        branch,
        branch_id: branchIdForBranch(branch),
        client_code: null,
      };
    }
    if (!financialRecordMatches(scope, subRow)) {
      return res.status(403).json({ error: 'Subscriber is outside your payment scope' });
    }
    const paymentTenantId = req.tenantId;
    let paymentBranch = subRow.branch || 'ONLINE_EGYPT';
    let paymentBranchId = subRow.branch_id || branchIdForBranch(paymentBranch);
    const id = String(payment.id || uuidv4()).slice(0, 100);
    const paymentType = (payment.paymentType || payment.payment_type || 'OTHER').toUpperCase();
    const validTypes = ['COURSE','CERTIFICATE','CONSULTATION','BOOK','CARNEH','OTHER'];
    const safeType = validTypes.includes(paymentType) ? paymentType : 'OTHER';
    const certType = sanitize(payment.certType || payment.cert_type || '', 100) || null;
    const rawCertificateRequestId = String(
      payment.certId || payment.cert_id || payment.certReqId || payment.certificate_request_id || ''
    ).trim();
    if (rawCertificateRequestId.length > 36) {
      return res.status(400).json({ error: 'Invalid certificate request ID' });
    }
    const suppliedCertificateRequestId = sanitize(rawCertificateRequestId, 36) || null;
    if (safeType === 'CERTIFICATE' && !suppliedCertificateRequestId && !certType) {
      return res.status(400).json({ error: 'Certificate type or certificate request ID is required' });
    }
    const certificateRequestId = safeType === 'CERTIFICATE'
      ? (suppliedCertificateRequestId || uuidv4())
      : null;
    // A normal recorder can only attribute a payment to themselves. Finance
    // managers/admins may explicitly attribute it to another tenant staff member.
    const requestedStaffId = payment.staffId || payment.staff_id || null;
    const resolvedStaffId = !canApprovePayment && req.staffRecord?.id
      ? req.staffRecord.id
      : requestedStaffId;
    let resolvedStaffName = null;
    if (resolvedStaffId) {
      const [[su]] = await pool.query(
        'SELECT name FROM staff WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',
        [resolvedStaffId, paymentTenantId]
      );
      if (!su) return res.status(400).json({ error: 'Staff does not belong to tenant' });
      resolvedStaffName = su.name || null;
    }

    // Whoever actually typed this, named. When management records a payment
    // without attributing it to a staff member there was no staff id, so
    // staff_name stayed null and the المنفذ column was blank — the one entry
    // where knowing who did it matters most.
    //
    // Deliberately only the name: staff_id drives commission attribution, and
    // an admin recording someone else's sale must not be paid for it.
    if (!resolvedStaffName) {
      resolvedStaffName = req.staffRecord?.name
        || req.user?.name
        || req.user?.email
        || null;
    }
    const VALID_SOURCES_SP = new Set(['web','staff','reception','daqqi','system']);
    const staffOwnedSource = req.staffRecord
      ? (String(req.staffRecord.role || '').toLowerCase().includes('reception') ? 'reception' : 'staff')
      : null;
    const resolvedSource = staffOwnedSource && !canApprovePayment
      ? staffOwnedSource
      : (VALID_SOURCES_SP.has(payment.source) ? payment.source : (staffOwnedSource || null));
    const resolvedDate = safeDateOnly(payment.date || payment.at || new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedDate)) {
      return res.status(400).json({ error: 'Invalid payment date' });
    }
    const isPaid = storedStatus === 'paid';
    const courseId = payment.courseId || payment.course_id || null;
    const bundleId = payment.bundleId || payment.bundle_id || null;
    if (courseId && bundleId) return res.status(400).json({ error: 'Payment cannot target a course and bundle together' });
    const suppliedExpected = payment.courseExpected ?? payment.course_expected;
    const courseExpected = suppliedExpected == null ? null : Number(suppliedExpected);
    if (courseExpected != null && (!Number.isFinite(courseExpected) || courseExpected <= 0 || courseExpected > 10000000)) {
      return res.status(400).json({ error: 'courseExpected must be a finite positive amount' });
    }
    if (courseId) {
      const [[course]] = await pool.query(
        'SELECT id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',
        [courseId, paymentTenantId]
      );
      if (!course) return res.status(400).json({ error: 'Course does not belong to tenant' });
    }
    if (bundleId) {
      const [[bundle]] = await pool.query(
        'SELECT id FROM bundles WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',
        [bundleId, paymentTenantId]
      );
      if (!bundle) return res.status(400).json({ error: 'Bundle does not belong to tenant' });
    }

    // ── Begin atomic transaction ──────────────────────────────────────────────
    for (let transactionAttempt = 1; ; transactionAttempt += 1) {
      let paymentLockName = null;
      try {
        conn = await pool.getConnection();
        paymentLockName = `payment:${createHash('sha256')
          .update(`${paymentTenantId}\0${subscriber_id}`)
          .digest('hex').slice(0, 48)}`;
        const [[lock]] = await conn.query('SELECT GET_LOCK(?, 5) AS acquired', [paymentLockName]);
        if (Number(lock?.acquired) !== 1) {
          const lockError = new Error('Another payment for this subscriber is still processing');
          lockError.statusCode = 409;
          throw lockError;
        }
        await conn.beginTransaction();
        await assertWritable(resolvedDate, conn, paymentTenantId);
    if (createFromDraft) {
      const [[racedSubscriber]] = await conn.query(
        `SELECT id FROM subscribers
          WHERE tenant_id=? AND deleted_at IS NULL
            AND (phone=? OR (?<>'' AND email = ?))
          LIMIT 1 FOR UPDATE`,
        [paymentTenantId, subRow.phone, String(subRow.email || ''), String(subRow.email || '')]
      );
      if (racedSubscriber) {
        const error = new Error('Subscriber already exists');
        error.statusCode = 409;
        throw error;
      }
      const rep = await autoAssignStaff('COLLECTION', paymentTenantId);
      const clientCode = await getNextClientCode(conn);
      subRow.assigned_cs_id = rep?.id || null;
      subRow.assigned_cs_name = rep?.name || null;
      subRow.client_code = clientCode;
      await conn.query(
        `INSERT INTO subscribers
           (id,tenant_id,client_code,name,email,phone,is_active,branch,branch_id,
            assigned_cs_id,assigned_cs_name,notes,source,crm_json,created_at,updated_at)
         VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?,NOW(),NOW())`,
        [
          subscriber_id, paymentTenantId, clientCode, subRow.name, subRow.email, subRow.phone,
          subRow.branch, subRow.branch_id, subRow.assigned_cs_id, subRow.assigned_cs_name,
          sanitize(subscriberDraft.notes || subscriberDraft.note || '', 2000) || null,
          sanitize(subscriberDraft.source || 'reception', 100) || 'reception',
          JSON.stringify({
            createdWithPayment: true,
            createdBy: req.user?.email || req.staffRecord?.name || 'staff',
          }),
        ]
      );
    }
    if (createFromLead) {
      const accessScope = leadScope(req, 'l');
      const [[lockedLead]] = await conn.query(
        `SELECT l.id,l.client_code,l.name,l.email,l.phone,l.branch,l.branch_id,
                l.assigned_sales_id,l.assigned_sales_name,l.assigned_cs_id,l.assigned_cs_name,
                l.source,l.notes
           FROM leads l
          WHERE l.tenant_id=? AND l.id=? AND l.hidden=0${accessScope.sql}
          LIMIT 1 FOR UPDATE`,
        [paymentTenantId, leadId, ...accessScope.params]
      );
      if (!lockedLead) {
        const error = new Error('Lead not found');
        error.statusCode = 404;
        throw error;
      }
      const [[racedSubscriber]] = await conn.query(
        `SELECT id,name,email,phone,lead_id,assigned_sales_id,assigned_sales_name,
                assigned_cs_id,assigned_cs_name,tenant_id,branch,branch_id,client_code
           FROM subscribers
          WHERE tenant_id=? AND deleted_at IS NULL
            AND (lead_id=? OR (?<>'' AND phone=?) OR (?<>'' AND email = ?))
          ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
        [
          paymentTenantId, lockedLead.id,
          String(lockedLead.phone || ''), String(lockedLead.phone || ''),
          String(lockedLead.email || ''), String(lockedLead.email || ''),
        ]
      );
      if (racedSubscriber) {
        if (!financialRecordMatches(scope, racedSubscriber)) {
          const error = new Error('Subscriber is outside your payment scope');
          error.statusCode = 403;
          throw error;
        }
        subscriber_id = racedSubscriber.id;
        subRow = racedSubscriber;
        createFromLead = false;
        paymentBranch = subRow.branch || 'ONLINE_EGYPT';
        paymentBranchId = subRow.branch_id || branchIdForBranch(paymentBranch);
      } else {
        let csId = lockedLead.assigned_cs_id || null;
        let csName = lockedLead.assigned_cs_name || null;
        if (!csId) {
          const rep = await autoAssignStaff('COLLECTION', paymentTenantId);
          if (rep) { csId = rep.id; csName = rep.name; }
        }
        const clientCode = lockedLead.client_code || await getNextClientCode(conn);
        const email = sanitize(subscriberDraft.email || lockedLead.email || '', 255).toLowerCase();
        const nationalId = sanitize(subscriberDraft.nationalId || subscriberDraft.national_id || '', 50) || null;
        const crmJson = JSON.stringify({
          source: lockedLead.source || 'lead_conversion',
          convertedFromLeadId: lockedLead.id,
          convertedAt: new Date().toISOString(),
          assignedSalesId: lockedLead.assigned_sales_id || null,
          assignedSalesName: lockedLead.assigned_sales_name || null,
          assignedCollectionId: csId,
          assignedCollectionName: csName,
        });
        await conn.query(
          `INSERT INTO subscribers
             (id,tenant_id,client_code,lead_id,name,email,phone,national_id,is_active,
              branch,branch_id,assigned_sales_id,assigned_sales_name,assigned_cs_id,
              assigned_cs_name,notes,source,crm_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
          [
            subscriber_id, paymentTenantId, clientCode, lockedLead.id,
            sanitize(lockedLead.name, 300), email,
            sanitize(lockedLead.phone || '', 30) || null, nationalId,
            paymentBranch, paymentBranchId,
            lockedLead.assigned_sales_id || null, lockedLead.assigned_sales_name || null,
            csId, csName, sanitize(lockedLead.notes || '', 2000) || null,
            lockedLead.source || 'lead_conversion', crmJson,
          ]
        );
        subRow = {
          ...lockedLead,
          id: subscriber_id,
          lead_id: lockedLead.id,
          client_code: clientCode,
          email,
          assigned_cs_id: csId,
          assigned_cs_name: csName,
          tenant_id: paymentTenantId,
          branch: paymentBranch,
          branch_id: paymentBranchId,
        };
      }
    }
    if (safeType === 'CERTIFICATE') {
      await applyCertificatePayment({
        id,
        subscriber_id,
        course_id: courseId,
        amount: paymentAmount,
        currency: paymentCurrency,
        date: resolvedDate,
        note: sanitize(payment.note || payment.notes || '', 2000) || null,
        cert_type: certType,
        certificate_request_id: certificateRequestId,
      }, conn, paymentTenantId, { settle: isPaid });
    }

    await conn.query(
      `INSERT INTO payments
         (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method,
          transaction_id, is_installment, course_expected, date, note, status, staff_id, staff_name,
           from_account, source, item_title, cert_type, certificate_request_id, tenant_id, branch, branch_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, subscriber_id,
        courseId, bundleId,
        paymentAmount,
        paymentCurrency,
        safeType,
        sanitize(payment.paymentMethod || payment.payment_method || '', 100) || null,
        sanitize(payment.transactionId || payment.transaction_id || '', 191) || null,
        payment.isInstallment ? 1 : 0,
        courseExpected != null ? courseExpected : (payment.isInstallment ? null : paymentAmount),
        resolvedDate,
        sanitize(payment.note || payment.notes || '', 2000) || null,
        storedStatus,
        resolvedStaffId,
        resolvedStaffName,
        sanitize(payment.fromAccountNumber || payment.from_account || '', 100) || null,
        resolvedSource,
        sanitize(payment.itemTitle || payment.item_title || '', 255) || null,
        certType,
        certificateRequestId,
        paymentTenantId,
        paymentBranch,
        paymentBranchId,
      ]
    );

    // Auto-create enrollment when payment is paid and a course/bundle is specified
    // access_type = 'full' only if NOT an installment payment AND amount covers the full expected price
    // access_type = 'limited' (preview-only) for partial/installment payments until fully paid
    if (isPaid && (courseId || bundleId)) {
      let enrollAccessType = 'full';
      if (payment.isInstallment) {
        enrollAccessType = await resolvePaymentAccess({
          db: conn,
          tenantId: paymentTenantId,
          subscriberId: subscriber_id,
          courseId,
          bundleId,
          currentPaymentId: id,
          currentAmount: paymentAmount,
          currency: paymentCurrency,
          expectedAmount: courseExpected,
        });
      }
      await grantCourseSelections({
        tenantId: paymentTenantId, subscriberId: subscriber_id,
        selections: [{
          courseId: bundleId ? `bundle:${bundleId}` : courseId,
          accessType: enrollAccessType,
          lectureLimit: enrollAccessType === 'limited' ? 2 : null,
        }],
        branchId: paymentBranchId, source: 'manual_payment',
        actor: req.user?.email || 'staff',
      }, conn);
    }
    // Post double-entry journal inside the same transaction. A paid payment is
    // not financially complete unless the accounting entry is persisted too.
    if (isPaid) {
      const rawAmt = Number(payment.amount) || 0;
      const journalId = await postPaymentJournal({
        paymentId: id, amount: rawAmt, currency: payment.currency, payType: safeType,
        date: resolvedDate, actor: req.user?.email || 'system', tenantId: paymentTenantId,
      }, conn);
      if (!journalId) throw new Error('Payment journal posting failed');
      await recordPaymentCompensation({
        paymentId: id,
        tenantId: paymentTenantId,
        commissionStaffId: subRow.assigned_sales_id || resolvedStaffId || null,
        actor: resolvedStaffId || req.user?.email || 'system',
      }, conn);
    }

    // P1 CLOSED: the crm_json.paymentHistory dual-write was removed here. The
    // payments table is the single source of truth — every reader (stafflists,
    // admin/subscribers, client views) builds paymentHistory from the payments
    // table, and the crm_json fallback was proven dead (0 subscribers relied on
    // it). Legacy front-paths that still PATCH crm_json with payment entries are
    // converged INTO payments by the auto-sync in admin/subscribers.js.
    let linkedLeadId = subRow.lead_id || null;
    if (!linkedLeadId && (subRow.email || subRow.phone)) {
      const [[matchingLead]] = await conn.query(
        `SELECT id FROM leads
         WHERE tenant_id=? AND hidden=0
           AND (
             (? <> '' AND LOWER(TRIM(email))=LOWER(TRIM(?)))
             OR (? <> '' AND TRIM(phone)=TRIM(?))
           )
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [
          paymentTenantId,
          String(subRow.email || ''), String(subRow.email || ''),
          String(subRow.phone || ''), String(subRow.phone || ''),
        ]
      );
      linkedLeadId = matchingLead?.id || null;
      if (linkedLeadId) {
        await conn.query('UPDATE subscribers SET lead_id=? WHERE id=? AND tenant_id=? AND lead_id IS NULL', [linkedLeadId, subscriber_id, paymentTenantId]);
      }
    }
    if (isPaid && linkedLeadId) {
      await transitionLead({
        tenantId: paymentTenantId, leadId: linkedLeadId, toStatus: 'converted', db: conn,
        actor: req.user?.email || req.staffRecord?.name || 'payment',
        reason: 'Lead converted after paid subscriber payment', metadata: { subscriberId: subscriber_id, paymentId: id },
      });
    }
    if (isPaid) {
      await enqueueFinanceEvent({
        tenantId: paymentTenantId, eventType: 'sync_lead_deal_value', refType: 'payment', refId: id,
        payload: { subscriberId: subscriber_id },
      }, conn);
    }

    await logPaymentAudit(
      id, 'create', null, storedStatus, paymentAmount, subscriber_id,
      req.user?.email || req.user?.uid, paymentTenantId, conn, true,
    );
        await conn.commit();
        await conn.query('SELECT RELEASE_LOCK(?)', [paymentLockName]).catch(() => {});
        conn.release();
        conn = null;
        break;
      } catch (transactionError) {
        if (conn) {
          await conn.rollback().catch(() => {});
          if (paymentLockName) await conn.query('SELECT RELEASE_LOCK(?)', [paymentLockName]).catch(() => {});
          conn.release();
          conn = null;
        }
        const retryable = TRANSIENT_TX_ERRORS.has(transactionError?.code);
        if (!retryable || transactionAttempt >= 3) throw transactionError;
        logger.warn('[subscriber-payments] retrying rolled-back transaction', {
          attempt: transactionAttempt,
          code: transactionError.code,
        });
        await transactionBackoff(transactionAttempt);
      }
    }
    // End transaction

    // Notify admins of new payment
    if (isPaid) {
      createNotification('payment', '💰 دفعة جديدة', `دفعة ${payment.amount} ${payment.currency || 'EGP'} من مشترك`, { subscriberId: subscriber_id, paymentId: id, amount: payment.amount }, req.tenantId).catch(() => {});
      // Send receipt email to subscriber
      if (subRow.email) {
        let courseLabel = '';
        if (courseId) {
          const [[ci]] = await pool.query(
            'SELECT title FROM courses WHERE id=? AND tenant_id=? LIMIT 1',
            [courseId, paymentTenantId]
          ).catch(() => [[null]]);
          courseLabel = ci?.title || '';
        } else if (bundleId) {
          const [[bi]] = await pool.query(
            'SELECT title FROM bundles WHERE id=? AND tenant_id=? LIMIT 1',
            [bundleId, paymentTenantId]
          ).catch(() => [[null]]);
          courseLabel = bi?.title || '';
        }
        const paymentDate = new Date(payment.date || payment.at || Date.now()).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
        sendEmail(subRow.email, 'إيصال الدفع — معهد الدراسات النفسية',
          `<p>مرحباً،</p>
           <p>تم استلام دفعتك بنجاح. إليك تفاصيل الإيصال:</p>
           <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
             <tr style="background:#f0f4ff;"><td style="padding:8px 12px;font-weight:bold;color:#4f46e5;">المبلغ</td><td style="padding:8px 12px;">${payment.amount} ${payment.currency || 'EGP'}</td></tr>
             <tr><td style="padding:8px 12px;font-weight:bold;color:#4f46e5;">التاريخ</td><td style="padding:8px 12px;">${paymentDate}</td></tr>
             ${courseLabel ? `<tr style="background:#f0f4ff;"><td style="padding:8px 12px;font-weight:bold;color:#4f46e5;">البرنامج</td><td style="padding:8px 12px;">${courseLabel}</td></tr>` : ''}
             ${payment.paymentMethod ? `<tr><td style="padding:8px 12px;font-weight:bold;color:#4f46e5;">طريقة الدفع</td><td style="padding:8px 12px;">${payment.paymentMethod}</td></tr>` : ''}
             ${payment.transactionId ? `<tr style="background:#f0f4ff;"><td style="padding:8px 12px;font-weight:bold;color:#4f46e5;">رقم المعاملة</td><td style="padding:8px 12px;">${payment.transactionId}</td></tr>` : ''}
           </table>
           <p style="color:#888;font-size:13px;">احتفظ بهذا الإيصال لسجلاتك. للاستفسار تواصل معنا عبر الموقع.</p>`
        ).catch(e => logger.error('[receipt-email]', e.message));
        // Send WhatsApp payment confirmation to subscriber
        const subPhone = await pool.query(
          'SELECT phone FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1',
          [subscriber_id, paymentTenantId]
        )
          .then(([[r]]) => r?.phone || null).catch(() => null);
        if (subPhone) {
          const waMsg = `✅ تم استلام دفعتك بنجاح!\nالمبلغ: ${payment.amount} ${payment.currency || 'EGP'}${courseLabel ? '\nالبرنامج: ' + courseLabel : ''}\nالتاريخ: ${paymentDate}\nشكراً لثقتك بمعهد الدراسات النفسية 💚`;
          sendWhatsApp(subPhone.replace(/\D/g, ''), waMsg, { tenantId: paymentTenantId }).catch(() => {});
        }
      }
    }
    // Enqueue enrollment email sequence (best-effort)
    if (isPaid && subRow.email) {
      enqueueEmailSequence({ tenantId: paymentTenantId, triggerEvent: 'enrollment', recipientEmail: subRow.email, recipientName: subRow.name || '' }).catch(error => logger.warn('[subscriber-payment] sequence enqueue failed', { error: error.message }));
      // Lifecycle: instant payment receipt (email; whatsapp handled above).
      require('../lib/lifecycle').trigger('payment_received',
        { name: subRow.name, email: subRow.email, amount: payment.amount, currency: payment.currency, tenantId: paymentTenantId },
        { channels: ['email'] });
    }
    res.json({
      ok: true,
      id,
      subscriberId: subscriber_id,
      subscriberCreated: createFromLead || createFromDraft,
      status: storedStatus,
      approvalRequired: storedStatus === 'pending',
    });
  } catch (e) {
    if (conn) { await conn.rollback().catch(() => {}); conn.release(); conn = null; }
    logger.error('[route]', e.message);
    if (e?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Payment ID or transaction reference already exists' });
    res.status(e?.statusCode || 500).json({ error: e?.statusCode ? e.message : 'Internal server error' });
  }
});


module.exports = router;
