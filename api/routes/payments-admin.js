'use strict';

const express = require('express');
const router = express.Router();

const { uuidv4 } = require('../lib/id');
const { pool } = require('../lib/db');
const { sendEmail } = require('../lib/email');
const { sendWhatsApp } = require('../lib/whatsapp');
const { tryJson } = require('../lib/helpers');
const { createNotification } = require('../lib/notification');
const { logPaymentAudit, postJournalEntry, _paymentAccountCode } = require('../lib/finance');
const { syncLeadDealValue } = require('../lib/leadDealValue');
const { enqueueEmailSequence } = require('../lib/emailSequence');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { safeDateOnly } = require('../lib/dates');

// PATCH /api/admin/payments/:id/status — approve or reject a payment (admin/manager)
router.patch('/api/admin/payments/:id/status', requireAuth, requireAdminOrStaff, requirePermission('manage_payments'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reviewNote } = req.body || {};
    if (!['paid', 'failed', 'pending'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const actor = req.user?.email || 'admin';

    const [[pay]] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method,
       transaction_id, is_installment, \`date\`, note, status, staff_id, staff_name, from_account,
       source, item_title, cert_type, created_at
       FROM payments WHERE id = ? LIMIT 1`, [id]);
    if (!pay) return res.status(404).json({ error: 'Payment not found' });

    const oldStatus = pay.status || 'paid';
    await pool.query(
      `UPDATE payments SET status = ?, note = COALESCE(CONCAT(COALESCE(note,''), IF(?!='', CONCAT(' | مراجعة: ', ?), '')), note) WHERE id = ?`,
      [status, reviewNote || '', reviewNote || '', id]
    );
    await logPaymentAudit(id, 'update', oldStatus, status, pay.amount, pay.subscriber_id, actor);

    if (pay.subscriber_id) {
      const [[sub]] = await pool.query('SELECT crm_json, assigned_sales_id FROM subscribers WHERE id = ? LIMIT 1', [pay.subscriber_id]);
      if (sub) {
        const crm = tryJson(sub.crm_json, {});
        crm.paymentHistory = crm.paymentHistory || [];
        const idx = crm.paymentHistory.findIndex(p => p.id === id);
        const dateStr = safeDateOnly(pay.date);
        if (idx >= 0) {
          crm.paymentHistory[idx] = { ...crm.paymentHistory[idx], status };
        } else {
          crm.paymentHistory.push({
            id, status,
            amount: Number(pay.amount) || 0,
            currency: pay.currency || 'EGP',
            paymentType: (pay.payment_type || 'other').toLowerCase(),
            paymentMethod: pay.payment_method || null,
            transactionId: pay.transaction_id || null,
            isInstallment: !!pay.is_installment,
            courseId: pay.course_id || null,
            bundleId: pay.bundle_id || null,
            note: pay.note || null,
            at: dateStr,
            staffId: pay.staff_id || null,
            staffName: pay.staff_name || null,
            fromAccountNumber: pay.from_account || null,
            source: pay.source || null,
            itemTitle: pay.item_title || null,
            certType: pay.cert_type || null,
          });
        }
        const becomingPaid = status === 'paid' && oldStatus !== 'paid';
        const courseId = pay.course_id || null;
        const bundleId = pay.bundle_id || null;
        if (becomingPaid && (courseId || bundleId)) {
          crm.enrolledCourseIds = crm.enrolledCourseIds || [];
          if (courseId && !crm.enrolledCourseIds.includes(courseId)) {
            crm.enrolledCourseIds.push(courseId);
            crm.courseAccess = crm.courseAccess || {};
            if (!crm.courseAccess[courseId]) crm.courseAccess[courseId] = 'full';
          }
          let patchAccessType = 'full';
          if (pay.is_installment) {
            const courseExpected = pay.course_expected ? Number(pay.course_expected) : 0;
            if (courseExpected > 0) {
              const [[paidRow]] = await pool.query(
                `SELECT COALESCE(SUM(amount),0) AS total_paid FROM payments
                 WHERE subscriber_id=? AND (course_id=? OR (? IS NOT NULL AND bundle_id=?)) AND status='paid'`,
                [pay.subscriber_id, courseId || null, bundleId, bundleId || null]
              ).catch(() => [[{ total_paid: 0 }]]);
              const totalPaid = Number(paidRow?.total_paid || 0) + Number(pay.amount || 0);
              patchAccessType = totalPaid >= courseExpected ? 'full' : 'limited';
            } else {
              patchAccessType = 'limited';
            }
            if (courseId && crm.courseAccess) {
              crm.courseAccess[courseId] = patchAccessType;
            }
          }
          await pool.query(
            `INSERT INTO enrollments (id, subscriber_id, course_id, bundle_id, enrolled_at, access_type)
             VALUES (?,?,?,?,NOW(),?)
             ON DUPLICATE KEY UPDATE access_type=IF(VALUES(access_type)='full','full',access_type)`,
            [uuidv4(), pay.subscriber_id, courseId, bundleId, patchAccessType]
          ).catch(() => {});
        }
        await pool.query('UPDATE subscribers SET crm_json = ? WHERE id = ?', [JSON.stringify(crm), pay.subscriber_id]);

        if (becomingPaid && Number(pay.amount) > 0) {
          const commStaffId = pay.staff_id || sub.assigned_sales_id || null;
          if (commStaffId) {
            try {
              const [[commSub]] = await pool.query('SELECT assigned_sales_id FROM subscribers WHERE id=? LIMIT 1', [pay.subscriber_id]);
              const finalStaffId = pay.staff_id || commSub?.assigned_sales_id || null;
              if (finalStaffId) {
                const [[rule]] = await pool.query(`
                  SELECT id, percentage_value FROM commission_rules
                  WHERE is_active=1 AND calc_type='PERCENTAGE'
                    AND (staff_id=? OR (staff_id IS NULL AND JSON_CONTAINS(COALESCE(apply_to_roles,'[]'), JSON_QUOTE((SELECT role FROM staff WHERE id=? LIMIT 1)))))
                    AND effective_from <= CURDATE() AND (effective_to IS NULL OR effective_to >= CURDATE())
                    AND (min_payment IS NULL OR min_payment <= ?)
                  ORDER BY staff_id DESC, priority ASC LIMIT 1
                `, [finalStaffId, finalStaffId, Number(pay.amount)]).catch(() => [[null]]);
                let commRate = rule?.percentage_value || 0;
                if (!commRate) {
                  const [[stf]] = await pool.query('SELECT commission_rate FROM staff WHERE id=? LIMIT 1', [finalStaffId]).catch(() => [[null]]);
                  commRate = stf?.commission_rate || 0;
                }
                if (commRate > 0) {
                  const commAmount = parseFloat((Number(pay.amount) * commRate / 100).toFixed(2));
                  const now = new Date();
                  await pool.query(
                    `INSERT INTO crm_commissions (id, staff_id, payment_id, rule_id, client_id, client_type, payment_amount, commission_amount, calc_details, month, year, status, created_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,'PENDING',NOW()) ON DUPLICATE KEY UPDATE commission_amount=VALUES(commission_amount)`,
                    [uuidv4(), finalStaffId, id, rule?.id||null, pay.subscriber_id, 'subscriber',
                     Number(pay.amount), commAmount,
                     JSON.stringify({ rate: commRate, calc_type: 'PERCENTAGE', rule_id: rule?.id||null, trigger: 'status_change_to_paid' }),
                     now.getMonth()+1, now.getFullYear()]
                  );
                }
              }
            } catch (commErr) { console.warn('[patch-payment] commission calc error:', commErr.message); }
          }
          const [[subPhone]] = await pool.query('SELECT phone FROM subscribers WHERE id=? LIMIT 1', [pay.subscriber_id]).catch(() => [[null]]);
          if (subPhone?.phone) {
            const payDateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
            let courseLabel = '';
            if (courseId) {
              const [[ci]] = await pool.query('SELECT title FROM courses WHERE id=? LIMIT 1', [courseId]).catch(() => [[null]]);
              courseLabel = ci?.title || '';
            }
            const waMsg = `✅ تم تأكيد دفعتك!\nالمبلغ: ${pay.amount} ${pay.currency || 'EGP'}${courseLabel ? '\nالبرنامج: ' + courseLabel : ''}\nالتاريخ: ${payDateStr}\nشكراً لثقتك بمعهد الدراسات النفسية 💚`;
            sendWhatsApp(subPhone.phone.replace(/\D/g, ''), waMsg).catch(() => {});
          }
        }
      }
    }

    res.json({ ok: true, id, status });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/backfill-payments — one-time: sync paymentHistory from crm_json → payments table
router.post('/api/admin/backfill-payments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, crm_json FROM subscribers WHERE crm_json IS NOT NULL LIMIT 5000`
    );
    let inserted = 0, skipped = 0;
    const VALID_TYPES = new Set(['COURSE','CERTIFICATE','CONSULTATION','BOOK','CARNEH','OTHER']);
    for (const row of rows) {
      const crm = tryJson(row.crm_json, {});
      const history = Array.isArray(crm.paymentHistory) ? crm.paymentHistory : [];
      for (const p of history) {
        if (!p.id || !p.amount || Number(p.amount) <= 0) { skipped++; continue; }
        const payType = (p.paymentType || 'OTHER').toUpperCase();
        const safeType = VALID_TYPES.has(payType) ? payType : 'OTHER';
        const dateVal = p.at || p.date || new Date().toISOString().slice(0, 10);
        try {
          const [result] = await pool.query(
            `INSERT IGNORE INTO payments
               (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type,
                payment_method, transaction_id, is_installment, date, note)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              p.id, row.id,
              p.courseId || null, p.bundleId || null,
              Number(p.amount) || 0,
              p.currency || 'EGP',
              safeType,
              p.paymentMethod || null,
              p.transactionId || null,
              p.isInstallment ? 1 : 0,
              typeof dateVal === 'string' ? dateVal.slice(0,10) : new Date().toISOString().slice(0,10),
              p.note || null,
            ]
          );
          if (result.affectedRows > 0) inserted++; else skipped++;
        } catch (_) { skipped++; }
      }
    }
    console.log(`[backfill-payments] inserted=${inserted} skipped=${skipped}`);
    res.json({ ok: true, inserted, skipped });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/reconcile-payments
router.get('/api/admin/reconcile-payments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        s.name,
        s.email,
        s.client_code,
        s.branch,
        c.title   AS course_title,
        e.enrolled_at,
        p.id      AS payment_id,
        p.amount  AS payment_amount
      FROM enrollments e
      JOIN subscribers s ON s.id = e.subscriber_id
      LEFT JOIN courses c ON c.id = e.course_id
      LEFT JOIN payments p ON p.subscriber_id = e.subscriber_id
        AND (p.course_id = e.course_id OR p.course_id IS NULL)
      WHERE p.id IS NULL
      ORDER BY e.enrolled_at DESC
      LIMIT 500
    `);
    const [[totals]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM enrollments) AS total_enrollments,
        (SELECT COUNT(*) FROM payments)    AS total_payments,
        COUNT(DISTINCT e.id)               AS unpaid_enrollments
      FROM enrollments e
      LEFT JOIN payments p ON p.subscriber_id = e.subscriber_id
        AND (p.course_id = e.course_id OR p.course_id IS NULL)
      WHERE p.id IS NULL
    `);
    res.json({ summary: totals, unpaid: rows });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/payment-audit
router.get('/api/admin/payment-audit', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1'));
    const limit = Math.min(200, parseInt(req.query.limit || '50'));
    const offset = (page - 1) * limit;
    const { paymentId, action, dateFrom, dateTo } = req.query;

    let where = '1=1';
    const params = [];
    if (paymentId) { where += ' AND a.payment_id = ?'; params.push(paymentId); }
    if (action)    { where += ' AND a.action = ?';     params.push(action); }
    if (dateFrom)  { where += ' AND a.created_at >= ?'; params.push(dateFrom + ' 00:00:00'); }
    if (dateTo)    { where += ' AND a.created_at <= ?'; params.push(dateTo + ' 23:59:59'); }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM payment_audit_log a WHERE ${where}`, params
    );
    const [rows] = await pool.query(
      `SELECT a.*, s.name AS subscriber_name, s.client_code
       FROM payment_audit_log a
       LEFT JOIN subscribers s ON s.id = a.subscriber_id
       WHERE ${where}
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ total, page, limit, rows });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/payments/outstanding
router.get('/api/admin/payments/outstanding', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        s.id, s.name, s.email, s.phone, s.client_code,
        s.assigned_sales_name, s.assigned_cs_name,
        COALESCE(SUM(CASE WHEN p.is_installment = 0 THEN p.course_expected ELSE 0 END), 0) AS total_expected,
        COALESCE(SUM(CASE WHEN p.is_installment = 0 THEN p.amount ELSE 0 END),          0) AS total_paid,
        COALESCE(SUM(CASE WHEN p.is_installment = 0 THEN p.course_expected ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN p.is_installment = 0 THEN p.amount ELSE 0 END), 0)     AS outstanding
      FROM subscribers s
      JOIN payments p ON p.subscriber_id = s.id
      WHERE s.is_active = 1 AND p.course_expected IS NOT NULL AND p.course_expected > 0
        AND p.is_installment = 0
      GROUP BY s.id
      HAVING outstanding > 0
      ORDER BY outstanding DESC
      LIMIT 300
    `);
    const total = rows.reduce((s, r) => s + (parseFloat(r.outstanding) || 0), 0);
    res.json({ subscribers: rows, total_outstanding: total, count: rows.length });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/payments/send-reminder
router.post('/api/admin/payments/send-reminder', requireAuth, requireAdmin, async (req, res) => {
  const { subscriberIds, all, message } = req.body || {};
  let subs = [];
  try {
    const baseQuery = `
      SELECT s.id, s.name, s.phone,
             COALESCE(SUM(p.course_expected),0) - COALESCE(SUM(p.amount),0) AS outstanding
      FROM subscribers s
      JOIN payments p ON p.subscriber_id = s.id
      WHERE p.course_expected IS NOT NULL AND p.course_expected > 0 AND p.is_installment = 0
    `;
    if (all) {
      const [rows] = await pool.query(baseQuery + ' GROUP BY s.id HAVING outstanding > 0 LIMIT 200');
      subs = rows;
    } else if (Array.isArray(subscriberIds) && subscriberIds.length) {
      const [rows] = await pool.query(
        baseQuery + ' AND s.id IN (?) GROUP BY s.id HAVING outstanding > 0',
        [subscriberIds]
      );
      subs = rows;
    }
    if (!subs.length) return res.json({ ok: true, sent: 0, message: 'لا يوجد مشتركين برصيد مستحق' });
    const results = [];
    for (const sub of subs) {
      const phone   = (sub.phone || '').replace(/\D/g, '');
      const amount  = parseFloat(sub.outstanding) || 0;
      const msg = message
        ? message.replace(/\{name\}/g, sub.name || '').replace(/\{amount\}/g, amount.toFixed(0))
        : `أهلاً ${sub.name || ''} 💚\nنود تذكيرك بأن لديك رصيداً مستحقاً بمبلغ ${amount.toFixed(0)} ج.م.\nيرجى التواصل معنا لتسوية الرصيد.\nشكراً لثقتك بمعهد مهاد 🌿`;
      let ok = false;
      try { await sendWhatsApp(phone, msg); ok = true; } catch (_) {}
      results.push({ id: sub.id, phone, ok });
    }
    const sent = results.filter(r => r.ok).length;
    res.json({ ok: true, sent, failed: results.length - sent, results });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/payments/bulk-stub
router.post('/api/admin/payments/bulk-stub', requireAuth, requireAdmin, async (req, res) => {
  const { dryRun = true } = req.body || {};
  try {
    const [rows] = await pool.query(`
      SELECT e.id AS enroll_id, e.subscriber_id, e.course_id, e.bundle_id, e.enrolled_at,
             s.name, s.email
      FROM enrollments e
      JOIN subscribers s ON s.id = e.subscriber_id
      LEFT JOIN payments p ON p.subscriber_id = e.subscriber_id
        AND (p.course_id = e.course_id OR (e.course_id IS NULL AND p.bundle_id = e.bundle_id))
      WHERE p.id IS NULL
      LIMIT 1000
    `);
    if (dryRun) return res.json({ dryRun: true, count: rows.length, sample: rows.slice(0, 5) });
    let created = 0;
    for (const r of rows) {
      await pool.query(
        `INSERT IGNORE INTO payments (id, subscriber_id, course_id, bundle_id, amount, currency,
           payment_type, payment_method, date, note)
         VALUES (?, ?, ?, ?, 0, 'EGP', 'OTHER', 'manual', ?, 'تسجيل تاريخي — تسوية تلقائية')`,
        [uuidv4(), r.subscriber_id, r.course_id || null, r.bundle_id || null, r.enrolled_at]
      );
      created++;
    }
    await pool.query(
      'INSERT INTO activity_logs (id, action, entity, entity_id, label, actor) VALUES (?,?,?,?,?,?)',
      [uuidv4(), 'bulk_stub', 'payments', null,
       `إنشاء ${created} سجل دفع تاريخي بالصفر`, req.user?.email || 'admin']
    );
    res.json({ ok: true, created });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/subscriber-payments
router.post('/api/admin/subscriber-payments', requireAuth, requireAdminOrStaff, requirePermission('manage_payments'), async (req, res) => {
  let conn;
  try {
    const { subscriber_id, payment } = req.body;
    if (!subscriber_id || !payment) return res.status(400).json({ error: 'subscriber_id and payment required' });
    if (!payment.amount || Number(payment.amount) <= 0) return res.status(400).json({ error: 'payment.amount must be > 0' });
    const [[subRow]] = await pool.query('SELECT id, email, assigned_sales_id, branch FROM subscribers WHERE id = ? LIMIT 1', [subscriber_id]);
    if (!subRow) return res.status(404).json({ error: 'Subscriber not found' });
    const id = payment.id || uuidv4();
    const paymentType = (payment.paymentType || payment.payment_type || 'OTHER').toUpperCase();
    const validTypes = ['COURSE','CERTIFICATE','CONSULTATION','BOOK','CARNEH','OTHER'];
    const safeType = validTypes.includes(paymentType) ? paymentType : 'OTHER';
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

    if (isPaid && (courseId || bundleId)) {
      let enrollAccessType = 'full';
      if (payment.isInstallment) {
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
          enrollAccessType = 'limited';
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
      setImmediate(async () => {
        try {
          const [[subCrm2]] = await pool.query('SELECT crm_json FROM subscribers WHERE id=? LIMIT 1', [subscriber_id]);
          if (!subCrm2) return;
          const crm2 = tryJson(subCrm2.crm_json, {});
          crm2.enrolledCourseIds = crm2.enrolledCourseIds || [];
          if (courseId && !crm2.enrolledCourseIds.includes(courseId)) {
            crm2.enrolledCourseIds.push(courseId);
          }
          crm2.courseAccess = crm2.courseAccess || {};
          if (courseId) {
            crm2.courseAccess[courseId] = enrollAccessType === 'full'
              ? 'full'
              : { mode: 'limited', lectureLimit: 2 };
          }
          await pool.query('UPDATE subscribers SET crm_json=? WHERE id=?', [JSON.stringify(crm2), subscriber_id]);
        } catch (crmSyncErr) { console.error('[payment] crm enrolledCourseIds sync failed', crmSyncErr.message); }
      });
    }

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
        const commAmount = parseFloat((Number(payment.amount) * commRate / 100).toFixed(2));
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
            Number(payment.amount), commAmount,
            JSON.stringify({ rate: commRate, calc_type: 'PERCENTAGE', rule_id: rule?.id || null, isInstallment: !!payment.isInstallment, note: commNote }),
            now.getMonth() + 1, now.getFullYear()
          ]
        );
      }
    }

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
      } catch (feeErr) { console.warn('[subscriber-payments] instructor fee auto-calc:', feeErr.message); }
    }

    await conn.commit();
    conn.release();
    conn = null;

    if (isPaid) {
      const [accCode, accName] = _paymentAccountCode(safeType);
      const amt = Number(payment.amount) || 0;
      postJournalEntry('payment', id, resolvedDate,
        `دفعة ${amt} ${payment.currency || 'EGP'} — ${safeType}`,
        [
          { account_code: '1100', account_name: 'نقدية وبنوك', debit: amt, credit: 0 },
          { account_code: accCode, account_name: accName, debit: 0, credit: amt },
        ],
        req.user?.email || 'system'
      ).catch(() => {});
    }

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
      } catch (crmErr) { console.error('[subscriber-payments] crm_json sync failed', id, crmErr.message); }
    });

    logPaymentAudit(id, 'create', null, payment.status || 'paid', payment.amount || 0, subscriber_id, req.user?.email || req.user?.uid).catch(() => {});

    if (isPaid) {
      createNotification('payment', '💰 دفعة جديدة', `دفعة ${payment.amount} ${payment.currency || 'EGP'} من مشترك`, { subscriberId: subscriber_id, paymentId: id, amount: payment.amount }).catch(() => {});
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
        ).catch(e => console.error('[receipt-email]', e.message));
        const subPhone = await pool.query('SELECT phone FROM subscribers WHERE id=? LIMIT 1', [subscriber_id])
          .then(([[r]]) => r?.phone || null).catch(() => null);
        if (subPhone) {
          const waMsg = `✅ تم استلام دفعتك بنجاح!\nالمبلغ: ${payment.amount} ${payment.currency || 'EGP'}${courseLabel ? '\nالبرنامج: ' + courseLabel : ''}\nالتاريخ: ${paymentDate}\nشكراً لثقتك بمعهد الدراسات النفسية 💚`;
          sendWhatsApp(subPhone.replace(/\D/g, ''), waMsg).catch(() => {});
        }
      }
    }

    if (subRow.email) {
      pool.query(
        "UPDATE leads SET status='converted' WHERE LOWER(email)=LOWER(?) AND LOWER(status) NOT IN ('converted','lost') LIMIT 5",
        [subRow.email]
      ).catch(() => {});
    }
    syncLeadDealValue(pool, subscriber_id).catch(() => {});
    if (isPaid && subRow.email) {
      enqueueEmailSequence('enrollment', subRow.email, null, Date.now()).catch(() => {});
    }
    res.json({ ok: true, id });
  } catch (e) {
    if (conn) { await conn.rollback().catch(() => {}); conn.release(); conn = null; }
    console.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/subscribers/:id/payments
router.get('/api/admin/subscribers/:id/payments', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const subId = req.params.id;
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title, cert_type, branch
       FROM payments WHERE subscriber_id = ? ORDER BY \`date\` ASC`,
      [subId]
    );
    const payments = payRows.map(p => {
      const d = p.date;
      const dateStr = d instanceof Date ? d.toISOString().slice(0,10) : String(d || '').slice(0,10);
      return {
        id: p.id,
        amount: Number(p.amount) || 0,
        currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(),
        paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null,
        isInstallment: !!p.is_installment,
        courseId: p.course_id || null,
        bundleId: p.bundle_id || null,
        note: p.note || null,
        at: dateStr,
        status: p.status || 'paid',
        staffId: p.staff_id || null,
        staffName: p.staff_name || null,
        fromAccountNumber: p.from_account || null,
        source: p.source || null,
        itemTitle: p.item_title || null,
        certType: p.cert_type || null,
        branch: p.branch || null,
      };
    });
    res.json(payments);
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/enrollments
router.post('/api/admin/enrollments', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    if (!req.isSuperAdmin) {
      const role = (req.staffRecord?.role || '').toLowerCase();
      if (role !== 'online_manager') return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const { subscriber_id, course_id, bundle_id, access_level, lecture_limit } = req.body;
    if (!subscriber_id || (!course_id && !bundle_id)) return res.status(400).json({ error: 'subscriber_id and course_id or bundle_id required' });
    const accessType = access_level === 'limited' ? 'limited' : 'full';
    await pool.query(
      `INSERT INTO enrollments (id, subscriber_id, course_id, bundle_id, enrolled_at, access_type, lecture_limit)
       VALUES (?,?,?,?,NOW(),?,?)
       ON DUPLICATE KEY UPDATE access_type=VALUES(access_type), lecture_limit=VALUES(lecture_limit)`,
      [uuidv4(), subscriber_id, course_id || null, bundle_id || null, accessType, lecture_limit || null]
    );
    setImmediate(async () => {
      try {
        const [[subData]] = await pool.query('SELECT name, email FROM subscribers WHERE id=? LIMIT 1', [subscriber_id]);
        if (!subData?.email) return;
        let itemName = 'الاشتراك';
        if (course_id) {
          const [[courseRow]] = await pool.query('SELECT title FROM courses WHERE id=? LIMIT 1', [course_id]);
          itemName = courseRow?.title || 'الكورس';
        } else if (bundle_id) {
          const [[bundleRow]] = await pool.query('SELECT title FROM bundles WHERE id=? LIMIT 1', [bundle_id]);
          itemName = bundleRow?.title || 'الباقة';
        }
        await sendEmail(subData.email,
          `🎓 تم تسجيلك في ${itemName}`,
          `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
            <h2 style="color:#7c3aed">مبروك ${subData.name || 'عزيزنا'}! 🎉</h2>
            <p>تم تسجيلك بنجاح في: <strong>${itemName}</strong></p>
            <p>يمكنك الوصول إليه الآن من خلال <a href="https://mahadnafsy.com/dashboard" style="color:#7c3aed">لوحة التحكم</a>.</p>
            <p style="color:#9ca3af;font-size:12px">معهد نفسي — mahadnafsy.com</p>
          </div>`
        );
      } catch (e) { console.warn('[email] enrollment confirmation failed:', e.message); }
    });
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Monthly Commission Comparison ────────────────────────────────
// GET /api/admin/commissions/monthly?months=6&staffId=OPTIONAL
//
// Returns commissions grouped by staff member × calendar month for the
// last N months. Useful for month-over-month comparison reports.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/api/admin/commissions/monthly', requireAuth, requireAdmin, async (req, res) => {
  try {
    const months   = Math.min(12, Math.max(1, parseInt(req.query.months || '6')));
    const staffId  = req.query.staffId || null;
    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - (months - 1));
    fromDate.setDate(1);
    const from = fromDate.toISOString().slice(0, 7); // YYYY-MM

    let sql = `
      SELECT
        DATE_FORMAT(c.created_at, '%Y-%m')  AS month,
        c.staff_id,
        COALESCE(s.name, c.staff_id)        AS staff_name,
        COUNT(*)                             AS deals_count,
        SUM(c.commission_amount)             AS total_commission,
        SUM(c.payment_amount)                AS total_payment
      FROM crm_commissions c
      LEFT JOIN staff s ON s.id = c.staff_id
      WHERE DATE_FORMAT(c.created_at, '%Y-%m') >= ?
    `;
    const params = [from];
    if (staffId) { sql += ' AND c.staff_id = ?'; params.push(staffId); }
    sql += ' GROUP BY month, c.staff_id, staff_name ORDER BY month ASC, total_commission DESC';

    const [rows] = await pool.query(sql, params);

    // Build calendar month array for the period
    const allMonths = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(fromDate);
      d.setMonth(d.getMonth() + i);
      allMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // Distinct staff list
    const staffList = [...new Map(rows.map(r => [r.staff_id, r.staff_name])).entries()]
      .map(([id, name]) => ({ id, name }));

    // Matrix: staff → months
    const matrix = staffList.map(({ id, name }) => ({
      staffId: id,
      staffName: name,
      months: allMonths.map(m => {
        const row = rows.find(r => r.staff_id === id && r.month === m);
        return {
          month: m,
          dealsCount: row ? Number(row.deals_count) : 0,
          totalCommission: row ? Number(row.total_commission) : 0,
          totalPayment: row ? Number(row.total_payment) : 0,
        };
      }),
      grandTotal: rows.filter(r => r.staff_id === id).reduce((a, r) => a + Number(r.total_commission), 0),
    })).sort((a, b) => b.grandTotal - a.grandTotal);

    res.json({ from, months: allMonths, staff: matrix });
  } catch (e) { console.error('[commissions/monthly]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Excel-compatible CSV Export (UTF-8 BOM) ─────────────────────
// GET /api/admin/export/orders?from=YYYY-MM-DD&to=YYYY-MM-DD&type=orders|commissions|subscribers
// Returns a CSV file compatible with Excel (UTF-8 BOM so Arabic displays correctly).
// Falls back gracefully — no external dependency needed.
// ══════════════════════════════════════════════════════════════════════════
router.get('/api/admin/export/orders', requireAuth, requireAdmin, async (req, res) => {
  try {
    const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to   = req.query.to   || new Date().toISOString().slice(0, 10);
    const type = req.query.type || 'orders';

    let rows = [], headers = [], filename = '';

    if (type === 'orders') {
      const [data] = await pool.query(
        `SELECT o.id, o.order_number, u.name AS client_name, u.email, u.phone,
                c.title AS course_name, o.amount, o.currency, o.status,
                o.payment_method, o.created_at, s.name AS staff_name
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN courses c ON c.id = o.course_id
         LEFT JOIN staff s ON s.id = o.staff_id
         WHERE o.created_at >= ? AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)
         ORDER BY o.created_at DESC`,
        [from, to]
      );
      headers = ['رقم الطلب','اسم العميل','البريد','الهاتف','الكورس','المبلغ','العملة','الحالة','طريقة الدفع','التاريخ','موظف المبيعات'];
      rows = data.map(r => [
        r.order_number || r.id, r.client_name || '', r.email || '', r.phone || '',
        r.course_name || '', r.amount, r.currency || 'EGP', r.status || '',
        r.payment_method || '', (r.created_at || '').toString().slice(0, 10), r.staff_name || '',
      ]);
      filename = `orders-${from}-${to}.csv`;

    } else if (type === 'commissions') {
      const [data] = await pool.query(
        `SELECT c.id, s.name AS staff_name, s.email, c.commission_amount, c.payment_amount,
                c.commission_type, c.description, c.created_at
         FROM crm_commissions c
         LEFT JOIN staff s ON s.id = c.staff_id
         WHERE c.created_at >= ? AND c.created_at < DATE_ADD(?, INTERVAL 1 DAY)
         ORDER BY c.created_at DESC`,
        [from, to]
      );
      headers = ['الموظف','البريد','مبلغ العمولة','مبلغ الدفع','نوع العمولة','وصف','التاريخ'];
      rows = data.map(r => [
        r.staff_name || '', r.email || '', r.commission_amount, r.payment_amount,
        r.commission_type || '', r.description || '', (r.created_at || '').toString().slice(0, 10),
      ]);
      filename = `commissions-${from}-${to}.csv`;

    } else if (type === 'subscribers') {
      const [data] = await pool.query(
        `SELECT s.id, s.name, s.email, s.phone, s.country,
                s.is_active, s.created_at,
                GROUP_CONCAT(c.title SEPARATOR ' | ') AS courses
         FROM subscribers s
         LEFT JOIN JSON_TABLE(s.enrolled_course_ids, '$[*]' COLUMNS(cid VARCHAR(36) PATH '$')) j ON 1=1
         LEFT JOIN courses c ON c.id = j.cid
         WHERE s.created_at >= ? AND s.created_at < DATE_ADD(?, INTERVAL 1 DAY)
         GROUP BY s.id ORDER BY s.created_at DESC`,
        [from, to]
      ).catch(async () => {
        // Fallback without JSON_TABLE (older MySQL)
        const [fb] = await pool.query(
          `SELECT id, name, email, phone, country, is_active, created_at FROM subscribers
           WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
           ORDER BY created_at DESC`,
          [from, to]
        );
        return [fb];
      });
      headers = ['الاسم','البريد','الهاتف','الدولة','نشط','الكورسات','تاريخ التسجيل'];
      rows = data.map(r => [
        r.name || '', r.email || '', r.phone || '', r.country || '',
        r.is_active ? 'نعم' : 'لا', r.courses || '',
        (r.created_at || '').toString().slice(0, 10),
      ]);
      filename = `subscribers-${from}-${to}.csv`;
    } else {
      return res.status(400).json({ error: 'type must be orders|commissions|subscribers' });
    }

    // Build CSV with UTF-8 BOM (Excel requires BOM for proper Arabic rendering)
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const BOM = '﻿';
    const csv = BOM + [headers, ...rows].map(row => row.map(escape).join(',')).join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (e) { console.error('[export/orders]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
