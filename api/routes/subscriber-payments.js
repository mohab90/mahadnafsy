'use strict';
const { signerName } = require('../lib/staffNames');
const logger = require('../lib/logger');
const { createHash } = require('node:crypto');
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');
const { pool } = require('../lib/db');
const { queuePaymentReceipt } = require('../lib/paymentReceipt');
const { sendWhatsApp } = require('../lib/whatsapp');
const { sanitize } = require('../lib/helpers');
const { createNotification } = require('../lib/notification');
const { recordPaymentCompensation } = require('../lib/paymentCompensation');
const { logPaymentAudit, postPaymentJournal } = require('../lib/finance');
const { ensureFreshFx, fxStaleError } = require('../lib/fxRefresh');
const { logLeadEvent } = require('../lib/crm');
const { convertLeadOfPayment } = require('../lib/leadState');
const { enqueueFinanceEvent } = require('../lib/financeOutbox');
const { enqueueEmailSequence } = require('../lib/emailSequence');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { safeDateOnly } = require('../lib/dates');
const { branchIdForBranch, branchForId } = require('../lib/branches');
const { assertWritable } = require('../lib/periodLock');
const { agreedPrice, isItemPaymentType, setAgreedPrice } = require('../lib/agreedPrice');
const { pickCollectionOfficer, subscriberMarket } = require('../lib/collectionDistribution');
const { hasPermission } = require('../constants/permissions');
const { applyCertificatePayment } = require('../lib/certificatePayments');
const { financialRecordMatches, resolveFinancialScope } = require('../lib/financialScope');
const { grantCourseSelections } = require('../lib/entitlements');
const { getNextClientCode } = require('../lib/mappers');
const { leadScope } = require('../lib/leadAccess');
const { completeForBranch, isRealPhone } = require('../lib/phoneNumber');
const { VALID_BRANCHES } = require('../constants/permissions');
const { resolvePaymentAccess, accessModeOf, paidRatioOf } = require('../lib/paymentEntitlementAccess');
const { isCashMethod, linkTransfer } = require('../lib/incomingTransfers');
const { seatInOwnTransaction } = require('../lib/daqqiHousing');
const { resolveTierPrice, PRICE_TIERS } = require('../lib/priceTiers');
const { priceMatches } = require('../lib/catalogPrice');
const { validateBookingIdentity, applyBookingIdentity } = require('../lib/bookingIdentity');
const { canTouchBranch } = require('../lib/physicalBranches');

const PRICE_TIER_KEYS = new Set(PRICE_TIERS.map(tier => tier.key));
// Tiers whose clients carry an Egyptian national ID; the others may carry a
// passport or a residence number instead.
const EGYPTIAN_ID_TIERS = new Set(['DAQQI', 'TAGAMOA', 'ONLINE_EGYPT']);
const TIER_NATIONALITY = { ONLINE_EGYPT: 'EGYPTIAN', ONLINE_EGYPT_FOREIGN: 'NON_EGYPTIAN_EGYPT', DAQQI_FOREIGN: 'NON_EGYPTIAN_EGYPT' };

/**
 * Money recorded from a collection account is the manager's to confirm —
 * «اي حجز لازم ميسمعش لحد ما المسئول يتاكد من المدفوعات ويربطه بتحويل» —
 * whatever the officer's grid says. Two collection officers on production hold
 * manage_financial, which settled their own bookings the moment they typed them.
 */
// A lead a booking could not find, said in the desk's words: it moved to
// someone else, it is hidden, or it is gone. «Lead not found» was all a rep saw
// — the errors that showed «on some clients only».
async function leadMissing(tenantId, leadId) {
  const [[lead]] = await pool.query('SELECT hidden FROM leads WHERE tenant_id=? AND id=? LIMIT 1', [tenantId, leadId]).catch(() => [[null]]);
  if (!lead) return { error: 'العميل ده مش موجود — حدّث الصفحة.', code: 'LEAD_NOT_FOUND' };
  if (Number(lead.hidden) === 1) return { error: 'العميل ده مخفي — رجّعه الأول وبعدين سجّل الدفعة.', code: 'LEAD_HIDDEN' };
  return { error: 'العميل ده مبقاش معاك — اتنقل لحد تاني. حدّث الصفحة.', code: 'LEAD_MOVED' };
}

const reviewedByManager = req => !req.isSuperAdmin && String(req.staffRecord?.role || '').toLowerCase() === 'collection';

const TRANSIENT_TX_ERRORS = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
const transactionBackoff = attempt => new Promise(resolve =>
  setTimeout(resolve, 25 * attempt + Math.floor(Math.random() * 25))
);

