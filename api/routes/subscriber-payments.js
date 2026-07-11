'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');
const { pool } = require('../lib/db');
const { mailer, sendEmail, htmlEmail } = require('../lib/email');
const { sendWhatsApp } = require('../lib/whatsapp');
const { tryJson, sanitize } = require('../lib/helpers');
const { createNotification } = require('../lib/notification');
const { logPaymentAudit, postJournalEntry, _paymentAccountCode, toEgp } = require('../lib/finance');
const { logLeadEvent } = require('../lib/crm');
const { syncLeadDealValue } = require('./public-orders');
const { enqueueEmailSequence } = require('../lib/emailSequence');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { safeDateOnly } = require('../lib/dates');

router.post('/api/admin/subscriber-payments', requireAuth, requireAdminOrStaff, requirePermission('manage_orders'), async (req, res) => {
  let conn;
  try {
    const { subscriber_id, payment } = req.body;
    if (!subscriber_id || !payment) return res.status(400).json({ error: 'subscriber_id and payment required' });
    if (!payment.amount || Number(payment.amount) <= 0) return res.status(400).json({ error: 'payment.amount must be > 0' });
    // Validate subscriber exists — also fetch assigned_sales_id for commission lookup
    const [[subRow]] = await pool.query('SELECT id, email, assigned_sales_id FROM subscribers WHERE id = ? LIMIT 1', [subscriber_id]);
    if (!subRow) return res.status(404).json({ error: 'Subscriber not found' });
    const id = payment.id || uuidv4();
    const paymentType = (payment.paymentType || payment.payment_type || 'OTHER').toUpperCase();
    const validTypes = ['COURSE','CERTIFICATE','CONSULTATION','BOOK','CARNEH','OTHER'];
    const safeType = validTypes.includes(paymentType) ? paymentType : 'OTHER';
    // Resolve staff name from staff table
    let resolvedStaffName = payment.staffName || payment.staff_name || null;
    const resolvedStaffId = payment.staffId || payment.staff_id || null;
    if (!resolvedStaffName && resolvedStaffId) {
      const [[su]] = await pool.query('SELECT name FROM staff WHERE id = ? LIMIT 1', [resolvedStaffId]).catch(() => [[null]]);
      if (su) resolvedStaffName = su.name || null;
    }
    const VALID_SOURCES_SP = new Set(['web','staff','reception','daqqi','paymob','system']);
    const resolvedSource = VALID_SOURCES_SP.has(payment.source) ? payment.source : null;
    const resolvedDate = payment.date || payment.at || new Date().toISOString().slice(0, 10);
    const isPaid = (payment.status || 'paid') === 'paid';
    const courseId = payment.courseId || payment.course_id || null;
    const bundleId = payment.bundleId || payment.bundle_id || null;

    // ── Begin atomic transaction ──────────────────────────────────────────────
    conn = await pool.getConnection();
    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO payments
         (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method,
          transaction_id, is_installment, course_expected, date, note, status, staff_id, staff_name,
          from_account, source, item_title, cert_type, branch)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, subscriber_id,
        courseId, bundleId,
        payment.amount || 0,
        payment.currency || 'EGP',
        safeType,
        payment.paymentMethod || payment.payment_method || null,
        payment.transactionId || payment.transaction_id || null,
        payment.isInstallment ? 1 : 0,
        payment.courseExpected != null ? Number(payment.courseExpected) : (payment.isInstallment ? null : (Number(payment.amount) || null)),
        resolvedDate,
        payment.note || payment.notes || null,
        payment.status || 'paid',
        resolvedStaffId,
        resolvedStaffName,
        payment.fromAccountNumber || payment.from_account || null,
        resolvedSource,
        payment.itemTitle || payment.item_title || null,
        payment.certType || payment.cert_type || null,
        subRow.branch || null,
      ]
    );

    // Auto-create enrollment when payment is paid and a course/bundle is specified
    // access_type = 'full' only if NOT an installment payment AND amount covers the full expected price
    // access_type = 'limited' (preview-only) for partial/installment payments until fully paid
    if (isPaid && (courseId || bundleId)) {
      let enrollAccessType = 'full';
      if (payment.isInstallment) {
        // Installment payment — check if this payment completes the expected total
        const courseExpected = payment.courseExpected != null ? Number(payment.courseExpected) : 0;
        if (courseExpected > 0) {
          const [[paidRow]] = await conn.query(
            `SELECT COALESCE(SUM(amount),0) AS total_paid
             FROM payments
             WHERE subscriber_id=? AND (course_id=? OR bundle_id=?) AND status='paid'`,
            [subscriber_id, courseId || null, bundleId || null]
          );
          const totalPaid = Number(paidRow?.total_paid || 0) + Number(payment.amount || 0);
          enrollAccessType = totalPaid >= courseExpected ? 'full' : 'limited';
        } else {
          enrollAccessType = 'limited'; // no expected price set → restrict until manually updated
        }
      }
      await conn.query(
        `INSERT INTO enrollments (id, subscriber_id, course_id, bundle_id, enrolled_at, access_type)
         VALUES (?,?,?,?,NOW(),?)
         ON DUPLICATE KEY UPDATE
           access_type = CASE
             WHEN VALUES(access_type)='full' THEN 'full'
             ELSE access_type
           END`,
        [uuidv4(), subscriber_id, courseId, bundleId, enrollAccessType]
      );
      // Also sync crm_json: add courseId/bundleId to enrolledCourseIds and set courseAccess
      setImmediate(async () => {
        try {
          const [[subCrm2]] = await pool.query('SELECT crm_json FROM subscribers WHERE id=? LIMIT 1', [subscriber_id]);
          if (!subCrm2) return;
          const crm2 = tryJson(subCrm2.crm_json, {});
          crm2.enrolledCourseIds = crm2.enrolledCourseIds || [];
          if (courseId && !crm2.enrolledCourseIds.includes(courseId)) {
            crm2.enrolledCourseIds.push(courseId);
          }
          if (bundleId && !crm2.enrolledCourseIds.includes(`bundle:${bundleId}`)) {
            crm2.enrolledCourseIds.push(`bundle:${bundleId}`);
          }
          crm2.courseAccess = crm2.courseAccess || {};
          if (courseId) {
            crm2.courseAccess[courseId] = enrollAccessType === 'full'
              ? 'full'
              : { mode: 'limited', lectureLimit: 2 }; // default 2 preview lectures for partial pay
          }
          await pool.query('UPDATE subscribers SET crm_json=? WHERE id=?', [JSON.stringify(crm2), subscriber_id]);
        } catch (crmSyncErr) { logger.error('[payment] crm enrolledCourseIds sync failed', crmSyncErr.message); }
      });
    }

    // Auto-calculate and record commission for the responsible staff member
    // Applies to ALL paid payments (including installments — each installment earns a proportional commission)
    const commStaffId = resolvedStaffId || subRow.assigned_sales_id || null;
    if (isPaid && commStaffId && Number(payment.amount) > 0) {
      const [[rule]] = await conn.query(`
        SELECT id, percentage_value
        FROM commission_rules
        WHERE is_active = 1
          AND calc_type = 'PERCENTAGE'
          AND (staff_id = ? OR (staff_id IS NULL AND JSON_CONTAINS(COALESCE(apply_to_roles,'[]'), JSON_QUOTE(
            (SELECT role FROM staff WHERE id = ? LIMIT 1)
          ))))
          AND effective_from <= CURDATE()
          AND (effective_to IS NULL OR effective_to >= CURDATE())
          AND (min_payment IS NULL OR min_payment <= ?)
        ORDER BY staff_id DESC, priority ASC
        LIMIT 1
      `, [commStaffId, commStaffId, Number(payment.amount)]).catch(() => [[null]]);

      let commRate = rule?.percentage_value || 0;
      if (!commRate) {
        const [[stf]] = await conn.query('SELECT commission_rate FROM staff WHERE id = ? LIMIT 1', [commStaffId]).catch(() => [[null]]);
        commRate = stf?.commission_rate || 0;
      }

      if (commRate > 0) {
        // Commission stored in EGP so payroll sums stay single-currency
        const amtEgp = await toEgp(Number(payment.amount), payment.currency);
        const commAmount = parseFloat((amtEgp * commRate / 100).toFixed(2));
        const now = new Date();
        const commNote = payment.isInstallment ? `قسط — ${commRate}% من ${payment.amount}` : null;
        await conn.query(
          `INSERT INTO crm_commissions
             (id, staff_id, payment_id, rule_id, client_id, client_type, payment_amount,
              commission_amount, calc_details, month, year, status, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,'PENDING',NOW())
           ON DUPLICATE KEY UPDATE commission_amount=VALUES(commission_amount)`,
          [
            uuidv4(), commStaffId, id, rule?.id || null, subscriber_id, 'subscriber',
            amtEgp, commAmount,
            JSON.stringify({ rate: commRate, calc_type: 'PERCENTAGE', rule_id: rule?.id || null, isInstallment: !!payment.isInstallment, note: commNote, originalAmount: Number(payment.amount), originalCurrency: payment.currency || 'EGP' }),
            now.getMonth() + 1, now.getFullYear()
          ]
        );
      }
    }

    // Auto-create instructor_fee when a COURSE payment is made and instructor has revenue_share_pct set
    if (isPaid && courseId && safeType === 'COURSE') {
      try {
        const [[courseRow]] = await conn.query('SELECT instructor_id FROM courses WHERE id = ? LIMIT 1', [courseId]).catch(() => [[null]]);
        if (courseRow?.instructor_id) {
          const [[iRates]] = await conn.query('SELECT revenue_share_pct, currency FROM instructor_rates WHERE staff_id = ? LIMIT 1', [courseRow.instructor_id]).catch(() => [[null]]);
          const sharePct = parseFloat(iRates?.revenue_share_pct || 0);
          if (sharePct > 0) {
            const feeAmount = parseFloat((Number(payment.amount) * sharePct / 100).toFixed(2));
            const feeNow = new Date();
            await conn.query(
              `INSERT INTO instructor_fees (id, staff_id, course_id, fee_type, fixed_amount, total_amount, currency, period_month, period_year, note, created_by)
               VALUES (?,?,?,'fixed',?,?,?,?,?,?,?)`,
              [uuidv4(), courseRow.instructor_id, courseId, feeAmount, feeAmount,
               iRates?.currency || 'EGP', feeNow.getMonth() + 1, feeNow.getFullYear(),
               `حصة تلقائية ${sharePct}% من دفعة ${id}`, resolvedStaffId || 'system']
            );
          }
        }
      } catch (feeErr) { logger.warn('[subscriber-payments] instructor fee auto-calc:', feeErr.message); }
    }

    await conn.commit();
    conn.release();
    conn = null;
    // ── End transaction ───────────────────────────────────────────────────────

    // Post double-entry journal (best-effort, post-commit).
    // Amounts are normalised to EGP so P&L / trial balance stay single-currency.
    if (isPaid) {
      const [accCode, accName] = _paymentAccountCode(safeType);
      const rawAmt = Number(payment.amount) || 0;
      toEgp(rawAmt, payment.currency).then(amtEgp =>
        postJournalEntry('payment', id, resolvedDate,
          `دفعة ${rawAmt} ${payment.currency || 'EGP'} (= ${amtEgp} EGP) — ${safeType}`,
          [
            { account_code: '1100', account_name: 'نقدية وبنوك', debit: amtEgp, credit: 0 },
            { account_code: accCode, account_name: accName, debit: 0, credit: amtEgp },
          ],
          req.user?.email || 'system'
        )
      ).catch(() => {});
    }

    // Sync crm_json.paymentHistory (non-critical, post-commit)
    setImmediate(async () => {
      try {
        const [[subCrm]] = await pool.query('SELECT crm_json FROM subscribers WHERE id = ? LIMIT 1', [subscriber_id]);
        if (subCrm) {
          const crm = tryJson(subCrm.crm_json, {});
          crm.paymentHistory = crm.paymentHistory || [];
          if (!crm.paymentHistory.find(p => p.id === id)) {
            crm.paymentHistory.push({
              id, status: payment.status || 'paid',
              amount: Number(payment.amount) || 0,
              currency: payment.currency || 'EGP',
              paymentType: safeType.toLowerCase(),
              paymentMethod: payment.paymentMethod || payment.payment_method || null,
              transactionId: payment.transactionId || payment.transaction_id || null,
              isInstallment: !!payment.isInstallment,
              courseId, bundleId,
              note: payment.note || payment.notes || null,
              at: resolvedDate,
              staffId: resolvedStaffId,
              staffName: resolvedStaffName,
              fromAccountNumber: payment.fromAccountNumber || payment.from_account || null,
              source: resolvedSource,
              itemTitle: payment.itemTitle || payment.item_title || null,
              certType: payment.certType || payment.cert_type || null,
            });
            await pool.query('UPDATE subscribers SET crm_json = ? WHERE id = ?', [JSON.stringify(crm), subscriber_id]);
          }
        }
      } catch (crmErr) { logger.error('[subscriber-payments] crm_json sync failed', id, crmErr.message); }
    });
    // Audit log
    logPaymentAudit(id, 'create', null, payment.status || 'paid', payment.amount || 0, subscriber_id, req.user?.email || req.user?.uid).catch(() => {});
    // Notify admins of new payment
    if (isPaid) {
      createNotification('payment', '💰 دفعة جديدة', `دفعة ${payment.amount} ${payment.currency || 'EGP'} من مشترك`, { subscriberId: subscriber_id, paymentId: id, amount: payment.amount }).catch(() => {});
      // Send receipt email to subscriber
      if (subRow.email) {
        let courseLabel = '';
        if (courseId) {
          const [[ci]] = await pool.query('SELECT title FROM courses WHERE id=? LIMIT 1', [courseId]).catch(() => [[null]]);
          courseLabel = ci?.title || '';
        } else if (bundleId) {
          const [[bi]] = await pool.query('SELECT title FROM bundles WHERE id=? LIMIT 1', [bundleId]).catch(() => [[null]]);
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
        const subPhone = await pool.query('SELECT phone FROM subscribers WHERE id=? LIMIT 1', [subscriber_id])
          .then(([[r]]) => r?.phone || null).catch(() => null);
        if (subPhone) {
          const waMsg = `✅ تم استلام دفعتك بنجاح!\nالمبلغ: ${payment.amount} ${payment.currency || 'EGP'}${courseLabel ? '\nالبرنامج: ' + courseLabel : ''}\nالتاريخ: ${paymentDate}\nشكراً لثقتك بمعهد الدراسات النفسية 💚`;
          sendWhatsApp(subPhone.replace(/\D/g, ''), waMsg).catch(() => {});
        }
      }
    }
    // Auto-convert any matching lead to 'converted' status
    if (subRow.email) {
      pool.query(
        "UPDATE leads SET status='converted' WHERE LOWER(email)=LOWER(?) AND LOWER(status) NOT IN ('converted','lost') LIMIT 5",
        [subRow.email]
      ).catch(() => {});
    }
    // Auto-sync lead deal_value from total payments
    syncLeadDealValue(subscriber_id).catch(() => {});
    // Enqueue enrollment email sequence (best-effort)
    if (isPaid && subRow.email) {
      enqueueEmailSequence('enrollment', subRow.email, null, Date.now()).catch(() => {});
      // Lifecycle: instant payment receipt (email; whatsapp handled above).
      require('../lib/lifecycle').trigger('payment_received',
        { name: subRow.name, email: subRow.email, amount: payment.amount, currency: payment.currency },
        { channels: ['email'] });
    }
    res.json({ ok: true, id });
  } catch (e) {
    if (conn) { await conn.rollback().catch(() => {}); conn.release(); conn = null; }
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


module.exports = router;
