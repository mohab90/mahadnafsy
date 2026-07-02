'use strict';
const logger = require('../../lib/logger');
const crypto   = require('crypto');
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../../lib/id');

const { pool, cacheInvalidate } = require('../../lib/db');
const { mailer, sendEmail, htmlEmail } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { tryJson, sanitize, parseLimit, parseOffset, validate } = require('../../lib/helpers');
const { COURSE_COLS, mapCourse, mapBundle, mapTherapist, getNextClientCode } = require('../../lib/mappers');
const { createNotification } = require('../../lib/notification');
const { logPaymentAudit, logFinancialAudit, postJournalEntry, _paymentAccountCode, _expenseAccountCode, toEgp } = require('../../lib/finance');
const { assertWritable } = require('../../lib/periodLock');
const { syncLeadDealValue } = require('../public-orders');
const { logLeadEvent } = require('../../lib/crm');
const { enqueueEmailSequence } = require('../../lib/emailSequence');
const { ADMIN_EMAILS, ADMIN_UIDS, requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { paymobLimiter, whatsappSendLimiter, publicLimiter, contactLimiter } = require('../../middleware/rateLimits');
const { safeDateOnly } = require('../../lib/dates');
const { isString, validateBody } = require('../../middleware/validate');

router.get('/api/admin/expenses', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, description, amount, currency, category, date, receipt_url, note, staff_id,
       vat_rate, vat_amount, amount_before_vat, created_at
       FROM expenses WHERE deleted_at IS NULL ORDER BY date DESC LIMIT 500`);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

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

    // Update crm_json paymentHistory status — upsert the entry even if not present yet
    if (pay.subscriber_id) {
      const [[sub]] = await pool.query('SELECT crm_json FROM subscribers WHERE id = ? LIMIT 1', [pay.subscriber_id]);
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
        // If newly paid with a course → sync enrolledCourseIds in crm_json + calc commission
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
          if (bundleId && !crm.enrolledCourseIds.includes(`bundle:${bundleId}`)) {
            crm.enrolledCourseIds.push(`bundle:${bundleId}`);
          }
          // Determine correct access type — installment payments get 'limited' unless fully paid
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

        // Calculate commission when payment is newly confirmed as paid
        if (becomingPaid && Number(pay.amount) > 0) {
          // Staff resolution (pay.staff_id → subscriber's assigned sales) happens inside.
          {
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
                  // Commission stored in EGP so payroll sums stay single-currency
                  const amtEgp = await toEgp(Number(pay.amount), pay.currency);
                  const commAmount = parseFloat((amtEgp * commRate / 100).toFixed(2));
                  const now = new Date();
                  await pool.query(
                    `INSERT INTO crm_commissions (id, staff_id, payment_id, rule_id, client_id, client_type, payment_amount, commission_amount, calc_details, month, year, status, created_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,'PENDING',NOW()) ON DUPLICATE KEY UPDATE commission_amount=VALUES(commission_amount)`,
                    [uuidv4(), finalStaffId, id, rule?.id||null, pay.subscriber_id, 'subscriber',
                     amtEgp, commAmount,
                     JSON.stringify({ rate: commRate, calc_type: 'PERCENTAGE', rule_id: rule?.id||null, trigger: 'status_change_to_paid', originalAmount: Number(pay.amount), originalCurrency: pay.currency || 'EGP' }),
                     now.getMonth()+1, now.getFullYear()]
                  );
                }
              }
            } catch (commErr) { logger.warn('[patch-payment] commission calc error:', commErr.message); }
          }
          // Send WhatsApp payment confirmation to subscriber
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
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/staff
module.exports = router;
