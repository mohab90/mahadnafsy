'use strict';
const logger = require('../../lib/logger');
const crypto   = require('crypto');
const bcrypt   = require('../../lib/passwordHash');
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../../lib/id');
const { generateTemporaryPassword } = require('../../lib/secureCredentials');

const { pool, autoAssignStaff, cacheInvalidate } = require('../../lib/db');
const { mailer } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { tryJson, sanitize, parseLimit, parseOffset, parseCrm, calcLeadScoreServer, ymd } = require('../../lib/helpers');
const { COURSE_COLS, mapCourse, getNextClientCode } = require('../../lib/mappers');
const { createNotification } = require('../../lib/notification');
const { logLeadEvent, logLeadEventStrict } = require('../../lib/crm');
const { normalizeLeadStatus, transitionLead } = require('../../lib/leadState');
const { getNextSalesRep } = require('../../lib/leadAssignment');
const { appendLeadInteraction, queueLeadWhatsAppBatch } = require('../../lib/leadInteractions');
const { grantCourseEntitlement } = require('../../lib/entitlements');
const { leadScope, branchesFromScope } = require('../../lib/leadAccess');
const {
  archiveLead,
  findLeadById,
  findLeadByIdentity,
  listLeadCommunications,
} = require('../../lib/leadRepository');
const {
  findLeadDuplicateGroups,
  listLeadMergeHistory,
  mergeLeads,
  unmergeLead,
} = require('../../lib/leadMerge');
const { enqueueEmailSequence } = require('../../lib/emailSequence');
const { ADMIN_EMAILS, requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { VALID_BRANCHES, VALID_PAY_TYPES, VALID_SOURCES } = require('../../constants/permissions');
const { safeIsoString, safeDateOnly } = require('../../lib/dates');
const { keyset } = require('../../lib/pagination');
const { branchIdForBranch } = require('../../lib/branches');
const { postPaymentJournal } = require('../../lib/finance');
const { bulkOperationLimiter } = require('../../middleware/rateLimits');
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
  const l = req.body;
  const tenantId = req.tenantId;
  const staffRole = String(req.staffRecord?.role || '').toLowerCase();
  const writeScope = leadScope(req, 'l');
  // Lock by phone (the actual duplicate-detection key) so two concurrent
  // creates for the same number can't both pass the "does this exist?"
  // check before either INSERT lands — the exact race the public capture
  // routes already guard against with the same GET_LOCK pattern. Falls back
  // to the request's own id for updates, where the FOR UPDATE row lock below
  // is the real guard and this is just a lightweight serialization aid.
  const rawPhone = String(l.phone || '').replace(/[^\d+\-\s()]/g, '').trim();
  const lockKey = `admin-lead:${crypto.createHash('sha256').update(`${tenantId}:${rawPhone || l.id || ''}`).digest('hex').slice(0, 40)}`;
  let conn;
  let lockAcquired = false;
  try {
    conn = await pool.getConnection();
    const [[lock]] = await conn.query('SELECT GET_LOCK(?,5) AS acquired', [lockKey]);
    lockAcquired = Number(lock?.acquired) === 1;
    if (!lockAcquired) return res.status(409).json({ error: 'Lead save is already being processed' });
    await conn.beginTransaction();

    const requestedId = l.id ? String(l.id) : null;
    const existing = requestedId
      ? await findLeadById({ tenantId, leadId: requestedId, db: conn, includeHidden: true, forUpdate: true })
      : null;
    const id = existing ? requestedId : uuidv4();
    if (existing) {
      const [[accessible]] = await conn.query(
        `SELECT l.id FROM leads l
          WHERE l.tenant_id=? AND l.id=?${writeScope.sql}
          LIMIT 1 FOR UPDATE`,
        [tenantId, existing.id, ...writeScope.params]
      );
      if (!accessible) {
        await conn.rollback();
        return res.status(404).json({ error: 'Lead not found' });
      }
    } else if (writeScope.none || writeScope.scope === 'assigned_cs') {
      await conn.rollback();
      return res.status(403).json({ error: 'Lead creation is outside your data scope' });
    }
    // Extract base columns; store everything else in crm_json
    const { id: _id, name, email, phone, source, status, notes, hidden, createdAt, created_at, clientCode, client_code, ...crmData } = l;
    const incomingCommunications = Array.isArray(crmData.communications) ? crmData.communications : [];
    delete crmData.communications;
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
      const [[existSub]] = await conn.query(
        'SELECT id, name, client_code FROM subscribers WHERE tenant_id=? AND phone=? LIMIT 1', [tenantId, safePhone]
      );
      if (existSub) {
        await conn.rollback();
        return res.status(409).json({
          error: `رقم الهاتف ${safePhone} مسجل بالفعل كمشترك (${existSub.name || ''})`,
          existingId: existSub.id,
          existingCode: existSub.client_code,
          type: 'subscriber',
        });
      }
      const existLead = await findLeadByIdentity({
        tenantId, phone: safePhone, excludeId: id, db: conn, forUpdate: true,
      });
      if (existLead) {
        await conn.rollback();
        return res.status(409).json({
          error: `رقم الهاتف ${safePhone} مسجل بالفعل في العملاء المحتملين (${existLead.name || ''})`,
          existingId: existLead.id,
          type: 'lead',
        });
      }
    }
    // Check for duplicate email on new lead
    if (isNew && safeEmail) {
      const existByEmail = await findLeadByIdentity({
        tenantId, email: safeEmail, excludeId: id, db: conn, forUpdate: true,
      });
      if (existByEmail) {
        await conn.rollback();
        return res.status(409).json({
          error: `البريد الإلكتروني مسجل بالفعل (${existByEmail.name || ''})`,
          existingId: existByEmail.id,
        });
      }
    }
    // Auto-generate client_code for new leads
    if (isNew && !code) {
      try { code = await getNextClientCode(conn); } catch { /* ignore */ }
    }
    const branchRaw = crmData.branch || null;
    let branchVal = branchRaw ? String(branchRaw).trim().toUpperCase().replace(/[-\s]/g, '_') : null;
    if (isNew && writeScope.scope.startsWith('branch:')) {
      // A branch scope can cover several branches (e.g. an online manager over the
      // three online branches), so membership is checked against the whole set.
      // When the caller doesn't name a branch we fall back to the first one in the
      // scope — for a single-branch scope that is exactly the previous behaviour.
      const scopedBranches = branchesFromScope(writeScope.scope);
      if (!scopedBranches.length || (branchVal && !scopedBranches.includes(branchVal))) {
        await conn.rollback();
        return res.status(403).json({ error: 'Lead branch is outside your data scope' });
      }
      branchVal = branchVal || scopedBranches[0];
      crmData.branch = branchVal;
    }
    const branchId = branchVal ? branchIdForBranch(branchVal) : null;
    if (branchVal && !VALID_BRANCHES.has(branchVal)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Invalid lead branch' });
    }
    // Auto-assign to sales on new lead if not already assigned.
    // `skipAutoAssign` lets a caller opt out and land the lead in the
    // unassigned pool instead — bulk imports use it, because round-robin
    // scattering a thousand archived rows across the team the instant they
    // arrive is the opposite of the manual distribution the desk wants.
    const skipAutoAssign = crmData.skipAutoAssign === true;
    delete crmData.skipAutoAssign;
    let salesId   = crmData.assignedSalesId   || null;
    let salesName = crmData.assignedSalesName || null;
    if (staffRole === 'sales') {
      salesId = req.staffRecord.id;
      salesName = req.staffRecord.name || salesName;
      crmData.assignedSalesId = salesId;
      crmData.assignedSalesName = salesName;
    } else if (isNew && !salesId && !skipAutoAssign) {
      const rep = await getNextSalesRep(req.tenantId, conn, { branch: branchVal });
      if (rep) { salesId = rep.id; salesName = rep.name; crmData.assignedSalesId = rep.id; crmData.assignedSalesName = rep.name; }
    }
    const prevStatus = existing ? existing.status : null;
    const prevCrm = existing ? tryJson(existing.crm_json, {}) : {};
    delete prevCrm.communications;
    const crmToStore = isNew ? crmData : { ...prevCrm, ...crmData };

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
      await conn.query(
        `INSERT INTO leads (id, tenant_id, client_code, name, email, phone, source, status, notes, hidden,
           assigned_sales_id, assigned_sales_name, crm_json, branch, branch_id, client_type, interested_course_ids_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
         [id, tenantId, code, safeName||'', safeEmail||'', safePhone||null, safeSource||null, normalizedRequestedStatus,
         safeNotes||null, hidden||0, salesId, salesName, JSON.stringify(crmToStore), branchVal, branchId, leadClientTypeVal, courseIdsJson]
      );
    } else {
      // `hidden` used to be silently dropped here — extracted from the body
      // at the top of this handler but never referenced in this UPDATE (only
      // the INSERT branch above used it). Every "hide/unhide" click on an
      // existing lead (the eye icon in LeadTable.tsx, which POSTs the whole
      // row back with just that one field flipped) looked like it worked —
      // 200 OK, updated_at bumped — but the column never actually changed.
      // COALESCE(?,hidden) so a caller that omits `hidden` entirely (sends
      // undefined → NULL) still leaves the existing value untouched, same
      // pattern as assigned_sales_id/branch/client_type below.
      // COALESCE alone made "unassign" impossible: a caller that omits
      // assignedSalesId and one that explicitly sends null both arrive as NULL,
      // so the column kept the previous rep forever — a lead belonging to a
      // departed rep could never be freed, and a redistribution that cleared
      // the field silently kept the old owner (same failure shape as the
      // crm_json stale-assignment bug). Distinguish the two: an explicitly
      // present null clears, an absent key still leaves the value untouched.
      const clearSales = Object.prototype.hasOwnProperty.call(crmData, 'assignedSalesId') && !crmData.assignedSalesId;
      const [updated] = await conn.query(
        `UPDATE leads SET name=?, email=?, phone=?, source=?, notes=?, client_code=COALESCE(client_code,?),
           assigned_sales_id=IF(?,NULL,COALESCE(?,assigned_sales_id)),
           assigned_sales_name=IF(?,NULL,COALESCE(?,assigned_sales_name)),
           crm_json=?, branch=COALESCE(NULLIF(?,''),branch), branch_id=COALESCE(?,branch_id), client_type=COALESCE(?,client_type),
           interested_course_ids_json=COALESCE(?,interested_course_ids_json), hidden=COALESCE(?,hidden)
         WHERE id=? AND tenant_id=?`,
        [safeName||'', safeEmail||null, safePhone, safeSource||null, safeNotes||null, code,
         clearSales ? 1 : 0, salesId, clearSales ? 1 : 0, salesName,
         JSON.stringify(crmToStore), branchVal, branchId, leadClientTypeVal, courseIdsJson,
         typeof hidden === 'boolean' ? (hidden ? 1 : 0) : null, id, tenantId]
      );
      if (!updated.affectedRows) {
        await conn.rollback();
        return res.status(404).json({ error: 'Lead not found' });
      }
    }
    let statusTransitionLogged = false;
    if (!isNew && String(prevStatus || '').toLowerCase() !== normalizedRequestedStatus) {
      const transition = await transitionLead({
        tenantId, leadId: id, toStatus: normalizedRequestedStatus,
        actor: req.user?.email || req.staffRecord?.name || null,
        db: conn,
      });
      statusTransitionLogged = transition.changed;
    }
    for (const interaction of incomingCommunications) {
      await appendLeadInteraction({
        tenantId,
        leadId: id,
        interaction,
        actor: { email: req.user?.email || null, name: req.staffRecord?.name || null },
        staffId: req.staffRecord?.id || null,
        db: conn,
      });
    }
    const [[communicationStats]] = await conn.query(
      'SELECT COUNT(*) AS total FROM communications WHERE tenant_id=? AND lead_id=?',
      [tenantId, id]
    );
    // Update persisted score after every save
    const newScore = calcLeadScoreServer(
      status, crmData.interestLevel,
      { length: Number(communicationStats?.total || 0) }, crmData.nextFollowUpDate, crmData.interestedCourseIds,
      crmData.createdAt || new Date().toISOString()
    );
    await conn.query('UPDATE leads SET score=? WHERE id=? AND tenant_id=?', [newScore, id, tenantId]);

    // ── Log timeline events ────────────────────────────────────────────────
    const normalizedNew = normalizedRequestedStatus;
    const normalizedPrev = (prevStatus || '').toLowerCase();
    // Deferred until after commit — fire-and-forget, must not run against a
    // connection whose transaction might still roll back.
    const postCommitNotifications = [];
    if (isNew) {
      await logLeadEventStrict(id, 'created', `تم إضافة الليد من: ${source || 'غير محدد'}`, { source, status: normalizedNew, name, phone }, tenantId, conn);
      if (salesId) await logLeadEventStrict(id, 'assigned', `تعيين تلقائي للمبيعات: ${salesName || salesId}`, { salesId, salesName, auto: true }, tenantId, conn);
      // Automation #4: Auto-set follow-up date to +2 days if none specified.
      // Only for a lead that has an owner. An unassigned lead — every row of a
      // bulk archive import — has nobody to do the following up, so stamping it
      // with a date due in two days just manufactures thousands of overdue
      // follow-ups against a rep who has not even been given the lead yet.
      if (!crmData.nextFollowUpDate && salesId) {
        const followUpDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        await conn.query('UPDATE leads SET next_follow_up_date=? WHERE id=? AND tenant_id=? AND next_follow_up_date IS NULL', [followUpDate, id, tenantId]);
        await logLeadEventStrict(id, 'followup_set', `موعد متابعة تلقائي: ${followUpDate}`, { date: followUpDate, auto: true }, tenantId, conn);
      }
      // Notify assigned sales staff (or all admins) of new lead
      postCommitNotifications.push(() => createNotification('lead', '📋 ليد جديد',
        `${safeName || 'مجهول'} — ${safeSource || 'بدون مصدر'}${safePhone ? ' | ' + safePhone : ''}`,
        { leadId: id, assignedSalesId: salesId }, tenantId
      ));
      // Welcome the lead automatically, same journey step the public capture
      // forms and website registration use — a lead added by staff was the one
      // door that produced no welcome at all. Queued through the outbox (retry +
      // dedupe on the lead id), and only after commit so a rolled-back insert
      // can never send a message about a lead that doesn't exist.
      if (safePhone || safeEmail) {
        postCommitNotifications.push(() => require('../../lib/lifecycle').trigger('lead_created', {
          name: safeName, email: safeEmail, phone: safePhone, tenantId,
        }, { dedupeKey: `lead:${id}` }));
      }
    } else {
      // Status changed?
      if (normalizedPrev && normalizedPrev !== normalizedNew && !statusTransitionLogged) {
        const STATUS_AR = { new:'جديد', contacted:'تم التواصل', interested:'مهتم', not_interested:'غير مهتم', no_answer:'لا جواب', closed:'مغلق', converted:'تحوّل لعميل', lost:'خسرنا' };
        await logLeadEventStrict(id, 'status_changed', `تغيير الحالة: ${STATUS_AR[normalizedPrev] || normalizedPrev} ← ${STATUS_AR[normalizedNew] || normalizedNew}`, { from: normalizedPrev, to: normalizedNew }, tenantId, conn);
      }
      // Assignment changed?
      if (crmData.assignedSalesId && crmData.assignedSalesId !== prevCrm.assignedSalesId) {
        await logLeadEventStrict(id, 'assigned', `تعيين لـ: ${crmData.assignedSalesName || crmData.assignedSalesId}`, { salesId: crmData.assignedSalesId, salesName: crmData.assignedSalesName }, tenantId, conn);
        postCommitNotifications.push(() => createNotification('lead', '👤 تعيين ليد',
          `${safeName || 'ليد'} تم تعيينه لـ: ${crmData.assignedSalesName || crmData.assignedSalesId}`,
          { leadId: id, assignedSalesId: crmData.assignedSalesId, assignedSalesName: crmData.assignedSalesName }, tenantId
        ));
      }
      // Follow-up date set/changed?
      if (crmData.nextFollowUpDate && crmData.nextFollowUpDate !== prevCrm.nextFollowUpDate) {
        await logLeadEventStrict(id, 'followup_set', `موعد متابعة: ${crmData.nextFollowUpDate}`, { date: crmData.nextFollowUpDate }, tenantId, conn);
      }
    }

    await conn.commit();
    for (const fire of postCommitNotifications) fire().catch(() => {});
    res.json({ ok: true, id });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    logger.error('[route]', e.message); sendRouteError(res, e);
  } finally {
    if (conn) {
      if (lockAcquired) await conn.query('SELECT RELEASE_LOCK(?)', [lockKey]).catch(() => {});
      conn.release();
    }
  }
});

// ── POST /api/admin/import/daqqi — bulk import subscribers + enrollments + payments for DAQQI branch ──
router.delete('/api/admin/leads/:id', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (!await archiveLead({ tenantId: req.tenantId, leadId: req.params.id, db: conn })) {
      await conn.rollback();
      return res.status(404).json({ error: 'Lead not found' });
    }
    await logLeadEventStrict(
      req.params.id, 'archived', 'تمت أرشفة الليد',
      { actor: req.user?.email || 'admin' }, req.tenantId, conn
    );
    await conn.commit();
    res.json({ ok: true, archived: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[lead-archive]', e.message);
    sendRouteError(res, e);
  } finally { conn.release(); }
});

router.post('/api/admin/import/daqqi', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), requirePermission('manage_payments'), async (req, res) => {
  try {
    if (String(req.staffRecord?.role || '').toLowerCase() === 'sales') return res.status(403).json({ error: 'غير مصرح' });
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
router.post('/api/admin/leads/bulk-assign', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), bulkOperationLimiter, async (req, res) => {
  let conn = null;
  let transactionStarted = false;
  try {
    if (String(req.staffRecord?.role || '').toLowerCase() === 'sales') return res.status(403).json({ error: 'غير مصرح' });
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
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) {
      await conn.rollback(); transactionStarted = false;
      return res.status(403).json({ error: 'Lead assignment is outside your data scope' });
    }
    const [unassigned] = await conn.query(
      `SELECT l.id FROM leads l
        WHERE l.tenant_id=? AND (l.assigned_sales_id IS NULL OR l.assigned_sales_id = '')
          AND l.status IN (${placeholders}) AND l.hidden=0${accessScope.sql}
        FOR UPDATE`,
      [req.tenantId, ...statusIn, ...accessScope.params]
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
router.post('/api/admin/leads/bulk-whatsapp', requireAuth, requireAdminOrStaff, requirePermission('bulk_whatsapp'), bulkOperationLimiter, async (req, res) => {
  try {
    const { lead_ids, message } = req.body || {};
    if (!Array.isArray(lead_ids) || lead_ids.length === 0) return res.status(400).json({ error: 'lead_ids required' });
    if (!message?.trim()) return res.status(400).json({ error: 'message required' });
    if (lead_ids.length > 200) return res.status(400).json({ error: 'Maximum 200 leads per batch' });

    const results = await queueLeadWhatsAppBatch({
      tenantId: req.tenantId,
      leadIds: lead_ids,
      message,
      actor: { email: req.user?.email || null, name: req.staffRecord?.name || null },
      staffId: req.staffRecord?.id || null,
      accessScope: leadScope(req, 'l'),
    });

    // `sent`/`failed` kept for existing frontend callers (LeadScoringTab.tsx,
    // MarketingHubTab.tsx, SegmentationSection.tsx, AbTestSection.tsx) — matches the
    // already-established "queued now means sent" wording used for email/SMS campaigns.
    res.json({ ok: true, queued: results.length, sent: results.length, failed: 0, total: results.length });
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

router.get('/api/admin/leads/merge-history', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  try {
    res.json(await listLeadMergeHistory(req.tenantId, req.query?.limit));
  } catch (e) { logger.error('[lead-merge-history]', e.message); sendRouteError(res, e); }
});

router.post('/api/admin/leads/unmerge', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  try {
    const result = await unmergeLead({
      tenantId: req.tenantId,
      sourceId: req.body?.sourceId,
      actor: req.user?.email || req.staffRecord?.name || 'admin',
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.error('[lead-unmerge]', e.message);
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
    if (String(req.staffRecord?.role || '').toLowerCase() === 'sales') {
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
    if (String(req.staffRecord?.role || '').toLowerCase() === 'sales' && lead.assigned_sales_id !== req.staffRecord.id) {
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
      await transitionLead({
        tenantId, leadId, toStatus: 'converted', db: conn,
        actor: req.user?.email || 'admin',
        metadata: {
          subscriberId: existingSub.id,
          existingSubscriber: true,
          selectedCourseId,
          entitlementDeferredUntilPayment: Boolean(selectedCourseId),
        },
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
      tempPass = generateTemporaryPassword();
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
      selectedCourseId,
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

    // Course selection is intent, not access. The canonical paid/manual
    // payment workflow grants the entitlement in the same transaction as its
    // journal entry; CRM conversion must never unlock LMS content by itself.

    // 8. Mark lead as CONVERTED and link to subscriber
    await transitionLead({
      tenantId, leadId, toStatus: 'converted', db: conn,
      actor: req.user?.email || 'admin',
      reason: `Lead converted to subscriber: ${clientCode || subId}`,
      metadata: {
        subscriberId: subId,
        selectedCourseId,
        requestedAccess,
        entitlementDeferredUntilPayment: Boolean(selectedCourseId),
      },
    });

    // 9. Log timeline event
    await logLeadEvent(leadId, 'converted',
      `تم تحويله إلى مشترك — كود: ${clientCode || subId}`,
      { subscriber_id: subId, converted_by: req.user?.email || 'admin' },
      tenantId,
      conn
    );

    // 10. Log activity
    await conn.query(
      'INSERT INTO activity_logs (id, tenant_id, action, entity, entity_id, label, actor) VALUES (?,?,?,?,?,?,?)',
      [uuidv4(), req.tenantId, 'lead_converted', 'leads', leadId,
       `تحويل ليد → مشترك: ${lead.name}`, req.user?.email || 'admin']
    ).catch(() => {});

    await conn.commit();
    transactionStarted = false;

    // 12. Post-commit: send WhatsApp welcome + enqueue registration sequence
    const sendTenantWhatsApp = (phone, message) => sendWhatsApp(phone, message, { tenantId, category: 'crm' });
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
// calcLeadScoreServer(), expressed in SQL.
//
// lib/helpers.js holds the JavaScript original and remains the version the write
// path uses; this is the same formula arranged so a rep's mean score can be a
// GROUP BY instead of 26,888 rows crossing the network to be averaged in a
// browser. The two are checked against each other on real data — every lead,
// both ways — and they agree exactly.
//
// Expects a joined subquery aliased `lc` carrying comm_count and last_comm.
//
// Three fields read crm_json when their own column is empty, because the row
// mapper does the same and the JS formula is fed the mapped value. Without those
// arms two leads out of 26,888 scored differently — old rows whose course list
// and interest level only ever made it into the JSON blob. JSON_VALID guards
// each one: crm_json is free-form text on old rows and MariaDB will not extract
// from something that is not JSON.
//
// The two day-counts deliberately differ in shape, matching the original: the
// contact decay measures from the calendar day of the last communication (the JS
// slices the date before parsing it), while the no-contact decay measures from
// the full created_at timestamp. FLOOR(TIMESTAMPDIFF(SECOND …)/86400) rather than
// DATEDIFF because DATEDIFF rounds both operands to dates and would count a day
// too many on the second one.
const LEAD_SCORE_SQL = `
  LEAST(100, GREATEST(0,
    -- No LOWER() on the subject: the column collates utf8mb4_unicode_ci, so
    -- 'NEW' matches the 'new' arm on its own. Wrapping it changed nothing but
    -- the query plan.
    CASE l.status
      WHEN 'new' THEN 5 WHEN 'contacted' THEN 15
      WHEN 'interested' THEN 35 WHEN 'interested_booking' THEN 35
      WHEN 'interested_followup' THEN 35
      WHEN 'postpone_month' THEN 10
      WHEN 'no_answer' THEN 8 WHEN 'no_answer_wa' THEN 8 WHEN 'no_answer_nowa' THEN 8
      WHEN 'wrong_number' THEN 0 WHEN 'with_colleague' THEN 10
      WHEN 'not_interested' THEN 0 WHEN 'not_interested_hidden' THEN 0
      WHEN 'closed' THEN 50 WHEN 'converted' THEN 100 WHEN 'lost' THEN 0
      WHEN 'other' THEN 2 ELSE 0
    END
    + CASE LOWER(COALESCE(
        NULLIF(l.interest_level, ''),
        NULLIF(IF(JSON_VALID(l.crm_json)
                  AND JSON_TYPE(JSON_EXTRACT(l.crm_json, '$.interestLevel')) NOT IN ('NULL'),
                  JSON_UNQUOTE(JSON_EXTRACT(l.crm_json, '$.interestLevel')), NULL), ''),
        ''))
        WHEN 'high' THEN 30 WHEN 'medium' THEN 15 ELSE 5
      END
    + LEAST(COALESCE(lc.comm_count, 0) * 5, 25)
    + IF(l.next_follow_up_date IS NOT NULL
         OR COALESCE(NULLIF(IF(JSON_VALID(l.crm_json)
                               AND JSON_TYPE(JSON_EXTRACT(l.crm_json, '$.nextFollowUpDate')) NOT IN ('NULL'),
                               JSON_UNQUOTE(JSON_EXTRACT(l.crm_json, '$.nextFollowUpDate')), NULL), ''),
                     '') <> '', 5, 0)
    + IF(COALESCE(
           JSON_LENGTH(l.interested_course_ids_json),
           IF(JSON_VALID(l.crm_json)
              AND JSON_TYPE(JSON_EXTRACT(l.crm_json, '$.interestedCourseIds')) = 'ARRAY',
              JSON_LENGTH(JSON_EXTRACT(l.crm_json, '$.interestedCourseIds')), NULL),
           0) > 0, 10, 0)
    - IF(l.status IN ('converted','lost','not_interested','not_interested_hidden','wrong_number'),
         0,
         IF(lc.last_comm IS NOT NULL,
            GREATEST(0, LEAST((FLOOR(TIMESTAMPDIFF(SECOND, DATE(lc.last_comm), NOW()) / 86400) - 7) * 2, 30)),
            GREATEST(0, LEAST((FLOOR(TIMESTAMPDIFF(SECOND, l.created_at, NOW()) / 86400) - 14) * 1, 20))
         )
      )
  ))`;

// Row → LeadItem, shared by every route that returns whole leads.
//
// This was inline in GET /api/admin/leads and nowhere else, because that route
// was the only way to get a lead out of the database. The reminders route needs
// the identical shape — same crm_json precedence, same lowercased status, same
// branch normalisation — and a second copy of it would drift.
function mapLeadRow(r, communicationsByLead) {
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
  const canonicalCommunications = communicationsByLead.get(r.id);
  const communications = canonicalCommunications || [];
  // crm_json spread goes FIRST so explicit DB columns always win
  return { ...crm,
    id: r.id, name: r.name, email: r.email, phone: r.phone,
    source: r.source, status, notes: cleanLegacyLeadText(r.notes), createdAt: r.created_at,
    branch, rawBranch: cleanLegacyLeadText(crm.rawBranch || rawBranch || ''), interestedCourseIds, clientCode, dealValue,
    assignedSalesId: r.assigned_sales_id || null,
    assignedSalesName: r.assigned_sales_name || null,
    assignedCsId: r.assigned_cs_id || null,
    assignedCsName: r.assigned_cs_name || null,
    interestLevel: r.interest_level || crm.interestLevel || null,
    // ymd(), because next_follow_up_date is a DATETIME: mysql2 hands it back as
    // a Date, JSON turns that into '2026-08-23T00:00:00.000Z', and the reminders
    // panel compares it with === against a plain '2026-08-23'. That comparison
    // could never be true, so the "due today" column was always empty and today's
    // follow-ups were being listed under "upcoming" instead.
    nextFollowUpDate: ymd(r.next_follow_up_date) || crm.nextFollowUpDate || null,
    lastFollowUp: r.last_follow_up || crm.lastFollowUp || null,
    communications,
    communicationCount: Number(r.communication_count || 0),
    communications_count: Number(r.communication_count || 0),
  };
}

// GET /api/admin/leads/staff-performance?from=YYYY-MM-DD
//
// Per-rep lead counts inside a date range. Its own endpoint rather than a
// parameter on /stats, because /stats.byOwner is read by the CRM performance
// panel with no range at all — adding one there would silently move numbers on
// a screen that never asked for it.
//
// `from` is computed by the caller and passed as a plain date. The range labels
// (week/month/quarter) live in the screen that offers them; the server only
// needs the boundary they resolve to, and duplicating the label arithmetic here
// would give two places to disagree about when a month starts.
//
// Three counts, two date columns. leads and converted are bounded by created_at;
// contacted is bounded by updated_at falling back to created_at, which is what
// the browser did — a lead contacted this month but created last year belongs in
// this month's contacted figure and not in this month's new-lead figure.
router.get('/api/admin/leads/staff-performance', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) return res.json({ from: null, byStaff: {} });
    const scopeClause = accessScope.sql;
    const base = [req.tenantId, ...accessScope.params];

    // Anything that is not a bare calendar date is treated as no bound at all,
    // which is the 'all' range the screen also offers.
    const rawFrom = String(req.query.from || '').trim();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(rawFrom) ? rawFrom : null;

    const createdBound = from ? ' AND l.created_at >= ?' : '';
    const touchedBound = from ? ' AND COALESCE(l.updated_at, l.created_at) >= ?' : '';
    const fromParam = from ? [from] : [];

    const byStaff = {};
    const entryFor = (id) => {
      const key = String(id || '');
      if (!key) return null;
      // byStatus rather than a field per status: two screens want different
      // slices of the same grouping — one needs lost and active, the other only
      // converted — and adding a column each time they differ is how a response
      // grows fields nobody reads.
      if (!byStaff[key]) byStaff[key] = { leads: 0, converted: 0, contacted: 0, byStatus: {} };
      return byStaff[key];
    };

    // leads and converted in one pass, grouped by status so both come from the
    // same population — the reason /stats groups this way too.
    const [createdRows] = await pool.query(
      `SELECT l.assigned_sales_id AS staff_id, l.status AS status, COUNT(*) AS cnt
         FROM leads l
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''${createdBound}
        GROUP BY l.assigned_sales_id, l.status`,
      [...base, ...fromParam],
    );
    for (const r of createdRows) {
      const entry = entryFor(r.staff_id);
      if (!entry) continue;
      const count = Number(r.cnt);
      const status = String(r.status || '').toLowerCase();
      entry.leads += count;
      if (status) entry.byStatus[status] = (entry.byStatus[status] || 0) + count;
      if (status === 'converted') entry.converted += count;
    }

    const [contactedRows] = await pool.query(
      `SELECT l.assigned_sales_id AS staff_id, COUNT(*) AS cnt
         FROM leads l
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
          AND l.status IN ('contacted','interested','interested_booking','converted')${touchedBound}
        GROUP BY l.assigned_sales_id`,
      [...base, ...fromParam],
    );
    for (const r of contactedRows) {
      const entry = entryFor(r.staff_id);
      if (entry) entry.contacted = Number(r.cnt);
    }

    res.json({ from, byStaff });
  } catch (e) { logger.error('[route]', e.message); sendRouteError(res, e); }
});

// GET /api/admin/leads/scored?minScore=&status=&source=&q=&sortBy=&limit=
//
// The lead-scoring screen renders filtered.slice(0, 50) — fifty rows — and was
// downloading all 26,878 leads to pick them, because the score it sorts by is
// computed per lead in the browser. LEAD_SCORE_SQL computes the same number in
// the database, so the sort, the filters and the histogram are all queries.
//
// Three things come back unfiltered on purpose: the distribution, the mean, and
// the source/status lists that populate the filter dropdowns. All three describe
// the whole table in the browser's version too — narrowing them to the current
// filter would make the histogram change shape every time someone moved the
// score slider, and would drop the options needed to undo a filter.
router.get('/api/admin/leads/scored', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) {
      return res.json({ rows: [], total: 0, distribution: { hot: 0, warm: 0, medium: 0, cold: 0 }, avgScore: 0, sources: [], statuses: [] });
    }
    const scopeClause = accessScope.sql;
    const base = [req.tenantId, ...accessScope.params];

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const minScore = Math.min(Math.max(parseInt(req.query.minScore, 10) || 0, 0), 100);
    const status = String(req.query.status || '').trim();
    const source = String(req.query.source || '').trim();
    const q = String(req.query.q || '').trim();
    const sortBy = req.query.sortBy === 'date' ? 'date' : 'score';

    // The communications rollup the score needs, joined once.
    const commJoin = `
       LEFT JOIN (
         SELECT lead_id, COUNT(*) AS comm_count, MAX(date) AS last_comm
           FROM communications WHERE tenant_id = ? AND lead_id IS NOT NULL
          GROUP BY lead_id
       ) lc ON lc.lead_id = l.id`;

    let filterClause = '';
    const filterParams = [];
    if (status && status !== 'all') { filterClause += ' AND l.status = ?'; filterParams.push(status); }
    if (source && source !== 'all') {
      // The browser compares (source || '').toLowerCase() against the dropdown
      // value; the column collates case-insensitively, so a direct comparison is
      // the same test without putting LOWER() around an indexed column.
      filterClause += ' AND l.source = ?';
      filterParams.push(source);
    }
    if (q) {
      filterClause += ' AND (l.name LIKE ? OR l.phone LIKE ?)';
      filterParams.push(`%${q}%`, `%${q}%`);
    }

    // HAVING, not WHERE: lead_score is computed in the select list, and MariaDB
    // cannot see a select alias in WHERE.
    const [rows] = await pool.query(
      `SELECT l.id, l.client_code, l.name, l.email, l.phone, l.source, l.status, l.lead_type, l.branch,
              l.interest_level, l.interested_course_ids_json, l.enrolled_course_id, l.deal_value,
              l.assigned_sales_id, COALESCE(ss.name, l.assigned_sales_name) AS assigned_sales_name,
              l.assigned_cs_id, COALESCE(cs.name, l.assigned_cs_name) AS assigned_cs_name,
              l.notes, l.last_follow_up, l.next_follow_up_date, l.crm_json, l.hidden, l.score,
              l.created_at, l.updated_at,
              COALESCE(lc.comm_count, 0) AS communication_count,
              ${LEAD_SCORE_SQL} AS lead_score
         FROM leads l
         LEFT JOIN staff ss ON ss.id = l.assigned_sales_id AND ss.tenant_id = l.tenant_id
         LEFT JOIN staff cs ON cs.id = l.assigned_cs_id AND cs.tenant_id = l.tenant_id
         ${commJoin}
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}${filterClause}
       HAVING lead_score >= ?
        ORDER BY ${sortBy === 'date' ? 'l.created_at DESC, l.id DESC' : 'lead_score DESC, l.id ASC'}
        LIMIT ?`,
      [req.tenantId, ...base, ...filterParams, minScore, limit],
    );

    // How many match the filter in total, so the screen can say "showing 50 of N"
    // rather than implying the fifty rows are everything.
    const [[totalRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM (
         SELECT ${LEAD_SCORE_SQL} AS lead_score
           FROM leads l ${commJoin}
          WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}${filterClause}
         HAVING lead_score >= ?
       ) x`,
      [req.tenantId, ...base, ...filterParams, minScore],
    );

    // Histogram and mean over the whole scoped table, matching the browser.
    const [[distRow]] = await pool.query(
      `SELECT
         COALESCE(SUM(lead_score >= 80), 0) AS hot,
         COALESCE(SUM(lead_score >= 60 AND lead_score < 80), 0) AS warm,
         COALESCE(SUM(lead_score >= 40 AND lead_score < 60), 0) AS medium,
         COALESCE(SUM(lead_score < 40), 0) AS cold,
         COALESCE(AVG(lead_score), 0) AS avg_score
       FROM (
         SELECT ${LEAD_SCORE_SQL} AS lead_score
           FROM leads l ${commJoin}
          WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
       ) x`,
      [req.tenantId, ...base],
    );

    const [facetRows] = await pool.query(
      `SELECT DISTINCT COALESCE(NULLIF(l.source, ''), '') AS source, l.status AS status
         FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}`,
      base,
    );
    const sources = [...new Set(facetRows.map(r => String(r.source || '').toLowerCase()).filter(Boolean))].sort();
    const statuses = [...new Set(facetRows.map(r => String(r.status || '').toLowerCase()).filter(Boolean))].sort();

    const communicationsByLead = new Map();
    const mapped = rows.map(r => ({
      ...mapLeadRow(r, communicationsByLead),
      score: Number(r.lead_score),
    }));

    res.json({
      rows: mapped,
      total: Number(totalRow?.cnt || 0),
      distribution: {
        hot: Number(distRow?.hot || 0),
        warm: Number(distRow?.warm || 0),
        medium: Number(distRow?.medium || 0),
        cold: Number(distRow?.cold || 0),
      },
      avgScore: Math.round(Number(distRow?.avg_score || 0)),
      sources,
      statuses,
    });
  } catch (e) { logger.error('[route]', e.message); sendRouteError(res, e); }
});

