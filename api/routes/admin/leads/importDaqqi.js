'use strict';
// Importing «دقي» leads from a sheet.
// One part of routes/admin/leads.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  uuidv4,
  pool,
  sanitize,
  sendRouteError,
  grantCourseEntitlement,
  requireAuth,
  requireAdminOrStaff,
  requirePermission,
  cairoToday,
  branchIdForBranch,
  postPaymentJournal,
  logPaymentAudit,
  assertWritable,
  logger,
} = require('./_shared');

const router = Router();

router.post('/api/admin/import/daqqi', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), requirePermission('manage_payments'), async (req, res) => {
  try {
    // Desk work: a rep or a collection officer edits their own leads, not the pool.
    if (['sales', 'collection'].includes(String(req.staffRecord?.role || '').toLowerCase())) return res.status(403).json({ error: 'غير مصرح' });
    const { rows, dryRun } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'لا توجد بيانات للاستيراد' });
    // Every row costs ~5 queries and the whole import runs in ONE transaction, so an
    // uncapped array holds the connection and the subscriber row locks for as long as
    // it takes to chew through it. The 10mb body limit alone allows ~40k rows, which
    // is minutes of blocked writes for everyone else. Cap it and make the caller split.
    const IMPORT_MAX_ROWS = Number(process.env.IMPORT_MAX_ROWS || 2000);
    if (rows.length > IMPORT_MAX_ROWS) {
      return res.status(413).json({
        error: `الاستيراد محدود بـ ${IMPORT_MAX_ROWS} صف في المرة الواحدة (أرسلت ${rows.length}). قسّم الملف على دفعات.`,
        maxRows: IMPORT_MAX_ROWS,
        received: rows.length,
      });
    }

    const VALID_NATIONALITY = ['EGYPTIAN','NON_EGYPTIAN_EGYPT','SAUDI_RESIDENT','INTERNATIONAL'];
    const VALID_CURRENCY    = ['EGP','SAR','USD'];
    const VALID_METHOD      = ['CASH','VODAFONE_CASH','INSTAPAY','BANK_TRANSFER','ONLINE','PAYMOB','CHECK','OTHER'];

    // Helper: get next client code for DAQQI (DQ-XXXX)
    const getNextDaqqiCode = async (conn, tenantId) => {
      const [[row]] = await conn.query(
        `SELECT client_code FROM subscribers WHERE tenant_id=? AND client_code REGEXP '^DQ-[0-9]+$'
         ORDER BY CAST(SUBSTRING(client_code,4) AS UNSIGNED) DESC LIMIT 1`,
        [tenantId]
      );
      if (row?.client_code) {
        const num = parseInt(row.client_code.replace('DQ-',''), 10);
        return `DQ-${String(num+1).padStart(4,'0')}`;
      }
      return 'DQ-0001';
    };

    const stats    = { total: rows.length, newSubscribers: 0, existingSubscribers: 0, newEnrollments: 0, newPayments: 0, errors: [] };
    const results  = [];
    const conn     = await pool.getConnection();
    let transactionStarted = false;

    try {
      if (!dryRun) { await conn.beginTransaction(); transactionStarted = true; }
      for (const r of rows) {
        const name  = sanitize(String(r.name  || '').trim(), 255);
        const email = String(r.email || '').toLowerCase().trim().substring(0,255);
        const phone = String(r.phone || '').replace(/[^\d+]/g,'').substring(0,30) || null;

        if (!name || !email || !phone || !email.includes('@')) {
          stats.errors.push(`سطر "${r.name || '?'}": بيانات ناقصة أو غير صحيحة`);
          results.push({ ...r, _status: 'error', _msg: 'بيانات ناقصة' });
          continue;
        }

        const nationalId  = r.national_id ? String(r.national_id).substring(0,50) : null;
        const whatsapp    = r.whatsapp ? String(r.whatsapp).replace(/[^\d+]/g,'').substring(0,30) : phone;
        const natRaw      = String(r.nationality || '').toUpperCase();
        const nationality = VALID_NATIONALITY.includes(natRaw) ? natRaw : 'EGYPTIAN';
        const notes       = r.notes ? sanitize(String(r.notes),1000) : null;
        const discount    = r.discount ? parseFloat(r.discount) : null;
        const createdAt   = r.enrollment_date || r.created_at || cairoToday();

        const courseId      = r.course_id     ? String(r.course_id).trim()     : null;
        const payAmount     = r.payment_amount ? parseFloat(r.payment_amount) : 0;
        const payCurRaw     = String(r.payment_currency || 'EGP').toUpperCase();
        const payCurrency   = VALID_CURRENCY.includes(payCurRaw) ? payCurRaw : 'EGP';
        const payMethodRaw  = String(r.payment_method || 'CASH').toUpperCase();
        const payMethod     = VALID_METHOD.includes(payMethodRaw) ? payMethodRaw : 'CASH';
        const payDate       = r.payment_date || createdAt;
        const transactionId = r.transaction_id ? String(r.transaction_id).substring(0,255) : null;
        const isInstallment = r.is_installment === '1' || r.is_installment === 1 ? 1 : 0;
        const payNote       = r.payment_note ? sanitize(String(r.payment_note),500) : notes;
        const courseExpected= r.course_expected ? parseFloat(r.course_expected) : payAmount;

        // Find or create subscriber
        let subscriberId, clientCode, isNew = false;
        const [[existing]] = await conn.query(
          'SELECT id, client_code, tenant_id, branch, branch_id FROM subscribers WHERE tenant_id=? AND (email=? OR phone=?) LIMIT 1',
          [req.tenantId, email, phone]
        );

        let subscriberTenantId = req.tenantId || 'tenant-default';
        let subscriberBranch = 'DAQQI';
        let subscriberBranchId = branchIdForBranch(subscriberBranch);
        if (existing) {
          subscriberId = existing.id;
          clientCode   = existing.client_code;
          subscriberTenantId = existing.tenant_id || subscriberTenantId;
          subscriberBranch = existing.branch || subscriberBranch;
          subscriberBranchId = existing.branch_id || branchIdForBranch(subscriberBranch);
          stats.existingSubscribers++;
        } else {
          subscriberId = uuidv4();
          clientCode   = await getNextDaqqiCode(conn, subscriberTenantId);
          isNew        = true;
          if (!dryRun) {
            await conn.query(
              `INSERT INTO subscribers (id,client_code,name,email,phone,national_id,whatsapp,nationality,branch,branch_id,discount,is_active,notes,created_at,tenant_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
              [subscriberId,clientCode,name,email,phone,nationalId,whatsapp,nationality,subscriberBranch,subscriberBranchId,discount,notes,createdAt,subscriberTenantId]
            );
          }
          stats.newSubscribers++;
        }

        // Enrollment
        let enrollStatus = 'skipped';
        if (courseId) {
          const [[courseExists]] = await conn.query('SELECT id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',[courseId, subscriberTenantId]);
          if (!courseExists) {
            stats.errors.push(`سطر "${name}": course_id="${courseId}" غير موجود`);
          } else {
            if (!dryRun) {
              await grantCourseEntitlement({
                tenantId: subscriberTenantId, subscriberId, courseId, accessType: 'full',
                branchId: subscriberBranchId, enrolledAt: createdAt,
                source: 'lead_import', actor: req.user?.email || 'admin',
              }, conn);
            }
            stats.newEnrollments++;
            enrollStatus = 'ok';
          }
        }

        // Payment
        let payStatus = 'skipped';
        if (payAmount > 0) {
          if (!dryRun) {
            await assertWritable(payDate, conn, subscriberTenantId);
            const paymentId = uuidv4();
            await conn.query(
              `INSERT INTO payments (id,subscriber_id,course_id,amount,currency,payment_type,payment_method,transaction_id,is_installment,course_expected,date,note,status,tenant_id,branch,branch_id)
               VALUES (?,?,?,?,?,'COURSE',?,?,?,?,?,?,'paid',?,?,?)`,
              [paymentId,subscriberId,courseId||null,payAmount,payCurrency,payMethod,transactionId,isInstallment,courseExpected,payDate,payNote,subscriberTenantId,subscriberBranch,subscriberBranchId]
            );
            const journalId = await postPaymentJournal({
              paymentId, amount: payAmount, currency: payCurrency, payType: 'COURSE',
              date: payDate, actor: req.user?.email || 'daqqi-import', tenantId: subscriberTenantId,
            }, conn);
            if (!journalId) throw new Error(`Payment journal failed for imported subscriber ${subscriberId}`);
            // Imported money gets a trail like any other. A CSV is the least
            // traceable way a payment can enter the system, so it is the last
            // place the audit row should be optional.
            await logPaymentAudit(paymentId, 'create', null, 'paid', payAmount, subscriberId,
              req.user?.email || 'daqqi-import', subscriberTenantId, conn, true);
          }
          stats.newPayments++;
          payStatus = 'ok';
        }

        results.push({
          name, email, phone, clientCode,
          _status: 'ok',
          _isNew: isNew,
          _enrollStatus: enrollStatus,
          _payStatus: payStatus,
          _payAmount: payAmount,
          _payCurrency: payCurrency,
        });
      }
      if (transactionStarted) { await conn.commit(); transactionStarted = false; }
    } catch (error) {
      if (transactionStarted) await conn.rollback().catch(() => {});
      throw error;
    } finally {
      conn.release();
    }

    res.json({ ok: true, dryRun: !!dryRun, stats, results });
  } catch (e) { logger.error('[import/daqqi]', e.message); sendRouteError(res, e); }
});

module.exports = router;
