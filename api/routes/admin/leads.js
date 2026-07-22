'use strict';
const logger = require('../../lib/logger');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../../lib/id');

const { pool, autoAssignStaff, cacheInvalidate } = require('../../lib/db');
const { mailer } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { tryJson, sanitize, parseLimit, parseOffset, parseCrm, calcLeadScoreServer } = require('../../lib/helpers');
const { COURSE_COLS, mapCourse, getNextClientCode } = require('../../lib/mappers');
const { createNotification } = require('../../lib/notification');
const { logLeadEvent, logLeadEventStrict } = require('../../lib/crm');
const { normalizeLeadStatus, transitionLead } = require('../../lib/leadState');
const { findLeadDuplicateGroups, mergeLeads } = require('../../lib/leadMerge');
const { enqueueEmailSequence } = require('../../lib/emailSequence');
const { ADMIN_EMAILS, requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { DATA_SCOPE, VALID_BRANCHES, VALID_PAY_TYPES, VALID_SOURCES } = require('../../constants/permissions');
const { onlineMap } = require('../../lib/onlineUsers');
const { safeIsoString, safeDateOnly } = require('../../lib/dates');
const { keyset } = require('../../lib/pagination');
const { branchIdForBranch } = require('../../lib/branches');
const { postPaymentJournal } = require('../../lib/finance');
const { assertWritable } = require('../../lib/periodLock');
function sendRouteError(res, err) {
  if (res.headersSent) return;
  const dbCodes = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_SERVER_LOST']);
  const status = err && dbCodes.has(err.code) ? 503 : 500;
  res.status(status).json({ error: status === 503 ? 'Database unavailable' : 'Internal server error' });
}

function cleanLegacyLeadText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/الفرع:\s*اون_لاين_داخ(?:ل|�+|\?+)_مصر/gi, 'الفرع: أونلاين مصر')
    .replace(/اون_لاين_داخ(?:ل|�+|\?+)_مصر/gi, 'أونلاين مصر')
    .replace(/اونلاين_داخل_مصر/gi, 'أونلاين مصر');
}