// GET /api/admin/leads/crm-insights?idleDays=N
//
// The three CRM workspace panels — reminders, the weekly scorecard, and the
// redistribution suggestions — each used to read the entire leads array. That is
// why opening the CRM downloaded all 26,887 rows: not to list them (the table has
// been paginated since), but so three hooks could filter them in the browser.
//
// Every one of those filters is a query. The reminders panel is the clearest
// case: 14 leads on this database carry a follow-up date at all, and the panel
// shows the 2 inside its window — 26,887 rows fetched to render two.
//
// Same role scoping as the list and stats routes, so a SALES rep's insights
// cover their own leads and nothing else.
router.get('/api/admin/leads/crm-insights', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) {
      return res.json({ reminders: [], scorecard: [], redistCandidates: [], idleDays: 0 });
    }
    const scopeClause = accessScope.sql;
    const scopeParams = accessScope.params;

    // Clamped rather than trusted: this value goes into a comparison, and an
    // absurd one would either return the whole table or nothing at all.
    const idleDays = Math.min(Math.max(parseInt(req.query.idleDays, 10) || 14, 1), 3650);

    // Closed leads are excluded below in the same spellings the browser used, so
    // the two paths cannot disagree about what "open" means.
    const CLOSED = ['converted', 'lost', 'not_interested_hidden'];
    const REDIST_EXCLUDED = [...CLOSED, 'wrong_number'];
    const closedSql = CLOSED.map(() => '?').join(',');
    const redistSql = REDIST_EXCLUDED.map(() => '?').join(',');

    // ── 1. Reminders ────────────────────────────────────────────────────────
    // Whole rows, because the panel lists them by name and acts on them. Bounded
    // by the same window the browser applied: anything overdue, plus the next
    // seven days. LIMIT is a backstop, not a filter — a database holding more
    // than 500 open follow-ups was never going to render them all anyway.
    const [reminderRows] = await pool.query(
      `SELECT l.id, l.client_code, l.name, l.email, l.phone, l.source, l.status, l.lead_type, l.branch,
              l.interest_level, l.interested_course_ids_json, l.enrolled_course_id, l.deal_value,
              l.assigned_sales_id, COALESCE(ss.name, l.assigned_sales_name) AS assigned_sales_name,
              l.assigned_cs_id, COALESCE(cs.name, l.assigned_cs_name) AS assigned_cs_name,
              l.notes, l.last_follow_up, l.next_follow_up_date, l.crm_json, l.hidden, l.score,
              l.created_at, l.updated_at,
              (SELECT COUNT(*) FROM communications lc
                WHERE lc.tenant_id=l.tenant_id AND lc.lead_id=l.id) AS communication_count
         FROM leads l
         LEFT JOIN staff ss ON ss.id = l.assigned_sales_id AND ss.tenant_id = l.tenant_id
         LEFT JOIN staff cs ON cs.id = l.assigned_cs_id AND cs.tenant_id = l.tenant_id
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.next_follow_up_date IS NOT NULL
          AND l.status NOT IN (${closedSql})
          AND l.next_follow_up_date <= CURDATE() + INTERVAL 7 DAY
        ORDER BY l.next_follow_up_date ASC, l.id ASC
        LIMIT 500`,
      [req.tenantId, ...scopeParams, ...CLOSED],
    );

    const communicationsByLead = new Map();
    if (reminderRows.length) {
      const communications = await listLeadCommunications({
        tenantId: req.tenantId,
        leadIds: reminderRows.map(row => row.id),
      });
      for (const communication of communications) {
        const list = communicationsByLead.get(communication.lead_id) || [];
        list.push({
          id: communication.id,
          type: String(communication.type || 'note').toLowerCase(),
          date: communication.date,
          notes: communication.notes,
          outcome: communication.outcome,
          nextFollowUp: communication.next_follow_up,
          staffId: communication.staff_id,
        });
        communicationsByLead.set(communication.lead_id, list);
      }
    }
    const reminders = reminderRows.map(r => mapLeadRow(r, communicationsByLead));

    // completionRate counts leads whose follow-up date has already passed —
    // including closed ones the list above excludes, matching what the browser
    // counted — and whether a communication landed on or after that date. Only
    // the percentage is displayed, so only the two totals are computed.
    const [[dueRow]] = await pool.query(
      `SELECT COUNT(*) AS due,
              COALESCE(SUM(EXISTS (
                SELECT 1 FROM communications c
                 WHERE c.tenant_id = l.tenant_id AND c.lead_id = l.id
                   AND c.date >= l.next_follow_up_date
              )), 0) AS completed
         FROM leads l
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.next_follow_up_date IS NOT NULL
          AND l.next_follow_up_date <= CURDATE()`,
      [req.tenantId, ...scopeParams],
    );
    const totalDue = Number(dueRow?.due || 0);
    const completedDue = Number(dueRow?.completed || 0);

    // ── 2. Weekly scorecard ─────────────────────────────────────────────────
    // Four aggregates keyed by rep, merged into one row each. Deliberately four
    // queries and not one wide join: joining communications to leads multiplies
    // the lead rows by their communications, and every count after the first
    // would come back inflated.
    const scorecardById = new Map();
    const scoreEntry = (id) => {
      const key = String(id || '');
      if (!key) return null;
      if (!scorecardById.has(key)) {
        scorecardById.set(key, {
          staffId: key, calls: 0, wa: 0, meetings: 0, totalComms: 0,
          followupsDone: 0, newLeadsThisWeek: 0, overdueOwn: 0,
        });
      }
      return scorecardById.get(key);
    };

    const [weekCommRows] = await pool.query(
      `SELECT l.assigned_sales_id AS staff_id, c.type AS type, COUNT(*) AS cnt
         FROM communications c
         JOIN leads l ON l.id = c.lead_id AND l.tenant_id = c.tenant_id
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
          AND c.date >= CURDATE() - INTERVAL 7 DAY
        GROUP BY l.assigned_sales_id, c.type`,
      [req.tenantId, ...scopeParams],
    );
    for (const r of weekCommRows) {
      const entry = scoreEntry(r.staff_id);
      if (!entry) continue;
      const count = Number(r.cnt);
      const type = String(r.type || '').trim().toLowerCase();
      entry.totalComms += count;
      if (type === 'call') entry.calls += count;
      else if (type === 'whatsapp') entry.wa += count;
      else if (type === 'meeting') entry.meetings += count;
    }

    const [followupRows] = await pool.query(
      `SELECT l.assigned_sales_id AS staff_id, COUNT(*) AS cnt
         FROM leads l
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
          AND l.next_follow_up_date >= CURDATE() - INTERVAL 7 DAY
          AND l.next_follow_up_date <= CURDATE()
          AND EXISTS (
            SELECT 1 FROM communications c
             WHERE c.tenant_id = l.tenant_id AND c.lead_id = l.id
               AND c.date >= l.next_follow_up_date
          )
        GROUP BY l.assigned_sales_id`,
      [req.tenantId, ...scopeParams],
    );
    for (const r of followupRows) {
      const entry = scoreEntry(r.staff_id);
      if (entry) entry.followupsDone = Number(r.cnt);
    }

    // Bare column, no DATE() wrapper — same reason /stats uses a half-open
    // range: wrapping created_at puts idx_leads_tenant_status_created out of
    // reach and turns this into a full scan.
    const [newLeadRows] = await pool.query(
      `SELECT l.assigned_sales_id AS staff_id, COUNT(*) AS cnt
         FROM leads l
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
          AND l.created_at >= CURDATE() - INTERVAL 7 DAY
        GROUP BY l.assigned_sales_id`,
      [req.tenantId, ...scopeParams],
    );
    for (const r of newLeadRows) {
      const entry = scoreEntry(r.staff_id);
      if (entry) entry.newLeadsThisWeek = Number(r.cnt);
    }

    // overdueOwn excludes converted and lost only — not not_interested_hidden.
    // That is what the browser counted, and quietly widening it here would move
    // a number the user reads without anyone having decided to.
    const [overdueRows] = await pool.query(
      `SELECT l.assigned_sales_id AS staff_id, COUNT(*) AS cnt
         FROM leads l
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
          AND l.next_follow_up_date IS NOT NULL
          AND l.next_follow_up_date < CURDATE()
          AND l.status NOT IN ('converted','lost')
        GROUP BY l.assigned_sales_id`,
      [req.tenantId, ...scopeParams],
    );
    for (const r of overdueRows) {
      const entry = scoreEntry(r.staff_id);
      if (entry) entry.overdueOwn = Number(r.cnt);
    }

    // ── 3. Redistribution candidates ────────────────────────────────────────
    // "Silent" is measured from the most recent communication, falling back to
    // creation for a lead never contacted — the browser's rule, written as a
    // COALESCE over a correlated MAX.
    //
    // DATE(last_activity), not the bare timestamp: the browser floors the last
    // activity to its calendar day before subtracting, so a lead last touched at
    // 09:00 seven days ago counts as seven days silent there. Comparing the raw
    // DATETIME excluded thirteen leads on production that the panel had always
    // listed.
    //
    // Only the 50 quietest come back because only 50 are ever shown, and the
    // per-rep open load the panel needs to suggest a new owner is the aggregate
    // below rather than a count over the array.
    // The full column set, not a slim projection: the panel's "تحويل" button
    // saves with updateLead({ ...lead, assignedSalesId }), which PUTs the whole
    // lead back. A partial object there would blank every field it omitted, and
    // the "عرض" link needs client_code to resolve. Fifty rows is cheap; losing a
    // lead's notes to a reassignment is not.
    const [idleRows] = await pool.query(
      `SELECT l.id, l.client_code, l.name, l.email, l.phone, l.source, l.status, l.lead_type, l.branch,
              l.interest_level, l.interested_course_ids_json, l.enrolled_course_id, l.deal_value,
              l.assigned_sales_id, COALESCE(ss.name, l.assigned_sales_name) AS assigned_sales_name,
              l.assigned_cs_id, COALESCE(cs.name, l.assigned_cs_name) AS assigned_cs_name,
              l.notes, l.last_follow_up, l.next_follow_up_date, l.crm_json, l.hidden, l.score,
              l.created_at, l.updated_at,
              (SELECT COUNT(*) FROM communications lc
                WHERE lc.tenant_id=l.tenant_id AND lc.lead_id=l.id) AS communication_count,
              COALESCE(
                (SELECT MAX(c.date) FROM communications c
                  WHERE c.tenant_id = l.tenant_id AND c.lead_id = l.id),
                l.created_at
              ) AS last_activity
         FROM leads l
         LEFT JOIN staff ss ON ss.id = l.assigned_sales_id AND ss.tenant_id = l.tenant_id
         LEFT JOIN staff cs ON cs.id = l.assigned_cs_id AND cs.tenant_id = l.tenant_id
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
          AND l.status NOT IN (${redistSql})
       HAVING DATE(last_activity) <= CURDATE() - INTERVAL ? DAY
        ORDER BY last_activity ASC, l.id ASC
        LIMIT 50`,
      [req.tenantId, ...scopeParams, ...REDIST_EXCLUDED, idleDays],
    );

    const [loadRows] = await pool.query(
      `SELECT l.assigned_sales_id AS staff_id, COUNT(*) AS cnt
         FROM leads l
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
          AND l.status NOT IN (${closedSql})
        GROUP BY l.assigned_sales_id`,
      [req.tenantId, ...scopeParams, ...CLOSED],
    );
    const openLoadByRep = {};
    for (const r of loadRows) openLoadByRep[String(r.staff_id)] = Number(r.cnt);

    const idleCommsByLead = new Map();
    if (idleRows.length) {
      const idleComms = await listLeadCommunications({
        tenantId: req.tenantId,
        leadIds: idleRows.map(row => row.id),
      });
      for (const communication of idleComms) {
        const list = idleCommsByLead.get(communication.lead_id) || [];
        list.push({
          id: communication.id,
          type: String(communication.type || 'note').toLowerCase(),
          date: communication.date,
          notes: communication.notes,
          outcome: communication.outcome,
          nextFollowUp: communication.next_follow_up,
          staffId: communication.staff_id,
        });
        idleCommsByLead.set(communication.lead_id, list);
      }
    }

    const nowMs = Date.now();
    const redistCandidates = idleRows.map(r => {
      // ymd(), not String().slice(): last_activity is a COALESCE over two
      // DATETIME columns, so it arrives as a Date and slicing it would produce
      // "Wed Aug 05" — which then parses back as Invalid Date and makes every
      // daysSilent NaN.
      const lastDate = ymd(r.last_activity);
      return {
        lead: mapLeadRow(r, idleCommsByLead),
        lastDate,
        daysSilent: lastDate
          ? Math.floor((nowMs - new Date(lastDate).getTime()) / 86400000)
          : 999,
      };
    });

    res.json({
      idleDays,
      reminders,
      remindersCompletionRate: totalDue > 0 ? Math.round((completedDue / totalDue) * 100) : 0,
      scorecard: [...scorecardById.values()],
      redistCandidates,
      openLoadByRep,
    });
  } catch (e) { logger.error('[route]', e.message); sendRouteError(res, e); }
});

