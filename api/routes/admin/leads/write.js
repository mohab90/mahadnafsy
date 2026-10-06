'use strict';
// Adding, editing and deleting a lead.
// One part of routes/admin/leads.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  uuidv4,
  pool,
  tryJson,
  sanitize,
  calcLeadScoreServer,
  sendRouteError,
  getNextClientCode,
  createNotification,
  logLeadEventStrict,
  normalizeLeadStatus,
  transitionLead,
  getNextSalesRep,
  appendLeadInteraction,
  leadScope,
  branchesFromScope,
  BRANCH_DESK_ROLES,
  archiveLead,
  findLeadById,
  findLeadByIdentity,
  requireAuth,
  requireAdmin,
  requireAdminOrStaff,
  requirePermission,
  VALID_BRANCHES,
  cairoToday,
  addDaysToDateOnly,
  branchIdForBranch,
  logger,
  crypto,
} = require('./_shared');

const router = Router();

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
    } else if (writeScope.none || (writeScope.scope === 'assigned_cs' && staffRole !== 'collection')) {
      // A collection officer adds leads of their own — «خلي في امكانيه انه
      // يضيف عميل محتمل جديد» — and each one is theirs (below), so it is inside
      // their scope the moment it exists.
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
    // leads.source is NOT NULL: a lead added without one stood as «حقل مطلوب فاضي»
    // with no word on which field.
    const safeSource = sanitize(source, 200) || 'غير محدد';
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
    // A changed number is checked too. Only a NEW lead was, so editing a phone to
    // one another lead holds ran into the unique key and answered with a generic
    // «فيه سجل بنفس البيانات» that did not say whose number it was.
    if (!isNew && safePhone && String(existing.phone || '') !== safePhone) {
      const holder = await findLeadByIdentity({
        tenantId, phone: safePhone, excludeId: id, db: conn, forUpdate: true,
      });
      if (holder) {
        await conn.rollback();
        return res.status(409).json({
          error: `رقم الهاتف ${safePhone} مسجل بالفعل لليد ${holder.name || ''}`,
          existingId: holder.id,
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
    // The collection officer a lead was handed to. The distribution screen sent
    // it as assignedCollectionId and this route kept it in crm_json only, so the
    // officer's scope — which reads the column — never saw a lead handed to them.
    let csId   = crmData.assignedCsId   || crmData.assignedCollectionId   || null;
    let csName = crmData.assignedCsName || crmData.assignedCollectionName || null;
    const clearCs = ['assignedCsId', 'assignedCollectionId']
      .some(key => Object.prototype.hasOwnProperty.call(crmData, key) && !crmData[key]);
    delete crmData.assignedCsId; delete crmData.assignedCsName;
    delete crmData.assignedCollectionId; delete crmData.assignedCollectionName;
    if (staffRole === 'collection') {
      // Their own lead, not a sales rep's: a collection officer's lead is never
      // auto-assigned to sales, and editing one cannot hand it to anybody else.
      if (isNew) { csId = req.staffRecord.id; csName = req.staffRecord.name || null; }
      else { csId = null; csName = null; }
      salesId = null; salesName = null;
      delete crmData.assignedSalesId; delete crmData.assignedSalesName;
    } else if (staffRole === 'sales') {
      salesId = req.staffRecord.id;
      salesName = req.staffRecord.name || salesName;
      crmData.assignedSalesId = salesId;
      crmData.assignedSalesName = salesName;
    } else if (isNew && !salesId && !csId && BRANCH_DESK_ROLES.includes(staffRole)) {
      // A branch desk (Dokki's, Tagamoa's) sees the leads handed to its team (lib/leadAccess.js);
      // one it adds went to the next sales rep and left its screen at once.
      salesId = req.staffRecord.id;
      salesName = req.staffRecord.name || null;
      crmData.assignedSalesId = salesId;
      crmData.assignedSalesName = salesName;
    } else if (isNew && !salesId && !csId && !skipAutoAssign) {
      const rep = await getNextSalesRep(req.tenantId, conn, {
        branch: branchVal,
        lead: { source, courseIds: Array.isArray(crmData.interestedCourseIds) ? crmData.interestedCourseIds : [] },
      });
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
           assigned_sales_id, assigned_sales_name, assigned_cs_id, assigned_cs_name, crm_json, branch, branch_id, client_type, interested_course_ids_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
         [id, tenantId, code, safeName||'', safeEmail||'', safePhone||null, safeSource||null, normalizedRequestedStatus,
         safeNotes||null, hidden||0, salesId, salesName, csId, csName, JSON.stringify(crmToStore), branchVal, branchId, leadClientTypeVal, courseIdsJson]
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
           assigned_cs_id=IF(?,NULL,COALESCE(?,assigned_cs_id)),
           assigned_cs_name=IF(?,NULL,COALESCE(?,assigned_cs_name)),
           crm_json=?, branch=COALESCE(NULLIF(?,''),branch), branch_id=COALESCE(?,branch_id), client_type=COALESCE(?,client_type),
           interested_course_ids_json=COALESCE(?,interested_course_ids_json), hidden=COALESCE(?,hidden)
         WHERE id=? AND tenant_id=?`,
        [safeName||'', safeEmail||null, safePhone, safeSource||null, safeNotes||null, code,
         clearSales ? 1 : 0, salesId, clearSales ? 1 : 0, salesName,
         clearCs && staffRole !== 'collection' ? 1 : 0, csId, clearCs && staffRole !== 'collection' ? 1 : 0, csName,
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
        const followUpDate = addDaysToDateOnly(cairoToday(), 2);
        await conn.query('UPDATE leads SET next_follow_up_date=? WHERE id=? AND tenant_id=? AND next_follow_up_date IS NULL', [followUpDate, id, tenantId]);
        await logLeadEventStrict(id, 'followup_set', `موعد متابعة تلقائي: ${followUpDate}`, { date: followUpDate, auto: true }, tenantId, conn);
      }
      // To the rep who has it, or to management while nobody does — one line
      // per burst, not one row per lead for the whole of sales.
      const leadLine = `${safeName || 'مجهول'} — ${safeSource || 'بدون مصدر'}`;
      postCommitNotifications.push(() => (salesId
        ? createNotification('lead', '📋 ليدز جديدة ليك', leadLine,
          { leadId: id, lastName: safeName }, tenantId, salesId,
          { coalesceMinutes: 30, summarize: (count, data) => `اتضاف ليك ${count} ليد جديد — آخرهم ${data.lastName || 'ليد'}` })
        : createNotification('lead', '📋 ليدز جديدة مستنية توزيع', leadLine,
          { leadId: id, lastName: safeName }, tenantId, null,
          { coalesceMinutes: 30, summarize: (count, data) => `${count} ليد جديد مستني توزيع — آخرهم ${data.lastName || 'ليد'}` })));
      // Welcome the lead automatically, same journey step the public capture
      // forms and website registration use — a lead added by staff was the one
      // door that produced no welcome at all. Queued through the outbox (retry +
      // dedupe on the lead id), and only after commit so a rolled-back insert
      // can never send a message about a lead that doesn't exist.
      if (safePhone || safeEmail) {
        postCommitNotifications.push(() => require('../../../lib/lifecycle').trigger('lead_created', {
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
      // Against the column, which every assignment path keeps current — not the
      // creation-time copy in crm_json, which lags it (the same stale mirror the
      // lists stopped reading). Comparing with the copy missed a reassignment to
      // whoever the copy happened to name, and announced one that had not moved.
      const previousSalesId = existing?.assigned_sales_id || null;
      if (crmData.assignedSalesId && String(crmData.assignedSalesId) !== String(previousSalesId || '')) {
        await logLeadEventStrict(id, 'assigned', `تعيين لـ: ${crmData.assignedSalesName || crmData.assignedSalesId}`, { salesId: crmData.assignedSalesId, salesName: crmData.assignedSalesName }, tenantId, conn);
        // To the rep it was handed to. It went to every sales account,
        // naming whoever got it — 1,182 of these in one week.
        postCommitNotifications.push(() => createNotification('lead', '👤 ليدز اتعينت ليك',
          safeName || 'ليد', { leadId: id, lastName: safeName }, tenantId, crmData.assignedSalesId,
          { coalesceMinutes: 30, summarize: (count, data) => `اتعين ليك ${count} ليد — آخرهم ${data.lastName || 'ليد'}` }));
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

// POST /api/admin/leads/:id/visibility { hidden } — hide a lead, or show it again.
//
// The eye on the table sent the whole row back through POST /api/admin/leads
// with one field flipped, and a rep got «فشل حفظ البيانات. تحقق من الاتصال
// بالإنترنت» whenever any other field of that row no longer passed — 14 times
// on 6 Oct, all «Lead not found» for a row the rep's screen still held after it
// had been handed to someone else. This changes the one column and says why
// when it cannot. A hidden lead leaves the rep's list and waits in «محلي جديد»
// (lib/leadPoolFilter.js) for the desk to hand out again.
router.post('/api/admin/leads/:id/visibility', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  const hidden = req.body?.hidden === true;
  if (typeof req.body?.hidden !== 'boolean') return res.status(400).json({ error: 'hidden must be true or false' });
  const scope = leadScope(req, 'l');
  if (scope.none) return res.status(403).json({ error: 'Lead is outside your data scope' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[lead]] = await conn.query(
      `SELECT l.id, l.hidden FROM leads l
        WHERE l.tenant_id=? AND l.id=? AND l.deleted_at IS NULL AND l.merged_into_lead_id IS NULL${scope.sql}
        LIMIT 1 FOR UPDATE`,
      [req.tenantId, req.params.id, ...scope.params]);
    if (!lead) {
      await conn.rollback();
      const [[elsewhere]] = await pool.query('SELECT id FROM leads WHERE tenant_id=? AND id=? LIMIT 1', [req.tenantId, req.params.id]);
      return res.status(404).json({
        error: elsewhere ? 'العميل ده مبقاش معاك — اتنقل لحد تاني. حدّث الصفحة.' : 'العميل ده مش موجود',
        code: elsewhere ? 'LEAD_MOVED' : 'LEAD_NOT_FOUND',
      });
    }
    if (Boolean(lead.hidden) !== hidden) {
      await conn.query('UPDATE leads SET hidden=?, updated_at=NOW() WHERE tenant_id=? AND id=?', [hidden ? 1 : 0, req.tenantId, lead.id]);
      await logLeadEventStrict(lead.id, hidden ? 'hidden' : 'restored',
        hidden ? 'اتخفى — رجع لمحلي جديد' : 'ظهر تاني',
        { actor: req.user?.email || null, staffId: req.staffRecord?.id || null, staffName: req.staffRecord?.name || null },
        req.tenantId, conn);
    }
    await conn.commit();
    res.json({ ok: true, id: lead.id, hidden });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[lead-visibility]', e.message);
    sendRouteError(res, e);
  } finally { conn.release(); }
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

module.exports = router;