// ── The boxes the institute actually collects into ────────────────────────
//
// «وسيلة الدفع» in this system is the cash box: «خزنة الدقي», «فودافون كاش
// 2020», «اورانج كاش 7720» — a rail plus, usually, the last four digits of the
// account. الإعدادات ← وسائل الدفع owns the list, and on this tenant that key
// has never been saved, so every payment dialog fell back to a list written
// into the source: seven names, one of which («خزنة الفرع») has never taken a
// pound, and none of the ten boxes holding 124,000 EGP between them.
//
// A closed dropdown offering none of the boxes you use is not a settings
// problem the desk can see. So the dialog also asks what has been collected
// into before: whatever the admin has configured, plus every box with a paid
// payment against it. Ordered by money, because the box you reach for is
// nearly always the busy one.
//
// Same permission as recording a payment, deliberately. Gating this behind
// 'view_financial' would empty the dropdown for exactly the reception and
// sales staff who use it.
router.get('/api/admin/payment-boxes', requireAuth, requireAdminOrStaff, requirePermission('manage_payments'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT payment_method AS box, COUNT(*) AS payments, SUM(amount_egp) AS egp
         FROM payments
        WHERE tenant_id = ? AND status = 'paid'
          AND payment_method IS NOT NULL AND TRIM(payment_method) <> '' AND deleted_at IS NULL
        GROUP BY payment_method
        ORDER BY egp DESC`,
      [req.tenantId],
    );
    res.json(rows.map(row => ({
      box: String(row.box),
      payments: Number(row.payments) || 0,
      egp: Math.round(Number(row.egp) || 0),
    })));
  } catch (error) {
    logger.error({ err: error }, '[payment-boxes] failed');
    res.status(500).json({ error: 'تعذّر تحميل قائمة الخزائن' });
  }
});

/**
 * Record a payment — and, for a lead or a draft with no customer yet, the
 * customer. Also the approval of a collection account's new customer
 * (req.subscriberRequest, set by the approve route below): the same booking,
 * as the approver, in one transaction with the request's own status.
 */
async function recordSubscriberPayment(req, res) {
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
    // «تسكين» with the booking: a Dokki booking may name the round the client is seated
    // in. Checked before any money is recorded, so a stale round is told at once.
    const daqqiRoundId = String(req.body.daqqiRoundId || payment?.daqqiRoundId || '').trim();
    if (daqqiRoundId) {
      const [[round]] = await pool.query(
        'SELECT id, branch FROM daqqi_rounds WHERE id=? AND tenant_id=? LIMIT 1', [daqqiRoundId, req.tenantId]);
      // A round at another branch than this account's is not one it may seat into.
      if (!round || !canTouchBranch(req, round.branch)) return res.status(400).json({ error: 'الروند اللي اخترته مش موجود — حدّث الصفحة واختار روند تاني' });
    }
    // Recording and approving money are separate responsibilities.
    const canApprovePayment = !reviewedByManager(req) && Boolean(
      req.isSuperAdmin || (req.staffRecord && hasPermission(req.staffRecord, 'manage_financial'))
    );
    const approvingRequest = req.subscriberRequest || null;
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
      if (!subRow) return res.status(404).json({ error: 'العميل ده مش موجود أو اتشال من قاعدة العملاء — حدّث الصفحة.', code: 'SUBSCRIBER_NOT_FOUND' });
    } else if (leadId) {
      const accessScope = leadScope(req, 'l');
      if (accessScope.none) return res.status(404).json({ error: 'مش متاح لك تسجّل دفعة على عملاء محتملين.', code: 'LEAD_OUT_OF_SCOPE' });
      const [[lead]] = await pool.query(
        `SELECT l.id,l.client_code,l.name,l.email,l.phone,l.branch,l.branch_id,
                l.assigned_sales_id,l.assigned_sales_name,l.assigned_cs_id,l.assigned_cs_name,
                l.source,l.notes,l.tenant_id
           FROM leads l
          WHERE l.tenant_id=? AND l.id=? AND l.hidden=0${accessScope.sql}
          LIMIT 1`,
        [req.tenantId, leadId, ...accessScope.params]
      );
      if (!lead) return res.status(404).json(await leadMissing(req.tenantId, leadId));
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
          phone: completeForBranch(lead.phone, branch),
          id: subscriber_id,
          lead_id: lead.id,
          // NULL, not '' — see the note on the lead-conversion insert below.
          // This row is what the INSERT reads, so an empty address here is the
          // same refusal for the next person who has none.
          email: sanitize(subscriberDraft.email || lead.email || '', 255).toLowerCase() || null,
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
      const typedPhone = sanitize(subscriberDraft.phone || '', 30).trim();
      if (!safeName || !typedPhone) {
        return res.status(400).json({ error: 'Subscriber name and phone are required' });
      }
      // The branch, or the branch of whoever is recording it.
      //
      // «الفرع *» was a required choice on every booking, and the desk makes
      // the same one every time: reception at Dokki books Dokki, the online
      // desk books online. Refusing the booking over a field the person
      // recording it already answers by being who they are is a stop for
      // nothing — so their own branch stands in, and only an account with no
      // branch at all is asked.
      const rawBranch = String(subscriberDraft.branch || payment.branch || '').toUpperCase();
      const staffBranch = req.staffRecord?.branch_id ? branchForId(req.staffRecord.branch_id, '') : '';
      const branch = VALID_BRANCHES.has(rawBranch) ? rawBranch
        : (VALID_BRANCHES.has(staffBranch) ? staffBranch : null);
      if (!branch) {
        return res.status(400).json({
          error: 'اختر الفرع — حسابك مش مربوط بفرع، فمحتاجين نعرف الحجز ده تبع أنهي فرع.',
          code: 'BRANCH_REQUIRED',
        });
      }
      // A Saudi client's 05… gets its 966 before anything is compared or stored.
      const safePhone = String(completeForBranch(typedPhone, branch) || '').trim();
      const [[existing]] = await pool.query(
        `SELECT id FROM subscribers
          WHERE tenant_id=? AND deleted_at IS NULL
            AND (phone=? OR (?<>'' AND email = ?))
          LIMIT 1`,
        [req.tenantId, safePhone, safeEmail, safeEmail]
      );
      if (existing) {
        return res.status(409).json({ error: 'الرقم أو الإيميل ده عليه عميل تاني في قاعدة العملاء — سجّل الدفعة على العميل ده.', code: 'SUBSCRIBER_EXISTS', existingId: existing.id });
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
    // «متخليش السيستم يقبل عميل دفع بدون رقم تليفون حقيقي»: money is recorded
    // only against a client who can be reached. 29 paying clients had no real
    // number — none at all, or one too short to dial.
    if (!isRealPhone(completeForBranch(subRow.phone, subRow.branch))) {
      return res.status(400).json({
        error: 'لازم يكون للعميل رقم تليفون حقيقي قبل تسجيل أي دفعة — عدّل رقم العميل الأول (موبايل مصري أو رقم بكود الدولة).',
        code: 'PHONE_REQUIRED',
      });
    }
    const paymentTenantId = req.tenantId;
    // The branch this money was taken at, which is the one the desk chose.
    //
    // «الفرع *» was asked for on every booking and then ignored: the payment
    // was filed under whatever the client's own row carried, so a payment taken
    // at the Dokki desk from someone who signed up online was recorded as
    // online — and the vault, the branch P&L and محاسبة الدقي all read that
    // column. The client keeps their own branch; the payment carries where it
    // happened. resolveFinancialScope above has already refused a branch
    // outside what this account may touch.
    const chosenBranch = String(payment.branch || req.body.branch || '').toUpperCase();
    let paymentBranch = VALID_BRANCHES.has(chosenBranch)
      ? chosenBranch
      : (subRow.branch || 'ONLINE_EGYPT');
    let paymentBranchId = VALID_BRANCHES.has(chosenBranch)
      ? branchIdForBranch(chosenBranch)
      : (subRow.branch_id || branchIdForBranch(paymentBranch));
    const id = String(payment.id || uuidv4()).slice(0, 100);
    const paymentType = (payment.paymentType || payment.payment_type || 'OTHER').toUpperCase();
    const validTypes = ['COURSE','CERTIFICATE','CONSULTATION','BOOK','CARNEH','OTHER'];
    const safeType = validTypes.includes(paymentType) ? paymentType : 'OTHER';
    // Only a course is paid in instalments: a carnet or a book sent as one was
    // stored as a course instalment and counted in every «أقساط» figure.
    if (safeType !== 'COURSE') payment.isInstallment = false;
    // A carnet or a book still names «الكورس المرتبط»; it is not that course's money.
    const paysForItem = isItemPaymentType(safeType);
    const certType = sanitize(payment.certType || payment.cert_type || '', 100) || null;
    const rawCertificateRequestId = String(
      payment.certId || payment.cert_id || payment.certReqId || payment.certificate_request_id || ''
    ).trim();
    if (rawCertificateRequestId.length > 36) {
      return res.status(400).json({ error: 'Invalid certificate request ID' });
    }
    const suppliedCertificateRequestId = sanitize(rawCertificateRequestId, 36) || null;
    if (safeType === 'CERTIFICATE' && !suppliedCertificateRequestId && !certType) {
      return res.status(400).json({ error: 'اختار نوع الشهادة (أو طلب شهادة موجود) قبل تسجيل دفعها', code: 'CERTIFICATE_TYPE_REQUIRED' });
    }
    const certificateRequestId = safeType === 'CERTIFICATE'
      ? (suppliedCertificateRequestId || uuidv4())
      : null;
    // A normal recorder can only attribute a payment to themselves. Finance
    // managers/admins may explicitly attribute it to another tenant staff member.
    const requestedStaffId = payment.staffId || payment.staff_id || null;
    // Falls back to whoever is signed in, rather than to nothing.
    //
    // A staff member without approval rights is always recorded as the taker —
    // that branch was already right. Anyone who *can* approve got
    // requestedStaffId instead, and the admin UI does not send one, so every
    // payment an admin or manager recorded stored a NULL staff_id. That is 264
    // of 287 payments on production, 92%, which makes per-staff revenue
    // meaningless by construction rather than by neglect.
    //
    // Attribution to another staff member still works: requestedStaffId wins
    // when it is given, and is validated against the tenant just below. Only the
    // empty case changes, from "nobody" to "the person who did it".
    //
    // An account with no staff row — the admin login is one — still resolves to
    // null, which is the honest answer for someone who is not staff.
    const resolvedStaffId = !canApprovePayment && req.staffRecord?.id
      ? req.staffRecord.id
      : (requestedStaffId || req.staffRecord?.id || null);
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
    // A riyal or dollar payment is posted in pounds at today's rate. A stale
    // rate is fetched now; one that still cannot be had is said, not «500»
    // (lib/fxRefresh.js — Saudi and international bookings, 10 Oct 2026).
    if (isPaid && paymentCurrency !== 'EGP') {
      const fx = await ensureFreshFx(paymentTenantId, paymentCurrency);
      if (!fx.usable) {
        const stale = fxStaleError(paymentCurrency, fx.snapshot);
        return res.status(stale.statusCode).json({ error: stale.message, code: stale.code });
      }
    }
    // A settled payment has to say how the money arrived.
    //
    // 192 paid rows on production carry no method, and one of them is why a
    // customer was shown «تم تأكيد الدفع 2800 جنيه» for a transfer nobody could
    // find: the row said paid, named no method, and appeared in no provider
    // report, so there was nothing to reconcile it against and no way to tell
    // whether the money had arrived. The modal draws the field as required and
    // will not submit without it, but an empty string arriving here became NULL
    // and was stored as paid regardless.
    //
    // Only a settled payment is held to it. A pending one is still being sorted
    // out, and that is exactly when the method may not be known yet.
    const resolvedMethod = sanitize(payment.paymentMethod || payment.payment_method || '', 100) || null;
    if (isPaid && !resolvedMethod) {
      return res.status(400).json({ error: 'لازم تحدد طريقة الدفع قبل ما تأكد السداد. من غيرها مش هيبقى معروف الفلوس وصلت إزاي.' });
    }
    const courseId = payment.courseId || payment.course_id || null;
    const bundleId = payment.bundleId || payment.bundle_id || null;
    if (courseId && bundleId) return res.status(400).json({ error: 'Payment cannot target a course and bundle together' });
    // A COURSE payment has to name what was bought.
    //
    // 88 rows on production are payment_type COURSE with neither a course nor a
    // bundle — 238,731 EGP whose purpose cannot be answered from the data. Four
    // ways to recover it were tried and every one came back empty: none has an
    // item_title, none is a certificate, none links to a certificate request,
    // and not one belongs to a subscriber enrolled in exactly one course. The
    // history needs a person; this stops it growing.
    //
    // Only COURSE is held to it. CERTIFICATE carries its own request id, and
    // OTHER exists precisely for payments that fit nothing else.
    if (safeType === 'COURSE' && !courseId && !bundleId) {
      return res.status(400).json({ error: '\u062f\u0641\u0639\u0629 \u0646\u0648\u0639\u0647\u0627 \u0643\u0648\u0631\u0633 \u0644\u0627\u0632\u0645 \u062a\u062d\u062f\u062f \u0627\u0644\u0643\u0648\u0631\u0633 \u0623\u0648 \u0627\u0644\u0628\u0627\u0642\u0629. \u0645\u0646 \u063a\u064a\u0631\u0647\u0645 \u0645\u0634 \u0647\u064a\u0628\u0642\u0649 \u0645\u0639\u0631\u0648\u0641 \u0627\u062a\u062f\u0641\u0639\u062a \u0645\u0642\u0627\u0628\u0644 \u0625\u064a\u0647.' });
    }
    // A price typed from a collection account is not a price change: the
    // client's agreed price stands (lib/agreedPrice.js), and changing it is the
    // accounts' or the administration's.
    const suppliedExpected = reviewedByManager(req) ? null : (payment.courseExpected ?? payment.course_expected);
    const courseExpected = suppliedExpected == null ? null : Number(suppliedExpected);
    if (courseExpected != null && (!Number.isFinite(courseExpected) || courseExpected <= 0 || courseExpected > 10000000)) {
      return res.status(400).json({ error: 'courseExpected must be a finite positive amount' });
    }
    // What the customer owes for this course, when nobody said.
    //
    // This used to fall back to the payment itself: a non-instalment payment of
    // any size wrote course_expected = that amount, so the row said "paid in
    // full" whatever the course costs. Everything downstream believes it —
    // entitlements grant full access on paid >= expected, the remaining-balance
    // column reads zero, and the collections list never shows them. Sixty-five
    // customers hold full access having paid less than their course's price,
    // one of them 690 against 3,400.
    //
    // The catalogue price is the honest default. An agreed price below list —
    // a discount, a partial enrolment — is exactly what supplying
    // courseExpected is for, and that still wins. Only when the catalogue has
    // no usable price does this fall back to the amount, because a course with
    // no price cannot say the payment was short.
    //
    // Nobody saying means the price the client already agreed — their own
    // price, else their booking's, else the catalogue (lib/agreedPrice.js). An
    // instalment used to record nothing here, so it could not open lectures in
    // proportion and the next payment on the course had no price to agree with.
    // «اختيار السعر الصح بيكون بعد اختيار الكورس والفرع»: the desk names the
    // tier (the branch, and for online Egypt the nationality) and whether the
    // client gets the discount price; the price itself comes from the
    // catalogue (lib/priceTiers.js), so a booking is never charged a figure
    // somebody typed. A figure the screen computed has to agree with it.
    const priceTier = String(payment.priceTier || '').toUpperCase() || null;
    // «رجع يظهر للمديرين ولحساب هنا فقط انه يدخل سعر مختلف للعميل»: a price set
    // for this client at booking, by someone allowed to (set_client_price),
    // stands instead of the branch price.
    const clientPrice = payment.customPrice === true && courseExpected != null
      && (req.isSuperAdmin || hasPermission(req.staffRecord, 'set_client_price'));
    let tierPrice = null;
    if (priceTier && paysForItem && (courseId || bundleId)) {
      if (!PRICE_TIER_KEYS.has(priceTier)) return res.status(400).json({ error: 'Unknown price tier', code: 'PRICE_TIER_UNKNOWN' });
      tierPrice = await resolveTierPrice(pool, {
        tenantId: paymentTenantId,
        type: bundleId ? 'bundle' : 'course',
        itemId: bundleId || courseId,
        tier: priceTier,
        useDiscount: Boolean(payment.useDiscount),
        discountPct: Number(payment.discountPct) || 0,
      });
      if (!tierPrice) {
        return res.status(400).json({
          error: Number(payment.discountPct)
            ? 'نسبة الخصم دي مش مسموحة'
            : payment.useDiscount
            ? 'الكورس ده مالوش سعر خصم في الفرع ده'
            : 'الكورس ده مش متسعّر للفرع ده — حط سعره من صفحة الكورس الأول',
          code: 'TIER_NOT_PRICED',
        });
      }
      if (tierPrice.currency !== paymentCurrency) {
        return res.status(400).json({ error: `السعر في الفرع ده بالـ${tierPrice.currency} — الدفعة لازم تكون بنفس العملة`, code: 'TIER_CURRENCY_MISMATCH' });
      }
      if (courseExpected != null && !clientPrice && !priceMatches(courseExpected, tierPrice.price)) {
        return res.status(409).json({ error: 'السعر اتغير — حدّث الصفحة', code: 'PRICE_MISMATCH', price: tierPrice.price });
      }
    }
    // «اسم العميل الحقيقي عربي ثلاثي … بالانجليزي … الرقم القومي»: taken with
    // every booking that names a tier, and the Arabic triple name is required.
    let bookingIdentity = null;
    const bookingClient = req.body.client || payment.client;
    if (priceTier || bookingClient) {
      const checked = validateBookingIdentity(bookingClient, { egyptian: !priceTier || EGYPTIAN_ID_TIERS.has(priceTier) });
      if (!checked.ok) return res.status(400).json({ error: checked.error, code: checked.code });
      bookingIdentity = checked.identity;
    }
    let resolvedExpected = clientPrice ? courseExpected : tierPrice ? tierPrice.price : courseExpected;
    if (resolvedExpected == null && paysForItem && (courseId || bundleId)) {
      // Read through the pool: this runs before the transaction opens, and the
      // price is not part of what this write must see consistently.
      resolvedExpected = await agreedPrice(pool, {
        tenantId: paymentTenantId, subscriberId: subscriber_id, courseId, bundleId, currency: paymentCurrency,
      }).catch(() => null);
    }
    if (resolvedExpected == null && !payment.isInstallment) resolvedExpected = paymentAmount;
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

    // A new customer from a collection account is a request, not a customer:
    // «لا يضاف حتي يراجع تحويله ومدفوعاته من حساب المسئول». Everything above
    // has checked it — the phone, the course, the amount — so what waits for
    // the manager is a booking that will go through as it is.
    if (reviewedByManager(req) && (createFromLead || createFromDraft)) {
      const requestId = uuidv4();
      const { password: _password, ...draftWithoutSecret } = subscriberDraft || {};
      // The round rides along, so the client is seated when the manager approves.
      const body = { lead_id: leadId || null, subscriber: draftWithoutSecret, payment: { ...payment, id: undefined }, ...(daqqiRoundId ? { daqqiRoundId } : {}) };
      await pool.query(
        `INSERT INTO subscriber_requests
           (id, tenant_id, requested_by, requested_by_name, lead_id, name, phone, email, amount, currency, body_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [requestId, paymentTenantId, req.staffRecord.id, req.staffRecord.name || null, leadId || null,
          sanitize(subRow.name || '', 300), subRow.phone || null, subRow.email || null,
          paymentAmount, paymentCurrency, JSON.stringify(body)]
      );
      createNotification('payment', '🆕 عميل جديد مستني مراجعتك',
        `${req.staffRecord.name || 'مسئول تحصيل'} — ${sanitize(subRow.name || '', 120)} · ${paymentAmount} ${paymentCurrency}`,
        { requestId, tab: 'orders' }, paymentTenantId).catch(() => {});
      return res.status(202).json({
        ok: true, requestId, status: 'pending_review', approvalRequired: true, subscriberCreated: false,
        message: 'اتبعت للمسئول — العميل هيتضاف بعد ما يراجع التحويل ويعتمده',
      });
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
          const lockError = new Error('في دفعة تانية للعميل ده بتتسجل دلوقتي — استنى ثواني وجرّب تاني.');
          lockError.statusCode = 409;
          throw lockError;
        }
        await conn.beginTransaction();
        await assertWritable(resolvedDate, conn, paymentTenantId);

        // ── Refuse a payment identical to one already recorded ───────────────
        //
        // Sixteen rows on production were byte-identical to another: same
        // subscriber, amount, day, method, transaction id and note. 49,460 EGP
        // recorded twice, removed and reversed separately.
        //
        // The GET_LOCK above stops two requests racing, which is a different
        // problem: it does nothing about the same payment being entered twice
        // ten minutes apart, and that is what actually happened.
        //
        // Every distinguishing field is compared, deliberately. Six groups on
        // production share subscriber, amount and day and are genuine second
        // payments — سهر احمد ربيع paid 900 EGP twice on 2026-05-07 against two
        // courses with two transfer numbers. A looser check would refuse real
        // money, so the error says which field to vary.
        //
        // COALESCE on both sides because NULL = NULL is never true in SQL, and a
        // pair of NULL transaction ids is exactly the case that needs catching.
        //
        // Inside the transaction and after the lock: a check outside either
        // would be a read that another writer can invalidate before the insert.
        {
          const [[twin]] = await conn.query(
            `SELECT id FROM payments
              WHERE tenant_id = ? AND deleted_at IS NULL
                AND subscriber_id = ?
                AND amount = ?
                AND DATE(\`date\`) = DATE(?)
                AND COALESCE(payment_method, '') = COALESCE(?, '')
                AND COALESCE(transaction_id, '') = COALESCE(?, '')
                AND COALESCE(course_id, '')     = COALESCE(?, '')
                AND COALESCE(bundle_id, '')     = COALESCE(?, '')
                AND COALESCE(note, '')          = COALESCE(?, '')
              LIMIT 1`,
            // The same expressions the INSERT below uses, so the check compares
            // what will actually be written rather than what was sent.
            [paymentTenantId, subscriber_id, paymentAmount, resolvedDate,
             sanitize(payment.paymentMethod || payment.payment_method || '', 100) || null,
             sanitize(payment.transactionId || payment.transaction_id || '', 191) || null,
             courseId || null, bundleId || null,
             sanitize(payment.note || payment.notes || '', 2000) || null]
          );
          if (twin) {
            const dupeError = new Error('\u062f\u0641\u0639\u0629 \u0645\u0637\u0627\u0628\u0642\u0629 \u062a\u0645\u0627\u0645\u0627\u064b \u0645\u0633\u062c\u0644\u0629 \u0628\u0627\u0644\u0641\u0639\u0644 \u0644\u0646\u0641\u0633 \u0627\u0644\u0639\u0645\u064a\u0644 \u0641\u064a \u0646\u0641\u0633 \u0627\u0644\u064a\u0648\u0645 \u2014 \u0628\u0646\u0641\u0633 \u0627\u0644\u0645\u0628\u0644\u063a \u0648\u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u062f\u0641\u0639 \u0648\u0631\u0642\u0645 \u0627\u0644\u0639\u0645\u0644\u064a\u0629. \u0644\u0648 \u062f\u064a \u062f\u0641\u0639\u0629 \u062a\u0627\u0646\u064a\u0629 \u062d\u0642\u064a\u0642\u064a\u0629\u060c \u063a\u064a\u0651\u0631 \u0631\u0642\u0645 \u0627\u0644\u0639\u0645\u0644\u064a\u0629 \u0623\u0648 \u0627\u0644\u0645\u0644\u0627\u062d\u0638\u0629 \u0642\u0628\u0644 \u0627\u0644\u062d\u0641\u0638.');
            dupeError.statusCode = 409;
            throw dupeError;
          }
        }
    if (createFromDraft) {
      const [[racedSubscriber]] = await conn.query(
        `SELECT id FROM subscribers
          WHERE tenant_id=? AND deleted_at IS NULL
            AND (phone=? OR (?<>'' AND email = ?))
          LIMIT 1 FOR UPDATE`,
        [paymentTenantId, subRow.phone, String(subRow.email || ''), String(subRow.email || '')]
      );
      if (racedSubscriber) {
        const error = new Error('الرقم أو الإيميل ده اتسجل على عميل تاني في نفس اللحظة — حدّث الصفحة وسجّل الدفعة عليه.');
        error.statusCode = 409;
        throw error;
      }
      const rep = approvingRequest
        ? { id: approvingRequest.requested_by, name: approvingRequest.requested_by_name }
        : await pickCollectionOfficer(conn, paymentTenantId, {
          market: subscriberMarket({ latestCurrency: paymentCurrency, branch: subRow.branch }), branch: subRow.branch,
        });
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
        const missing = await leadMissing(paymentTenantId, leadId);
        const error = new Error(missing.error);
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
        // Another request created this client while we were working. Their row
        // decides where they belong, but the branch chosen for this payment
        // still decides where the money is filed.
        if (!VALID_BRANCHES.has(chosenBranch)) {
          paymentBranch = subRow.branch || 'ONLINE_EGYPT';
          paymentBranchId = subRow.branch_id || branchIdForBranch(paymentBranch);
        }
      } else {
        let csId = approvingRequest?.requested_by || lockedLead.assigned_cs_id || null;
        let csName = approvingRequest ? approvingRequest.requested_by_name : (lockedLead.assigned_cs_name || null);
        if (!csId) {
          const rep = await pickCollectionOfficer(conn, paymentTenantId, {
            market: subscriberMarket({ latestCurrency: paymentCurrency, branch: lockedLead.branch }), branch: paymentBranch,
          });
          if (rep) { csId = rep.id; csName = rep.name; }
        }
        const clientCode = lockedLead.client_code || await getNextClientCode(conn);
        // NULL, not ''. subscribers carries UNIQUE (tenant_id, email), and one
        // row already holds the empty string — so every booking for somebody
        // without an email after that one was refused with «الدفعة دي متسجلة
        // بالفعل», four attempts in a row, over a field the desk left blank.
        // Measured in the production log: Duplicate entry 'tenant-default-'
        // for key 'uq_subs_tenant_email'. The same rule the phone column has
        // carried since subscriberProvisioningPhone.test.js.
        const email = sanitize(subscriberDraft.email || lockedLead.email || '', 255).toLowerCase() || null;
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
    if (bookingIdentity) {
      await applyBookingIdentity(conn, {
        tenantId: paymentTenantId,
        subscriberId: subscriber_id,
        identity: bookingIdentity,
        nationality: TIER_NATIONALITY[priceTier] || null,
      });
      subRow.name = bookingIdentity.nameAr;
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
        // The certificate's full price as the dialog states it, not this payment.
        price: payment.courseExpected ?? payment.course_expected ?? null,
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
        resolvedMethod,
        sanitize(payment.transactionId || payment.transaction_id || '', 191) || null,
        payment.isInstallment ? 1 : 0,
        resolvedExpected,
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

    // A price the desk entered is the client's price for the item from now on,
    // on every payment for it and on the client — so the online table, the
    // next instalment and the collections list all read the same number, and
    // an instalment at the new price does not disagree with the booking's. An
    // instalment with no price brings the item's rows to the agreed one too,
    // so the access check below never finds two prices for one course.
    if (resolvedExpected != null && (courseExpected != null || tierPrice || payment.isInstallment)
      && (courseId || bundleId) && ['COURSE', 'BUNDLE'].includes(safeType)) {
      await setAgreedPrice(conn, {
        tenantId: paymentTenantId, subscriberId: subscriber_id, courseId, bundleId, price: resolvedExpected,
      });
    }

    // Auto-create enrollment when payment is paid and a course/bundle is specified
    // access_type = 'full' only if NOT an installment payment AND amount covers the full expected price
    // access_type = 'limited' (preview-only) for partial/installment payments until fully paid
    if (isPaid && paysForItem && (courseId || bundleId)) {
      let enrollAccessType = 'full';
      let enrollPaidRatio = null;
      if (payment.isInstallment) {
        const resolved = await resolvePaymentAccess({
          db: conn,
          tenantId: paymentTenantId,
          subscriberId: subscriber_id,
          courseId,
          bundleId,
          currentPaymentId: id,
          currentAmount: paymentAmount,
          currency: paymentCurrency,
          expectedAmount: resolvedExpected,
        });
        enrollAccessType = accessModeOf(resolved);
        enrollPaidRatio = paidRatioOf(resolved);
      }
      await grantCourseSelections({
        tenantId: paymentTenantId, subscriberId: subscriber_id,
        selections: [{
          courseId: bundleId ? `bundle:${bundleId}` : courseId,
          accessType: enrollAccessType,
          // Was a flat 2 lectures for every partial payer. The ratio sizes it
          // against the course's own published count instead, so an instalment
          // opens what it paid for rather than the same two either way.
          lectureLimit: null,
          paidRatio: enrollPaidRatio,
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
      await convertLeadOfPayment({
        tenantId: paymentTenantId, leadId: linkedLeadId, db: conn,
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
    if (approvingRequest) {
      // Tied to the transfer that brought the money, and the request closed in
      // the same transaction — two managers approving at once get one customer.
      if (req.linkTransfer) await linkTransfer(conn, {
        tenantId: paymentTenantId, paymentId: id, link: req.linkTransfer,
        actor: { id: req.staffRecord?.id, name: signerName(req) },
      });
      const [closed] = await conn.query(
        `UPDATE subscriber_requests SET status='approved', subscriber_id=?, payment_id=?, reviewed_by=?,
            reviewed_by_name=?, reviewed_at=NOW()
          WHERE tenant_id=? AND id=? AND status='pending'`,
        [subscriber_id, id, req.staffRecord?.id || null, req.staffRecord?.name || req.user?.email || null,
          paymentTenantId, approvingRequest.id]
      );
      if (!closed.affectedRows) {
        throw Object.assign(new Error('الطلب ده اتراجع بالفعل'), { statusCode: 409 });
      }
    }
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

    if (approvingRequest) {
      createNotification('payment', '✅ اتعتمد العميل الجديد', `${subRow.name || 'عميل'} · ${paymentAmount} ${paymentCurrency}`,
        { subscriberId: subscriber_id, tab: 'online_clients' }, req.tenantId, approvingRequest.requested_by).catch(() => {});
    }
    // A collection officer's payment waits for the manager — say so where they look.
    if (!isPaid && reviewedByManager(req)) {
      createNotification('payment', '⏳ دفعة من التحصيل مستنية مراجعتك',
        `${req.staffRecord?.name || 'مسئول تحصيل'} — ${subRow.name || 'عميل'} · ${paymentAmount} ${paymentCurrency}`,
        { subscriberId: subscriber_id, paymentId: id, tab: 'orders' }, req.tenantId).catch(() => {});
    }
    // Notify admins of new payment
    if (isPaid) {
      createNotification('payment', '💰 دفعة جديدة', `${subRow.name || 'عميل'} — ${payment.amount} ${payment.currency || 'EGP'}${req.staffRecord?.name ? ` · سجّلها ${req.staffRecord.name}` : ''}`, { subscriberId: subscriber_id, paymentId: id, amount: payment.amount }, req.tenantId).catch(() => {});
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
        const paymentDate = new Date(payment.date || payment.at || Date.now()).toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Cairo' });
        // The email receipt is queued below (lib/paymentReceipt.js), with what
        // this payment opened. It was written here as well, so two arrived.
        // Send WhatsApp payment confirmation to subscriber
        const subPhone = await pool.query(
          'SELECT phone FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1',
          [subscriber_id, paymentTenantId]
        )
          .then(([[r]]) => r?.phone || null).catch(() => null);
        if (subPhone) {
          const waMsg = `✅ تم استلام دفعتك بنجاح!\nالمبلغ: ${payment.amount} ${payment.currency || 'EGP'}${courseLabel ? '\nالبرنامج: ' + courseLabel : ''}\nالتاريخ: ${paymentDate}\nشكراً لثقتك بمعهد الدراسات النفسية 💚`;
          sendWhatsApp(subPhone.replace(/\D/g, ''), waMsg, { tenantId: paymentTenantId, category: 'payment' }).catch(() => {});
        }
      }
    }
    // Enqueue enrollment email sequence (best-effort)
    if (isPaid && subRow.email) {
      enqueueEmailSequence({ tenantId: paymentTenantId, triggerEvent: 'enrollment', recipientEmail: subRow.email, recipientName: subRow.name || '' }).catch(error => logger.warn('[subscriber-payment] sequence enqueue failed', { error: error.message }));
      // The receipt: the amount, and what of the course it opened.
      queuePaymentReceipt(paymentTenantId, id);
    }
    // The booking is committed; seating is its own step, and a client who paid but
    // could not be seated is told so rather than losing the payment with it.
    let housed;
    if (daqqiRoundId) {
      housed = await seatInOwnTransaction(pool, { tenantId: paymentTenantId, roundId: daqqiRoundId, subscriberId: subscriber_id, req })
        .then(seat => seat.status === 'already' ? 'seated' : seat.status, error => {
          logger.warn('[subscriber-payment] seating after the booking failed', { error: error.message });
          return 'failed';
        });
    }
    res.json({
      ok: true,
      id,
      subscriberId: subscriber_id,
      subscriberCreated: createFromLead || createFromDraft,
      status: storedStatus,
      approvalRequired: storedStatus === 'pending',
      ...(housed ? { housed } : {}),
    });
  } catch (e) {
    if (conn) { await conn.rollback().catch(() => {}); conn.release(); conn = null; }
    logger.error('[route]', e.message);
    // A duplicate here is nearly always the transaction reference: the column
    // is unique across the institute, so the second payment carrying a number
    // the desk has used before is refused. «Payment ID or transaction
    // reference already exists» told the person recording it neither which
    // number nor which payment, in a language the desk does not read — so say
    // what is already there, and let them change it or clear it.
    if (e?.code === 'ER_DUP_ENTRY') {
      const reference = sanitize(req.body?.payment?.transactionId || req.body?.payment?.transaction_id || '', 191);
      if (reference) {
        const [[owner]] = await pool.query(
          `SELECT p.date, p.amount, p.currency, s.name
             FROM payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
            WHERE p.transaction_id = ? LIMIT 1`, [reference]).catch(() => [[null]]);
        const when = owner ? String(safeDateOnly(owner.date) || '') : '';
        return res.status(409).json({
          code: 'TRANSACTION_REFERENCE_IN_USE',
          error: owner
            ? `الرقم المرجعي «${reference}» متسجل قبل كده على دفعة ${Math.round(Number(owner.amount) || 0)} ${owner.currency || 'EGP'}`
              + `${owner.name ? ` باسم ${owner.name}` : ''}${when ? ` بتاريخ ${when}` : ''}. غيّر الرقم أو سيبه فاضي.`
            : `الرقم المرجعي «${reference}» متسجل قبل كده على دفعة تانية. غيّر الرقم أو سيبه فاضي.`,
        });
      }
      return res.status(409).json({ error: 'الدفعة دي متسجلة بالفعل.', code: 'PAYMENT_ALREADY_EXISTS' });
    }
    res.status(e?.statusCode || 500).json({ error: e?.statusCode ? e.message : 'Internal server error' });
  }
}

router.post('/api/admin/subscriber-payments', requireAuth, requireAdminOrStaff, requirePermission('manage_payments'), recordSubscriberPayment);

// ── New customers from collection accounts, waiting for the manager ─────────

const requestRow = row => {
  const body = (() => { try { return JSON.parse(row.body_json || '{}'); } catch { return {}; } })();
  return {
    id: row.id, status: row.status, name: row.name, phone: row.phone, email: row.email,
    amount: Number(row.amount) || 0, currency: row.currency, leadId: row.lead_id,
    requestedBy: row.requested_by, requestedByName: row.requested_by_name,
    reviewNote: row.review_note, reviewedByName: row.reviewed_by_name, reviewedAt: row.reviewed_at,
    subscriberId: row.subscriber_id, paymentId: row.payment_id, createdAt: row.created_at,
    payment: {
      courseId: body.payment?.courseId || null, bundleId: body.payment?.bundleId || null,
      paymentMethod: body.payment?.paymentMethod || null, transactionId: body.payment?.transactionId || null,
      fromAccountNumber: body.payment?.fromAccountNumber || null, date: body.payment?.date || body.payment?.at || null,
      isInstallment: !!body.payment?.isInstallment, courseExpected: body.payment?.courseExpected ?? null,
      note: body.payment?.note || null, paymentType: body.payment?.paymentType || null,
    },
  };
};

// The officer's own requests, with where each stands.
router.get('/api/staff/subscriber-requests', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    if (!req.staffRecord?.id) return res.json([]);
    const [rows] = await pool.query(
      `SELECT * FROM subscriber_requests WHERE tenant_id=? AND requested_by=? ORDER BY created_at DESC LIMIT 200`,
      [req.tenantId, req.staffRecord.id]);
    res.json(rows.map(requestRow));
  } catch (e) { logger.error('[subscriber-requests/mine]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// The manager's queue.
router.get('/api/admin/subscriber-requests', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(String(req.query.status)) ? String(req.query.status) : null;
    const [rows] = await pool.query(
      `SELECT * FROM subscriber_requests WHERE tenant_id=?${status ? ' AND status=?' : ''}
        ORDER BY (status='pending') DESC, created_at DESC LIMIT 300`,
      status ? [req.tenantId, status] : [req.tenantId]);
    res.json(rows.map(requestRow));
  } catch (e) { logger.error('[subscriber-requests/list]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

const refuseReviewer = (req, request) => {
  if (reviewedByManager(req)) return 'اعتماد حجوزات التحصيل شغل المسئول';
  if (request && String(request.requested_by) === String(req.staffRecord?.id || '')) return 'مينفعش تعتمد طلب انت اللي سجلته';
  return null;
};

// Approve: the booking goes through as the officer sent it, tied to the transfer.
router.post('/api/admin/subscriber-requests/:id/approve', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const [[request]] = await pool.query(
      'SELECT * FROM subscriber_requests WHERE tenant_id=? AND id=? LIMIT 1', [req.tenantId, req.params.id]);
    if (!request) return res.status(404).json({ error: 'الطلب مش موجود' });
    if (request.status !== 'pending') return res.status(409).json({ error: 'الطلب ده اتراجع بالفعل' });
    const refusal = refuseReviewer(req, request);
    if (refusal) return res.status(403).json({ error: refusal });
    const transfer = req.body?.transfer && typeof req.body.transfer === 'object' ? req.body.transfer : null;
    const suppliedMethod = req.body?.paymentMethod;
    const body = JSON.parse(request.body_json || '{}');
    // Counted cash has no transfer to point at; every other box does.
    if (!transfer && !isCashMethod(body.payment?.paymentMethod || suppliedMethod)) {
      return res.status(400).json({ error: 'اربط الحجز بالتحويل اللي وصل قبل الاعتماد', code: 'TRANSFER_REQUIRED' });
    }
    // The money as the officer recorded it, credited to them; only the method
    // may be filled in here, for a draft that reached review without one.
    body.payment = {
      ...(body.payment || {}), status: 'paid', staffId: request.requested_by,
      paymentMethod: body.payment?.paymentMethod || suppliedMethod || undefined,
    };
    req.body = body;
    req.subscriberRequest = request;
    req.linkTransfer = transfer;
    return recordSubscriberPayment(req, res);
  } catch (e) { logger.error('[subscriber-requests/approve]', e.message); res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' }); }
});

router.post('/api/admin/subscriber-requests/:id/reject', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const [[request]] = await pool.query(
      'SELECT id, requested_by, status, name FROM subscriber_requests WHERE tenant_id=? AND id=? LIMIT 1', [req.tenantId, req.params.id]);
    if (!request) return res.status(404).json({ error: 'الطلب مش موجود' });
    const refusal = refuseReviewer(req, request);
    if (refusal) return res.status(403).json({ error: refusal });
    const note = sanitize(req.body?.note || '', 1000) || null;
    const [result] = await pool.query(
      `UPDATE subscriber_requests SET status='rejected', review_note=?, reviewed_by=?, reviewed_by_name=?, reviewed_at=NOW()
        WHERE tenant_id=? AND id=? AND status='pending'`,
      [note, req.staffRecord?.id || null, req.staffRecord?.name || req.user?.email || null, req.tenantId, request.id]);
    if (!result.affectedRows) return res.status(409).json({ error: 'الطلب ده اتراجع بالفعل' });
    createNotification('payment', 'اترفض حجز عميل جديد', `${request.name}${note ? ` — ${note}` : ''}`,
      { tab: 'orders' }, req.tenantId, request.requested_by).catch(() => {});
    res.json({ ok: true });
  } catch (e) { logger.error('[subscriber-requests/reject]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// The same recording path, for a correction that is a different payment (lib/paymentCorrections.js).
router.recordSubscriberPayment = recordSubscriberPayment;
module.exports = router;