// GET /api/admin/leads/stats — server-side pipeline/KPI aggregates so the CRM
// never has to pull the whole leads table into the browser just to show counts.
// Same role scoping as the list below. Stays fast at 500k+: one GROUP BY that
// rides idx_leads_tenant_status_created instead of loading every row.
router.get('/api/admin/leads/stats', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    // tenant_id kept inline in the query string (not folded into a variable) so
    // the static tenant-scope guard can see this table is properly scoped.
    let scopeClause = '';
    const params = [req.tenantId];
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) {
      return res.json({
        total: 0, byStatus: {}, assigned: 0, unassigned: 0, totalDealValue: 0,
        byOwner: {}, createdToday: 0,
      });
    }
    scopeClause = accessScope.sql;
    params.push(...accessScope.params);
    const [rows] = await pool.query(
      `SELECT l.status AS status, COUNT(*) AS cnt,
              SUM(CASE WHEN l.assigned_sales_id IS NULL OR l.assigned_sales_id = '' THEN 1 ELSE 0 END) AS unassigned_cnt,
              SUM(COALESCE(l.deal_value, 0)) AS deal_sum
       FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause} GROUP BY l.status`,
      params,
    );
    const byStatus = {};
    let total = 0, unassigned = 0, totalDealValue = 0;
    for (const r of rows) {
      const st = (r.status || 'new').toLowerCase();
      byStatus[st] = (byStatus[st] || 0) + Number(r.cnt);
      total += Number(r.cnt);
      unassigned += Number(r.unassigned_cnt);
      totalDealValue += Number(r.deal_sum || 0);
    }

    // Per-rep and today's intake. The dashboard's "leads per sales rep" tiles and
    // its "new leads today" figure were the last two things counting the whole
    // leads array in the browser, and they are the reason the array had to be
    // there at all. Two more GROUP BYs over the same scoped set is cheaper than
    // shipping 26k rows to compute them client-side.
    //
    // Same WHERE as above, so every figure in this response describes one
    // population — a caller can subtract them from each other and be right.
    // Grouped by owner AND status, not owner alone: the dashboard shows each
    // rep's conversion rate, so a total without its converted count would leave
    // the numerator on the array and the denominator here — and once the array
    // stops holding every row that rate goes above 100%.
    //
    // score_sum rather than AVG(): the caller wants one average per rep, but the
    // rows arrive split by status, so an average of averages would weight a rep's
    // four converted leads the same as their four hundred new ones. Summing and
    // dividing by the same total at the end gives the real mean.
    //
    // The formula is recomputed here rather than read from leads.score, which
    // would have been far cheaper and silently wrong twice over. On production
    // 13,298 rows carry a score and 15,974 carry zero — every Google-Sheet import
    // was written without ever being scored — so all six reps' leads average 0 in
    // the column against 20 by the formula. And even a fully backfilled column
    // would drift, because the last term below decays with time and the column
    // only changes when the lead is written.
    const [ownerRows] = await pool.query(
      `SELECT COALESCE(NULLIF(l.assigned_sales_id, ''), '') AS owner_id,
              l.status AS status, COUNT(*) AS cnt,
              COALESCE(SUM(${LEAD_SCORE_SQL}), 0) AS score_sum
       FROM leads l
       LEFT JOIN (
         SELECT lead_id, COUNT(*) AS comm_count, MAX(date) AS last_comm
           FROM communications WHERE tenant_id = ? AND lead_id IS NOT NULL
          GROUP BY lead_id
       ) lc ON lc.lead_id = l.id
       WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
       GROUP BY COALESCE(NULLIF(l.assigned_sales_id, ''), ''), l.status`,
      [req.tenantId, ...params],
    );
    const byOwner = {};
    for (const r of ownerRows) {
      // '' is the unassigned bucket, already reported as `unassigned`; keeping it
      // out of byOwner stops a caller summing the map and double-counting.
      if (!r.owner_id) continue;
      const id = String(r.owner_id);
      const entry = byOwner[id] || (byOwner[id] = { total: 0, converted: 0, scoreSum: 0, comms: {} });
      const count = Number(r.cnt);
      entry.total += count;
      entry.scoreSum += Number(r.score_sum) || 0;
      if (String(r.status || '').toLowerCase() === 'converted') entry.converted += count;
    }

    // Communication counts per rep per channel, for the same reason the statuses
    // are grouped above: the performance screen charts calls/WhatsApp/meetings
    // side by side, and counting them in the browser is what forces every lead's
    // communications array to be downloaded.
    //
    // Joined through leads so the tenant scope and the hidden filter apply here
    // too — communications carries a tenant_id, but not the lead's hidden flag.
    const [commRows] = await pool.query(
      `SELECT COALESCE(NULLIF(l.assigned_sales_id, ''), '') AS owner_id,
              c.type AS type, COUNT(*) AS cnt
       FROM communications c
       JOIN leads l ON l.id = c.lead_id AND l.tenant_id = c.tenant_id
       WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
       GROUP BY COALESCE(NULLIF(l.assigned_sales_id, ''), ''), c.type`,
      params,
    );
    for (const r of commRows) {
      if (!r.owner_id) continue;
      const id = String(r.owner_id);
      // A rep can have communications on leads that are all converted away or
      // reassigned, so this map is not guaranteed to have an entry yet.
      const entry = byOwner[id] || (byOwner[id] = { total: 0, converted: 0, scoreSum: 0, comms: {} });
      const type = String(r.type || '').trim().toLowerCase();
      if (!type) continue;
      entry.comms[type] = (entry.comms[type] || 0) + Number(r.cnt);
    }

    // avgScore is derived here, once, so no caller has to remember that scoreSum
    // is a sum and not already a mean.
    for (const entry of Object.values(byOwner)) {
      entry.avgScore = entry.total > 0 ? Math.round(entry.scoreSum / entry.total) : 0;
      delete entry.scoreSum;
    }

    // The two whole-table figures the performance screen still counted in the
    // browser: the mean score across every visible lead, and the total number of
    // communications logged against them.
    const [[globalRow]] = await pool.query(
      `SELECT COALESCE(AVG(${LEAD_SCORE_SQL}), 0) AS avg_score,
              COALESCE(SUM(COALESCE(lc.comm_count, 0)), 0) AS total_comms
         FROM leads l
         LEFT JOIN (
           SELECT lead_id, COUNT(*) AS comm_count, MAX(date) AS last_comm
             FROM communications WHERE tenant_id = ? AND lead_id IS NOT NULL
            GROUP BY lead_id
         ) lc ON lc.lead_id = l.id
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}`,
      [req.tenantId, ...params],
    );

    // Lead source breakdown, for the analytics pie. Counting this in the browser
    // is one of the last three reasons the CRM wanted every row.
    const [sourceRows] = await pool.query(
      `SELECT COALESCE(NULLIF(l.source, ''), '') AS source, COUNT(*) AS cnt
       FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
       GROUP BY COALESCE(NULLIF(l.source, ''), '')`,
      params,
    );
    const bySource = {};
    for (const r of sourceRows) bySource[String(r.source || '')] = Number(r.cnt);

    // Six months of new-vs-converted, keyed 'YYYY-MM'.
    //
    // DATE_FORMAT on created_at is not sargable, but the range test beside it is,
    // so the index still selects the six months and the formatting only runs on
    // what survives. Without the range this would format all 26,878 rows.
    const [trendRows] = await pool.query(
      `SELECT DATE_FORMAT(l.created_at, '%Y-%m') AS ym,
              COUNT(*) AS cnt,
              SUM(l.status = 'converted') AS converted
       FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
         AND l.created_at >= DATE_FORMAT(CURDATE() - INTERVAL 5 MONTH, '%Y-%m-01')
       GROUP BY DATE_FORMAT(l.created_at, '%Y-%m')`,
      params,
    );
    const byMonth = {};
    for (const r of trendRows) {
      byMonth[String(r.ym)] = { total: Number(r.cnt), converted: Number(r.converted || 0) };
    }

    // A half-open range on the bare column, not DATE(created_at) = CURDATE().
    //
    // Comparing a string prefix would depend on how the driver rendered the
    // DATETIME — the bug behind the Dokki dates — but wrapping the column in
    // DATE() is no better: it makes the term unsargable, so
    // idx_leads_tenant_status_created cannot be used and counting today's leads
    // means scanning all 26,878 rows. >= midnight AND < tomorrow is exactly the
    // same set and reads the index.
    const [[todayRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM leads l
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.created_at >= CURDATE() AND l.created_at < CURDATE() + INTERVAL 1 DAY`,
      params,
    );

    res.json({
      total, byStatus, assigned: total - unassigned, unassigned, totalDealValue,
      byOwner, bySource, byMonth,
      avgScore: Math.round(Number(globalRow?.avg_score || 0)),
      totalCommunications: Number(globalRow?.total_comms || 0),
      createdToday: Number(todayRow?.cnt || 0),
    });
  } catch (e) { logger.error('[leads-stats]', e.message); sendRouteError(res, e); }
});

router.get('/api/admin/leads', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
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
      l.notes, l.last_follow_up, l.next_follow_up_date, l.crm_json, l.hidden, l.score, l.created_at, l.updated_at,
      (SELECT COUNT(*) FROM communications lc
        WHERE lc.tenant_id=l.tenant_id AND lc.lead_id=l.id) AS communication_count
      FROM leads l
      LEFT JOIN staff ss ON ss.id = l.assigned_sales_id AND ss.tenant_id = l.tenant_id
      LEFT JOIN staff cs ON cs.id = l.assigned_cs_id AND cs.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND l.hidden = 0`;
    const params = [req.tenantId];
    // Was only scoping SALES/COLLECTION — every other role (RECEPTION_DAQQI, HR,
    // SUPPORT, CONSULTANT, TRAINER, INSTRUCTOR, and DAQQI_MANAGER despite this file's
    // own comment claiming otherwise) fell through to "no additional filter" = every
    // branch's leads. Route through the same DATA_SCOPE table the sibling
    // /api/staff/subscribers already uses, so RECEPTION_DAQQI/DAQQI_MANAGER only see
    // DAQQI-branch leads like they're supposed to.
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) return res.json([]);
    sql += accessScope.sql;
    params.push(...accessScope.params);

    // Optional server-side search/filter — additive, backward-compatible: callers that
    // don't pass q/status get identical results to before.
    const q = (req.query.q || '').trim();
    if (q) {
      // Route by the shape of what was typed. A leading-wildcard LIKE can never
      // use an index, so searching all four columns with '%q%' meant a full scan
      // of leads on every keystroke-driven search — the single most expensive
      // query in the CRM as the table grows.
      //
      // A client code and a complete email address are identifiers: people type
      // them in full, so an equality match returns the same row while riding
      // idx_leads_client_code / idx_leads_email. Only genuinely open-ended text
      // (a partial name, part of a phone number) still needs the scan.
      // Full substring search across every field at scale needs a real search
      // engine — MariaDB has no ngram FULLTEXT parser, so it can't serve it.
      if (/^C\d+$/i.test(q)) {
        sql += ' AND l.client_code = ?';
        params.push(q.toUpperCase());
      } else if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q)) {
        sql += ' AND l.email = ?';
        params.push(q);
      } else {
        sql += ' AND (l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ? OR l.client_code LIKE ?)';
        const like = `%${q}%`;
        params.push(like, like, like, like);
      }
    }
    const statusFilter = (req.query.status || '').trim().toLowerCase();
    if (statusFilter && statusFilter !== 'all') {
      // leads.status uses the default utf8mb4 case-insensitive collation (like every
      // other varchar column in this schema), so wrapping the column in LOWER() was
      // redundant — and it defeated idx_leads_status, forcing a full scan on every
      // status-filtered list request (PERF-08). A plain equality comparison matches
      // the same rows and lets the existing index be used.
      sql += ' AND l.status = ?';
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
    const communicationsByLead = new Map();
    if (rows.length) {
      const communications = await listLeadCommunications({
        tenantId: req.tenantId,
        leadIds: rows.map(row => row.id),
      });
      for (const communication of communications) {
        const list = communicationsByLead.get(communication.lead_id) || [];
        list.push({
          id: communication.id,
          type: String(communication.type || 'note').toLowerCase(),
          date: communication.date,
          notes: communication.notes,
          outcome: communication.outcome,
          nextFollowUp: communication.next_follow_up,
          staffId: communication.staff_id,
        });
        communicationsByLead.set(communication.lead_id, list);
      }
    }
    res.json(rows.map(r => mapLeadRow(r, communicationsByLead)));
  } catch (e) { logger.error('[route]', e.message); sendRouteError(res, e); }
});

// GET /api/admin/payments?startDate=&endDate=&channel=&paymentType=

// GET /api/admin/expenses



// 404 for unknown /api routes

module.exports = router;