router.post('/api/admin/leads', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  try {
    const l = req.body;
    const tenantId = req.tenantId;
    const requestedId = l.id ? String(l.id) : null;
    const [[existing]] = requestedId ? await pool.query(
      'SELECT status, crm_json, assigned_sales_id FROM leads WHERE id=? AND tenant_id=? LIMIT 1',
      [requestedId, tenantId]
    ) : [[null]];
    const id = existing ? requestedId : uuidv4();
    // SALES staff can only update their OWN assigned leads (not reassign to others)
    if (req.staffRecord?.role === 'SALES') {
      if (existing && existing.assigned_sales_id !== req.staffRecord.id) {
        return res.status(403).json({ error: 'غير مصرح: يمكنك فقط تعديل الليدز المعيّنة لك' });
      }
    }
    // Extract base columns; store everything else in crm_json
    const { id: _id, name, email, phone, source, status, notes, hidden, createdAt, created_at, clientCode, client_code, ...crmData } = l;
    // Sanitize at system boundary
    const safeName   = sanitize(name,   300);
    const safeEmail  = (email  || '').toLowerCase().trim().substring(0, 255);
    const safePhone  = ((phone  || '').replace(/[^\d+\-\s()]/g, '').trim().substring(0, 30)) || null;
    const safeNotes  = sanitize(notes,  2000);
    const safeSource = sanitize(source, 200);
    const normalizedRequestedStatus = normalizeLeadStatus(status || 'new');
    // Auto-generate client_code for new leads if not provided
    let code = clientCode || client_code || null;
    const isNew = !existing;
    // Only check for duplicate phone when CREATING a new lead (not updating)
    if (isNew && safePhone) {
      // Check against subscribers first (phone already enrolled)
      const [[existSub]] = await pool.query(
        'SELECT id, name, client_code FROM subscribers WHERE tenant_id=? AND phone=? LIMIT 1', [tenantId, safePhone]
      );
      if (existSub) return res.status(409).json({
        error: `رقم الهاتف ${safePhone} مسجل بالفعل كمشترك (${existSub.name || ''})`,
        existingId: existSub.id,
        existingCode: existSub.client_code,
        type: 'subscriber',
      });
      const [[existLead]] = await pool.query(
        'SELECT id, name FROM leads WHERE tenant_id=? AND phone=? AND id != ? AND hidden=0 LIMIT 1', [tenantId, safePhone, id]
      );
      if (existLead) return res.status(409).json({
        error: `رقم الهاتف ${safePhone} مسجل بالفعل في العملاء المحتملين (${existLead.name || ''})`,
        existingId: existLead.id,
        type: 'lead',
      });
    }
    // Check for duplicate email on new lead
    if (isNew && safeEmail) {
      const [[existByEmail]] = await pool.query(
        'SELECT id, name FROM leads WHERE tenant_id=? AND email=? AND id != ? AND hidden=0 LIMIT 1', [tenantId, safeEmail, id]
      );
      if (existByEmail) return res.status(409).json({
        error: `البريد الإلكتروني مسجل بالفعل (${existByEmail.name || ''})`,
        existingId: existByEmail.id,
      });
    }
    // Auto-generate client_code for new leads
    if (isNew && !code) {
      const conn2 = await pool.getConnection();
      try { code = await getNextClientCode(conn2); } catch { /* ignore */ } finally { conn2.release(); }
    }
    // Auto-assign to sales on new lead if not already assigned
    let salesId   = crmData.assignedSalesId   || null;
    let salesName = crmData.assignedSalesName || null;
    if (req.staffRecord?.role === 'SALES') {
      salesId = req.staffRecord.id;
      salesName = req.staffRecord.name || salesName;
      crmData.assignedSalesId = salesId;
      crmData.assignedSalesName = salesName;
    } else if (isNew && !salesId) {
      const rep = await autoAssignStaff('SALES', req.tenantId);
      if (rep) { salesId = rep.id; salesName = rep.name; crmData.assignedSalesId = rep.id; crmData.assignedSalesName = rep.name; }
    }
    const prevStatus = existing ? existing.status : null;
    const prevCrm = existing ? tryJson(existing.crm_json, {}) : {};
    const prevCommCount = (prevCrm.communications || []).length;
    const newCommCount  = (crmData.communications || []).length;

    // ── Merge crm_json instead of overwriting it ──────────────────────────
    // Two agents editing the same lead used to be last-write-wins on the WHOLE
    // blob — the slower save erased the other agent's logged communications.
    // We merge: scalar fields take the incoming value, communications are a
    // union of both sides (deduped by id, falling back to date+type+notes).
    let crmToStore = crmData;
    if (!isNew) {
      const commKey = (c) => c?.id || `${c?.date || ''}|${c?.type || ''}|${String(c?.notes || '').slice(0, 80)}`;
      const mergedComms = [];
      const seenComms = new Set();
      for (const c of [...(Array.isArray(prevCrm.communications) ? prevCrm.communications : []),
                       ...(Array.isArray(crmData.communications) ? crmData.communications : [])]) {
        const k = commKey(c);
        if (!seenComms.has(k)) { seenComms.add(k); mergedComms.push(c); }
      }
      crmToStore = { ...prevCrm, ...crmData, communications: mergedComms };
    }

    // Extract branch — accept any non-empty string (supports both legacy ENUM values and
    // dynamic institution branches configured via content['institute.branches']).
    // The leads.branch column is VARCHAR so no ENUM restriction needed here.
    const branchRaw = crmData.branch || null;
    const branchVal = branchRaw ? String(branchRaw).trim().substring(0, 100) : null;
    // Extract client_type for dedicated column
    const VALID_CLIENT_TYPES_LEAD = new Set([
      'ONLINE_LOCAL_NEW','ONLINE_LOCAL_OLD','ONLINE_SAUDI_NEW','ONLINE_SAUDI_OLD',
      'ONLINE_ABROAD','DAQQI_NEW','DAQQI_OLD','QATAMIYA',
      'LEAD_LOCAL_NEW','LEAD_LOCAL_OLD','LEAD_INTL_NEW','LEAD_INTL_OLD']);
    const rawLeadClientType = crmData.clientType || null;
    const leadClientTypeVal = (rawLeadClientType && VALID_CLIENT_TYPES_LEAD.has(rawLeadClientType.toUpperCase())) ? rawLeadClientType.toUpperCase() : (rawLeadClientType || null);
    // Extract interestedCourseIds for dedicated column
    const courseIdsJson = Array.isArray(crmData.interestedCourseIds) && crmData.interestedCourseIds.length
      ? JSON.stringify(crmData.interestedCourseIds) : null;

    if (isNew) {
      await pool.query(
        `INSERT INTO leads (id, tenant_id, client_code, name, email, phone, source, status, notes, hidden,
           assigned_sales_id, assigned_sales_name, crm_json, branch, client_type, interested_course_ids_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
         [id, tenantId, code, safeName||'', safeEmail||'', safePhone||null, safeSource||null, normalizedRequestedStatus,
         safeNotes||null, hidden||0, salesId, salesName, JSON.stringify(crmToStore), branchVal, leadClientTypeVal, courseIdsJson]
      );
    } else {
      const [updated] = await pool.query(
        `UPDATE leads SET name=?, notes=COALESCE(?,notes), client_code=COALESCE(client_code,?),
           assigned_sales_id=COALESCE(?,assigned_sales_id), assigned_sales_name=COALESCE(?,assigned_sales_name),
           crm_json=?, branch=COALESCE(NULLIF(?,''),branch), client_type=COALESCE(?,client_type),
           interested_course_ids_json=COALESCE(?,interested_course_ids_json)
         WHERE id=? AND tenant_id=?`,
        [safeName||'', safeNotes||null, code, salesId, salesName,
         JSON.stringify(crmToStore), branchVal, leadClientTypeVal, courseIdsJson, id, tenantId]
      );
      if (!updated.affectedRows) return res.status(404).json({ error: 'Lead not found' });
    }
    let statusTransitionLogged = false;
    if (!isNew && String(prevStatus || '').toLowerCase() !== normalizedRequestedStatus) {
      const transition = await transitionLead({
        tenantId, leadId: id, toStatus: normalizedRequestedStatus,
        actor: req.user?.email || req.staffRecord?.name || null,
      });
      statusTransitionLogged = transition.changed;
    }
    // Update persisted score after every save
    const newScore = calcLeadScoreServer(
      status, crmData.interestLevel,
      crmData.communications, crmData.nextFollowUpDate, crmData.interestedCourseIds,
      crmData.createdAt || new Date().toISOString()
    );
    await pool.query('UPDATE leads SET score=? WHERE id=? AND tenant_id=?', [newScore, id, tenantId]);

    // ── Log timeline events ────────────────────────────────────────────────
    const normalizedNew = normalizedRequestedStatus;
    const normalizedPrev = (prevStatus || '').toLowerCase();
    if (isNew) {
      await logLeadEvent(id, 'created', `تم إضافة الليد من: ${source || 'غير محدد'}`, { source, status: normalizedNew, name, phone }, tenantId);
      if (salesId) await logLeadEvent(id, 'assigned', `تعيين تلقائي للمبيعات: ${salesName || salesId}`, { salesId, salesName, auto: true }, tenantId);
      // Automation #4: Auto-set follow-up date to +2 days if none specified
      if (!crmData.nextFollowUpDate) {
        const followUpDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        await pool.query('UPDATE leads SET next_follow_up_date=? WHERE id=? AND tenant_id=? AND next_follow_up_date IS NULL', [followUpDate, id, tenantId]);
        await logLeadEvent(id, 'followup_set', `موعد متابعة تلقائي: ${followUpDate}`, { date: followUpDate, auto: true }, tenantId);
      }
      // Notify assigned sales staff (or all admins) of new lead
      createNotification('lead', '📋 ليد جديد',
        `${safeName || 'مجهول'} — ${safeSource || 'بدون مصدر'}${safePhone ? ' | ' + safePhone : ''}`,
        { leadId: id, assignedSalesId: salesId }, tenantId
      ).catch(() => {});
    } else {
      // Status changed?
      if (normalizedPrev && normalizedPrev !== normalizedNew && !statusTransitionLogged) {
        const STATUS_AR = { new:'جديد', contacted:'تم التواصل', interested:'مهتم', not_interested:'غير مهتم', no_answer:'لا جواب', closed:'مغلق', converted:'تحوّل لعميل', lost:'خسرنا' };
        await logLeadEvent(id, 'status_changed', `تغيير الحالة: ${STATUS_AR[normalizedPrev] || normalizedPrev} ← ${STATUS_AR[normalizedNew] || normalizedNew}`, { from: normalizedPrev, to: normalizedNew }, tenantId);
      }
      // New communication added?
      if (newCommCount > prevCommCount) {
        const added = (crmData.communications || []).slice(-1)[0];
        const TYPE_AR = { call:'مكالمة', whatsapp:'واتساب', email:'إيميل', meeting:'اجتماع', note:'ملاحظة', payment_followup:'متابعة دفع', new_course_sale:'بيع كورس', certificate:'شهادة' };
        await logLeadEvent(id, 'communication', `تواصل جديد: ${TYPE_AR[added?.type] || added?.type || '؟'}${added?.notes ? ' — ' + added.notes.slice(0, 80) : ''}`, { type: added?.type, notes: added?.notes, outcome: added?.outcome }, tenantId);
      }
      // Assignment changed?
      if (crmData.assignedSalesId && crmData.assignedSalesId !== prevCrm.assignedSalesId) {
        await logLeadEvent(id, 'assigned', `تعيين لـ: ${crmData.assignedSalesName || crmData.assignedSalesId}`, { salesId: crmData.assignedSalesId, salesName: crmData.assignedSalesName }, tenantId);
        createNotification('lead', '👤 تعيين ليد',
          `${safeName || 'ليد'} تم تعيينه لـ: ${crmData.assignedSalesName || crmData.assignedSalesId}`,
          { leadId: id, assignedSalesId: crmData.assignedSalesId, assignedSalesName: crmData.assignedSalesName }, tenantId
        ).catch(() => {});
      }
      // Follow-up date set/changed?
      if (crmData.nextFollowUpDate && crmData.nextFollowUpDate !== prevCrm.nextFollowUpDate) {
        await logLeadEvent(id, 'followup_set', `موعد متابعة: ${crmData.nextFollowUpDate}`, { date: crmData.nextFollowUpDate }, tenantId);
      }
    }

    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); sendRouteError(res, e); }
});

// ── POST /api/admin/import/daqqi — bulk import subscribers + enrollments + payments for DAQQI branch ──
router.post('/api/admin/import/daqqi', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  try {
    if (req.staffRecord?.role === 'SALES') return res.status(403).json({ error: 'غير مصرح' });
    const { rows, dryRun } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'لا توجد بيانات للاستيراد' });

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
        const createdAt   = r.enrollment_date || r.created_at || new Date().toISOString().slice(0,10);

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
              await conn.query(
                `INSERT INTO enrollments (id,subscriber_id,course_id,enrolled_at,access_type,tenant_id,branch_id) VALUES (?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE access_type=VALUES(access_type), tenant_id=VALUES(tenant_id), branch_id=VALUES(branch_id)`,
                [uuidv4(),subscriberId,courseId,createdAt,'FULL',subscriberTenantId,subscriberBranchId]
              );
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

// POST /api/admin/leads/bulk-assign — assign all unassigned NEW/INTERESTED leads to sales round-robin
router.post('/api/admin/leads/bulk-assign', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  let conn = null;
  let transactionStarted = false;
  try {
    if (req.staffRecord?.role === 'SALES') return res.status(403).json({ error: 'غير مصرح' });
    const { statusFilter } = req.body || {};
    conn = await pool.getConnection();
    await conn.beginTransaction();
    transactionStarted = true;
    // Get all active sales reps
    const [reps] = await conn.query(
      `SELECT id, name FROM staff WHERE tenant_id=? AND role='SALES' AND is_active=1 AND deleted_at IS NULL ORDER BY name ASC`,
      [req.tenantId]
    );
    if (!reps.length) {
      await conn.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'لا يوجد مندوبو مبيعات نشطون' });
    }

    // Get unassigned leads (excluding converted/lost/hidden)
    const statusIn = statusFilter ? [statusFilter] : ['new', 'interested', 'NEW', 'INTERESTED'];
    const placeholders = statusIn.map(() => '?').join(',');
    const [unassigned] = await conn.query(
      `SELECT id FROM leads WHERE tenant_id=? AND (assigned_sales_id IS NULL OR assigned_sales_id = '') AND status IN (${placeholders}) AND hidden=0 FOR UPDATE`,
      [req.tenantId, ...statusIn]
    );

    if (!unassigned.length) {
      await conn.commit(); transactionStarted = false;
      return res.json({ assigned: 0, message: 'لا يوجد ليدز غير معيّنة' });
    }

    const updates = [];
    unassigned.forEach((lead, i) => {
      const rep = reps[i % reps.length];
      updates.push({ id: lead.id, salesId: rep.id, salesName: rep.name });
    });

    // Batch update via CASE WHEN for efficiency
    const BATCH = 500;
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);
      if (!batch.length) continue;
      const caseId   = batch.map(u => `WHEN id = ? THEN ?`).join(' ');
      const caseName = batch.map(u => `WHEN id = ? THEN ?`).join(' ');
      const ids      = batch.map(u => u.id);
      const valId    = batch.flatMap(u => [u.id, u.salesId]);
      const valName  = batch.flatMap(u => [u.id, u.salesName]);
      await conn.query(
        `UPDATE leads SET assigned_sales_id = CASE ${caseId} END, assigned_sales_name = CASE ${caseName} END WHERE tenant_id=? AND id IN (${ids.map(() => '?').join(',')})`,
        [...valId, ...valName, req.tenantId, ...ids]
      );
    }
    for (const update of updates) {
      await logLeadEventStrict(
        update.id, 'assigned', `تعيين جماعي لـ: ${update.salesName || update.salesId}`,
        { fromSalesId: null, salesId: update.salesId, salesName: update.salesName, actor: req.user?.email || 'admin' },
        req.tenantId, conn
      );
    }
    await conn.commit();
    transactionStarted = false;

    res.json({ assigned: updates.length, unassigned: 0, reps: reps.length, message: `تم توزيع ${updates.length} ليد على ${reps.length} مندوب` });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[bulk-assign]', e.message); sendRouteError(res, e);
  } finally { conn?.release(); }
});

// POST /api/admin/leads/bulk-whatsapp — send WhatsApp message to multiple leads
// Body: { lead_ids: string[], message: string }
router.post('/api/admin/leads/bulk-whatsapp', requireAuth, requireAdminOrStaff, requirePermission('bulk_whatsapp'), async (req, res) => {
  try {
    const { lead_ids, message } = req.body || {};
    if (!Array.isArray(lead_ids) || lead_ids.length === 0) return res.status(400).json({ error: 'lead_ids required' });
    if (!message?.trim()) return res.status(400).json({ error: 'message required' });
    if (lead_ids.length > 200) return res.status(400).json({ error: 'Maximum 200 leads per batch' });

    const placeholders = lead_ids.map(() => '?').join(',');
    const params = [req.tenantId, ...lead_ids];
    let ownership = '';
    if (req.staffRecord?.role === 'SALES') {
      ownership = ' AND assigned_sales_id=?';
      params.push(req.staffRecord.id);
    }
    const [leads] = await pool.query(
      `SELECT id, name, phone FROM leads WHERE tenant_id=? AND id IN (${placeholders}) AND phone IS NOT NULL AND phone != '' AND hidden=0${ownership}`,
      params
    );

    let sent = 0, failed = 0;
    for (const lead of leads) {
      const personalised = message.replace(/\{\{name\}\}/g, lead.name || '').replace(/\{\{phone\}\}/g, lead.phone || '');
      const result = await sendWhatsApp(lead.phone, personalised, { tenantId: req.tenantId }).catch(() => ({ ok: false }));
      if (result.ok) {
        sent++;
        // Log as communication
        await pool.query(
          `INSERT IGNORE INTO communications (id, lead_id, type, date, notes, outcome)
           VALUES (UUID(), ?, 'whatsapp', CURDATE(), ?, 'sent')`,
          [lead.id, `[Bulk WA] ${personalised.slice(0, 200)}`]
        ).catch(() => {});
        await logLeadEvent(
          lead.id, 'communication', 'إرسال واتساب جماعي',
          { type: 'whatsapp', actor: req.user?.email || 'admin' }, req.tenantId
        );
      } else { failed++; }
      // Small delay to avoid API rate limiting
      await new Promise(r => setTimeout(r, 300));
    }

    res.json({ ok: true, sent, failed, total: leads.length });
  } catch (e) { logger.error('[bulk-whatsapp]', e.message); sendRouteError(res, e); }
});

// POST /api/admin/leads/dedup-cleanup — delete duplicate leads (leads matching subscriber phones + dup-phone leads)
router.get('/api/admin/leads/duplicates', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  try {
    const groups = await findLeadDuplicateGroups(req.tenantId);
    res.json({ groups, count: groups.length });
  } catch (e) { logger.error('[lead-duplicates]', e.message); sendRouteError(res, e); }
});

router.post('/api/admin/leads/merge', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  try {
    const result = await mergeLeads({
      tenantId: req.tenantId,
      targetId: req.body?.targetId,
      sourceIds: req.body?.sourceIds,
      actor: req.user?.email || req.staffRecord?.name || 'admin',
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.error('[lead-merge]', e.message);
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    sendRouteError(res, e);
  }
});

router.post('/api/admin/leads/dedup-cleanup', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.body?.legacyArchiveOnly !== true) {
      const groups = (await findLeadDuplicateGroups(req.tenantId)).slice(0, 100);
      let merged = 0;
      for (const group of groups) {
        const result = await mergeLeads({
          tenantId: req.tenantId,
          targetId: group.targetId,
          sourceIds: group.leads.map(lead => lead.id).filter(id => id !== group.targetId),
          actor: req.user?.email || req.staffRecord?.name || 'admin',
        });
        merged += result.merged;
      }
      return res.json({ ok: true, merged, groups: groups.length, deleted: 0 });
    }
    const normPhone = (p) => (p || '').replace(/\D/g, '').replace(/^00/, '').replace(/^20/, '').replace(/^0/, '');

    // Load all subscribers' phones (normalized)
    const [subs] = await pool.query('SELECT phone FROM subscribers WHERE tenant_id=? AND phone IS NOT NULL AND phone != ""', [req.tenantId]);
    const subPhoneSet = new Set(subs.map(s => normPhone(s.phone)).filter(p => p.length >= 7));

    // Load all leads ordered oldest-first (so we keep the oldest when deduping)
    const [leads] = await pool.query(
      'SELECT id, phone FROM leads WHERE tenant_id=? AND hidden=0 ORDER BY created_at ASC',
      [req.tenantId]
    );

    const toDelete = new Set();

    // a) Leads whose phone matches a subscriber (converted but not cleaned)
    for (const lead of leads) {
      const lp = normPhone(lead.phone);
      if (lp.length >= 7 && subPhoneSet.has(lp)) toDelete.add(lead.id);
    }

    // b) Duplicate-phone leads (keep oldest = first seen per phone, delete the rest)
    const seenPhones = new Map();
    for (const lead of leads) {
      if (toDelete.has(lead.id)) continue;
      const lp = normPhone(lead.phone);
      if (lp.length >= 7) {
        if (seenPhones.has(lp)) toDelete.add(lead.id);
        else seenPhones.set(lp, lead.id);
      }
    }

    const ids = [...toDelete];
    if (ids.length > 0) {
      // Recoverable archive in batches of 500; CRM history must never be hard-deleted.
      for (let i = 0; i < ids.length; i += 500) {
        const batch = ids.slice(i, i + 500);
        await pool.query(
          `UPDATE leads SET hidden=1, updated_at=NOW() WHERE tenant_id=? AND id IN (${batch.map(() => '?').join(',')})`,
          [req.tenantId, ...batch]
        );
      }
    }

    res.json({ ok: true, deleted: ids.length });
  } catch (e) { logger.error('[dedup-cleanup]', e.message); sendRouteError(res, e); }
});

// GET /api/admin/leads/:id/timeline
router.get('/api/admin/leads/:id/timeline', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    // SALES staff can only see timeline for their own leads
    if (req.staffRecord?.role === 'SALES') {
      const [[lead]] = await pool.query('SELECT assigned_sales_id FROM leads WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, req.tenantId]);
      if (!lead || lead.assigned_sales_id !== req.staffRecord.id) {
        return res.status(403).json({ error: 'غير مصرح' });
      }
    }
    const [rows] = await pool.query(
      'SELECT id, lead_id, event_type, description, meta_json, at FROM lead_timeline WHERE tenant_id=? AND lead_id=? ORDER BY at ASC LIMIT 200',
      [req.tenantId, req.params.id]
    );
    res.json(rows.map(r => ({
      id: r.id,
      leadId: r.lead_id,
      eventType: r.event_type,
      description: r.description,
      meta: tryJson(r.meta_json, {}),
      at: r.at,
    })));
  } catch (e) { logger.error('[route]', e.message); sendRouteError(res, e); }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/leads/:id/convert — تحويل ليد إلى مشترك تلقائياً
// ══════════════════════════════════════════════════════════════════════════════
router.post('/api/admin/leads/:id/convert', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const leadId = req.params.id;
    const tenantId = req.tenantId;
    const requestedCourseId = req.body?.courseId ? String(req.body.courseId) : null;
    const requestedAccess = ['full', 'limited', 'preview'].includes(req.body?.accessMode) ? req.body.accessMode : 'full';
    await conn.beginTransaction();
    transactionStarted = true;
    // 1. Fetch lead
    const [[lead]] = await conn.query(
      `SELECT id, client_code, name, email, phone, source, status, lead_type, branch,
       interest_level, interested_course_ids_json, enrolled_course_id, deal_value,
       assigned_sales_id, assigned_sales_name, assigned_cs_id, assigned_cs_name,
       notes, last_follow_up, next_follow_up_date, crm_json, hidden, score, created_at
       FROM leads WHERE id=? AND tenant_id=? AND hidden=0 LIMIT 1 FOR UPDATE`, [leadId, tenantId]);
    if (!lead) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Lead not found' });
    }
    if (req.staffRecord?.role === 'SALES' && lead.assigned_sales_id !== req.staffRecord.id) {
      await conn.rollback(); transactionStarted = false;
      return res.status(403).json({ error: 'غير مصرح: يمكنك فقط تحويل الليدز المعيّنة لك' });
    }

    // 2. Check already converted — return existing subscriber if matched
    const selectedCourseId = requestedCourseId || lead.enrolled_course_id || null;
    if (selectedCourseId) {
      const [[course]] = await conn.query(
        'SELECT id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',
        [selectedCourseId, tenantId]
      );
      if (!course) {
        await conn.rollback(); transactionStarted = false;
        return res.status(400).json({ error: 'Course does not belong to tenant' });
      }
    }

    const [[existingSub]] = await conn.query(
      `SELECT id FROM subscribers
       WHERE tenant_id=? AND (lead_id=? OR LOWER(TRIM(email))=LOWER(?) OR phone=?)
       LIMIT 1 FOR UPDATE`,
      [tenantId, leadId, lead.email || '', lead.phone || '']
    );
    if (existingSub) {
      await conn.query(
        'UPDATE subscribers SET lead_id=COALESCE(lead_id,?), updated_at=NOW() WHERE id=? AND tenant_id=?',
        [leadId, existingSub.id, tenantId]
      );
      if (selectedCourseId) {
        await conn.query(
          `INSERT INTO enrollments (id,subscriber_id,course_id,enrolled_at,access_type,tenant_id,branch_id)
           VALUES (UUID(),?,?,NOW(),?,?,?)
           ON DUPLICATE KEY UPDATE access_type=VALUES(access_type), tenant_id=VALUES(tenant_id)`,
          [existingSub.id, selectedCourseId, requestedAccess, tenantId, branchIdForBranch(lead.branch || 'ONLINE_EGYPT')]
        );
      }
      await transitionLead({
        tenantId, leadId, toStatus: 'converted', db: conn,
        actor: req.user?.email || 'admin', metadata: { subscriberId: existingSub.id, existingSubscriber: true },
      });
      await conn.commit(); transactionStarted = false;
      return res.json({ ok: true, subscriber_id: existingSub.id, already_existed: true });
    }

    // 3. Validate required fields
    if (!lead.email || !lead.name) {
      await conn.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'يجب أن يكون للليد بريد إلكتروني واسم قبل التحويل' });
    }

    // 4. Generate subscriber ID + ensure client_code
    const subId = uuidv4();
    let clientCode = lead.client_code || null;
    if (!clientCode) {
      try { clientCode = await getNextClientCode(conn); } catch (_) {}
    }

    // 4b. Create user account so the subscriber can log in
    const normEmail = lead.email.toLowerCase().trim();
    let tempPass = null;
    let isNewUser = false;
    const [[existingUser]] = await conn.query('SELECT id FROM users WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1', [req.tenantId, normEmail]);
    if (!existingUser) {
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
      tempPass = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      const hash = await bcrypt.hash(tempPass, 12);
      await conn.query(
        'INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active) VALUES (?,?,?,?,?,?,1)',
        [uuidv4(), req.tenantId, normEmail, hash, sanitize(lead.name, 300), 'user']
      );
      isNewUser = true;
    }

    // 5. Resolve collection staff
    let csId = lead.assigned_cs_id || null;
    let csName = lead.assigned_cs_name || null;
    if (!csId) {
      const rep = await autoAssignStaff('COLLECTION', req.tenantId);
      if (rep) { csId = rep.id; csName = rep.name; }
    }

    // 6. Map lead → subscriber fields

    const branch = (lead.branch && VALID_BRANCHES.has(lead.branch)) ? lead.branch : 'ONLINE_EGYPT';
    const branchId = branchIdForBranch(branch);
    // Build crm_json from lead fields
    const crmJson = {
      source: lead.source || null,
      leadType: lead.lead_type || null,
      interestLevel: lead.interest_level || null,
      assignedSalesId:   lead.assigned_sales_id   || null,
      assignedSalesName: lead.assigned_sales_name || null,
      assignedCollectionId:   csId,
      assignedCollectionName: csName,
      notes: lead.notes || null,
      interestedCourseIds: (() => {
        try { return JSON.parse(lead.interested_course_ids_json || '[]'); } catch { return []; }
      })(),
      enrolledCourseIds: lead.enrolled_course_id ? [lead.enrolled_course_id] : [],
      paymentHistory: [],
      convertedFromLeadId: leadId,
      convertedAt: new Date().toISOString(),
    };

    // 7. Insert subscriber
    await conn.query(
      `INSERT INTO subscribers
         (id, client_code, lead_id, name, email, phone, is_active,
          branch, assigned_sales_id, assigned_sales_name,
          assigned_cs_id, assigned_cs_name, notes, crm_json,
          source, tenant_id, branch_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
      [
        subId, clientCode, leadId,
        sanitize(lead.name, 300),
        normEmail,
        ((lead.phone || '').replace(/[^\d+\-\s()]/g, '').trim().substring(0, 30)) || null,
        branch,
        lead.assigned_sales_id || null, lead.assigned_sales_name || null,
        csId, csName,
        sanitize(lead.notes, 2000) || null,
        JSON.stringify(crmJson),
        lead.source || 'lead_conversion',
        tenantId,
        branchId,
      ]
    );

    // 8. Auto-enroll in enrolled_course_id if present
    if (selectedCourseId) {
      await conn.query(
        `INSERT INTO enrollments (id,subscriber_id,course_id,enrolled_at,access_type,tenant_id,branch_id)
         VALUES (UUID(),?,?,NOW(),?,?,?)
         ON DUPLICATE KEY UPDATE access_type=VALUES(access_type), tenant_id=VALUES(tenant_id)`,
        [subId, selectedCourseId, requestedAccess, tenantId, branchId]
      );
    }

    // 9. Mark lead as CONVERTED and link to subscriber
    await transitionLead({
      tenantId, leadId, toStatus: 'converted', db: conn,
      actor: req.user?.email || 'admin',
      reason: `Lead converted to subscriber: ${clientCode || subId}`,
      metadata: { subscriberId: subId, courseId: selectedCourseId, accessMode: requestedAccess },
    });

    // 10. Log timeline event
    await logLeadEvent(leadId, 'converted',
      `تم تحويله إلى مشترك — كود: ${clientCode || subId}`,
      { subscriber_id: subId, converted_by: req.user?.email || 'admin' },
      tenantId,
      conn
    );

    // 11. Log activity
    await conn.query(
      'INSERT INTO activity_logs (id, action, entity, entity_id, label, actor) VALUES (?,?,?,?,?,?)',
      [uuidv4(), 'lead_converted', 'leads', leadId,
       `تحويل ليد → مشترك: ${lead.name}`, req.user?.email || 'admin']
    ).catch(() => {});

    await conn.commit();
    transactionStarted = false;

    // 12. Post-commit: send WhatsApp welcome + enqueue registration sequence
    const sendTenantWhatsApp = (phone, message) => sendWhatsApp(phone, message, { tenantId });
    if (lead.phone) {
      sendTenantWhatsApp(lead.phone.replace(/\D/g, ''),
        `أهلاً ${lead.name} 🎉\nتم تفعيل اشتراكك في معهد مهاد للدراسات النفسية.\nيسعدنا انضمامك لأسرتنا. 💚`
      ).catch(() => {});
    }
    if (lead.email) {
      enqueueEmailSequence({ tenantId, triggerEvent: 'enrollment', recipientEmail: lead.email, recipientName: lead.name }).catch(error => logger.warn('[lead-convert] sequence enqueue failed', { error: error.message }));
    }
    // Send login credentials email if new user account was created
    if (isNewUser && tempPass) {
      mailer.sendMail({
        tenantId,
        from: `"معهد الدراسات النفسية" <${process.env.SMTP_USER || 'info@mahadnafsy.com'}>`,
        to: normEmail,
        subject: 'تم تفعيل حسابك — معهد الدراسات النفسية',
        html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
          <h2 style="color:#7c3aed;text-align:center;">معهد الدراسات النفسية</h2>
          <p>مرحباً <strong>${lead.name}</strong>،</p>
          <p>يسعدنا إبلاغك بأنه تم تحويلك إلى مشترك فعّال في منصتنا. إليك بيانات الدخول:</p>
          <div style="background:#f5f3ff;border:2px solid #7c3aed;border-radius:8px;padding:16px;text-align:center;margin:16px 0;">
            <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">البريد الإلكتروني</p>
            <strong style="color:#1f2937;">${normEmail}</strong>
            <p style="margin:12px 0 6px;color:#6b7280;font-size:13px;">كلمة المرور المؤقتة</p>
            <span style="font-family:monospace;font-size:26px;font-weight:bold;color:#7c3aed;letter-spacing:4px;">${tempPass}</span>
          </div>
          <p>يرجى تغيير كلمة المرور بعد أول تسجيل دخول.</p>
          <a href="https://mahadnafsy.com/login" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-weight:bold;">الدخول للمنصة ←</a>
          <p style="color:#9ca3af;font-size:12px;margin-top:24px;">معهد الدراسات النفسية — mahadnafsy.com</p>
        </div>`,
      }).catch(e => logger.warn('[lead-convert] credentials email failed:', e.message));
    }
    createNotification('subscriber', '🎉 تحويل ليد → مشترك',
      `${lead.name} تم تحويله من ليد إلى مشترك`,
      { subscriberId: subId, leadId }, tenantId
    ).catch(() => {});

    res.json({ ok: true, subscriber_id: subId, client_code: clientCode, already_existed: false });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[lead-convert]', e.message);
    sendRouteError(res, e);
  } finally { conn.release(); }
});

// POST /api/admin/migrate-branches — one-time migration to normalize old branch values

// GET /api/admin/leads?limit=500&offset=0
router.get('/api/admin/leads', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const limit  = parseLimit(req.query.limit, 500, 5000);
    const offset = parseOffset(req.query.offset);
    // Role-based visibility:
    //   SALES     → only their assigned leads (assigned_sales_id)
    //   COLLECTION → only leads where their subscriber is linked (assigned_cs_id on leads, via subscriber join)
    //   Others (MANAGER, ADMIN, DAQQI_MANAGER, ACCOUNTANT) → all leads
    let sql = `SELECT l.id, l.client_code, l.name, l.email, l.phone, l.source, l.status, l.lead_type, l.branch,
      l.interest_level, l.interested_course_ids_json, l.enrolled_course_id, l.deal_value,
      l.assigned_sales_id, COALESCE(ss.name, l.assigned_sales_name) AS assigned_sales_name,
      l.assigned_cs_id, COALESCE(cs.name, l.assigned_cs_name) AS assigned_cs_name,
      l.notes, l.last_follow_up, l.next_follow_up_date, l.crm_json, l.hidden, l.score, l.created_at, l.updated_at
      FROM leads l
      LEFT JOIN staff ss ON ss.id = l.assigned_sales_id
      LEFT JOIN staff cs ON cs.id = l.assigned_cs_id
      WHERE l.tenant_id = ? AND l.hidden = 0`;
    const params = [req.tenantId];
    // Was only scoping SALES/COLLECTION — every other role (RECEPTION_DAQQI, HR,
    // SUPPORT, CONSULTANT, TRAINER, INSTRUCTOR, and DAQQI_MANAGER despite this file's
    // own comment claiming otherwise) fell through to "no additional filter" = every
    // branch's leads. Route through the same DATA_SCOPE table the sibling
    // /api/staff/subscribers already uses, so RECEPTION_DAQQI/DAQQI_MANAGER only see
    // DAQQI-branch leads like they're supposed to.
    const role = (req.staffRecord?.role || '').toLowerCase();
    if (req.staffRecord && !req.isSuperAdmin) {
      const scope = DATA_SCOPE[role] || 'assigned_sales';
      if (scope === 'none') return res.json([]);
      if (scope === 'assigned_sales') {
        sql += ' AND l.assigned_sales_id = ?';
        params.push(req.staffRecord.id);
      } else if (scope === 'assigned_cs') {
        // COLLECTION/SUPPORT staff see leads whose linked subscriber is assigned to them
        sql += ' AND l.id IN (SELECT lead_id FROM subscribers WHERE tenant_id=? AND assigned_cs_id=? AND lead_id IS NOT NULL)';
        params.push(req.tenantId, req.staffRecord.id);
      } else if (scope.startsWith('branch:')) {
        sql += ' AND l.branch = ?';
        params.push(scope.slice(7));
      }
      // scope === 'all' → no additional filter
    }

    // Optional server-side search/filter — additive, backward-compatible: callers that
    // don't pass q/status get identical results to before.
    const q = (req.query.q || '').trim();
    if (q) {
      sql += ' AND (l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ? OR l.client_code LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    const statusFilter = (req.query.status || '').trim().toLowerCase();
    if (statusFilter && statusFilter !== 'all') {
      sql += ' AND LOWER(l.status) = ?';
      params.push(statusFilter);
    }

    // Cursor (keyset) pagination — opt-in via ?cursor=, falls back to offset.
    let nextCursorFn = null;
    if (req.query.cursor) {
      const ks = keyset(req.query, { col: 'l.created_at', idCol: 'l.id', limit, maxLimit: 5000 });
      sql += ` AND ${ks.where} ORDER BY l.created_at DESC, l.id DESC LIMIT ?`;
      params.push(...ks.params, ks.limit);
      nextCursorFn = ks.nextCursor;
    } else {
      sql += ' ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }
    const [rows] = await pool.query(sql, params);
    if (nextCursorFn) { const nc = nextCursorFn(rows); if (nc) res.set('X-Next-Cursor', nc); }
    res.json(rows.map(r => {
      const crm = parseCrm(r.crm_json);
      // client_code column is authoritative; crm_json clientCode is a fallback
      const clientCode = r.client_code || crm.clientCode || null;
      // Normalize status to lowercase (schema stores ENUM as uppercase: 'NEW','CONVERTED', etc.)
      const status = (r.status || 'new').toLowerCase();
      // DB columns take precedence over crm_json values for branch and interestedCourseIds
      const rawBranch = r.branch || crm.branch || null;

      const normB = rawBranch ? rawBranch.toUpperCase().replace(/[-\s]/g,'_') : null;
      const branch = (normB && VALID_BRANCHES.has(normB)) ? normB : rawBranch;
      const interestedCourseIds = tryJson(r.interested_course_ids_json, crm.interestedCourseIds || []);
      const dealValue = r.deal_value != null ? Number(r.deal_value) : (crm.dealValue || null);
      // crm_json spread goes FIRST so explicit DB columns always win
      return { ...crm,
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        source: r.source, status, notes: cleanLegacyLeadText(r.notes), createdAt: r.created_at,
        branch, rawBranch: cleanLegacyLeadText(crm.rawBranch || rawBranch || ''), interestedCourseIds, clientCode, dealValue,
        assignedSalesId: r.assigned_sales_id || crm.assignedSalesId || null,
        assignedSalesName: r.assigned_sales_name || crm.assignedSalesName || null,
        assignedCsId: r.assigned_cs_id || crm.assignedCsId || null,
        assignedCsName: r.assigned_cs_name || crm.assignedCsName || null,
        interestLevel: r.interest_level || crm.interestLevel || null,
        nextFollowUpDate: r.next_follow_up_date || crm.nextFollowUpDate || null,
        lastFollowUp: r.last_follow_up || crm.lastFollowUp || null,
      };
    }));
  } catch (e) { logger.error('[route]', e.message); sendRouteError(res, e); }
});

// GET /api/admin/payments?startDate=&endDate=&channel=&paymentType=

// GET /api/admin/expenses



// 404 for unknown /api routes

module.exports = router;
