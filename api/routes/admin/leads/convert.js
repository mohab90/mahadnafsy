'use strict';
// A lead's timeline, and turning a lead into a customer.
// One part of routes/admin/leads.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  uuidv4,
  generateTemporaryPassword,
  pool,
  pickCollectionOfficer,
  subscriberMarket,
  mailer,
  sendWhatsApp,
  tryJson,
  sanitize,
  sendRouteError,
  getNextClientCode,
  createNotification,
  logLeadEvent,
  transitionLead,
  leadScope,
  claimWhatsAppIdentity,
  findAccountByPhone,
  enqueueEmailSequence,
  ADMIN_EMAILS,
  requireAuth,
  requireAdminOrStaff,
  requirePermission,
  VALID_BRANCHES,
  branchIdForBranch,
  staffOwnsEmail,
  STAFF_EMAIL_REFUSAL,
  logger,
  bcrypt,
} = require('./_shared');

const router = Router();

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
    // Within the caller's own leads, whatever the role — this checked a sales
    // rep's ownership and nobody else's, so any other role holding manage_leads
    // could turn any lead in the institute into a customer.
    const convertScope = leadScope(req, 'l');
    const [[inScope]] = convertScope.none ? [[null]] : await conn.query(
      `SELECT l.id FROM leads l WHERE l.tenant_id=? AND l.id=?${convertScope.sql} LIMIT 1`,
      [tenantId, leadId, ...convertScope.params]);
    if (!inScope) {
      await conn.rollback(); transactionStarted = false;
      return res.status(403).json({ error: 'غير مصرح: يمكنك فقط تحويل الليدز المعيّنة لك' });
    }
    // A collection officer's new customer is not added until the manager has
    // seen the money: «لا يضاف حتي يراجع تحويله ومدفوعاته من حساب المسئول».
    // That is a booking, which goes to review — not this free conversion.
    if (String(req.staffRecord?.role || '').toLowerCase() === 'collection') {
      await conn.rollback(); transactionStarted = false;
      return res.status(403).json({
        error: 'العميل الجديد من حساب التحصيل بيتسجل بحجز ودفعة، والمسئول بيراجع التحويل ويعتمده — استخدم «حجز / دفعة».',
        code: 'COLLECTION_BOOKING_REQUIRED',
      });
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

    // Deleted customers must not match here. Reusing one would point the
    // converted lead at a customer record the app treats as gone: the
    // conversion reports success and the customer never appears. This is the
    // same "does this lead already have a customer" question the reconcile
    // checks ask, and they exclude deleted rows too.
    //
    // The empty-string defaults below are why the blank arms matter: a lead
    // with no email would otherwise match any subscriber whose email is blank.
    const [[existingSub]] = await conn.query(
      `SELECT id FROM subscribers
       WHERE tenant_id=? AND deleted_at IS NULL
         AND (lead_id=?
              OR (?<>'' AND LOWER(TRIM(email))=LOWER(?))
              OR (?<>'' AND phone=?))
       LIMIT 1 FOR UPDATE`,
      [tenantId, leadId, lead.email || '', lead.email || '', lead.phone || '', lead.phone || '']
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
    //
    // This demanded an email. 26,816 of the 27,236 live leads do not have one —
    // the institute takes almost every lead over WhatsApp — so «تحويل لعميل»
    // answered «يجب أن يكون للليد بريد إلكتروني» to 98% of the people it was
    // built for, and the desk had to invent an address to get past it.
    //
    // Nothing downstream actually needed the address. users.email is nullable,
    // users.phone carries its own unique key, and signing in by number is the
    // main route in (see POST /api/auth/login, which resolves a non-email
    // identifier through normalizeWhatsAppNumber). What is required is a name
    // and *some* identity, so the customer can be reached and can log in.
    const normEmail = String(lead.email || '').toLowerCase().trim();
    if (!lead.name || !String(lead.name).trim()) {
      await conn.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'يجب أن يكون للّيد اسم قبل التحويل' });
    }
    // Reserved before the INSERT: users.phone is UNIQUE per tenant, and a
    // number already linked to somebody else comes back null rather than
    // taking the whole conversion down on a duplicate key.
    const phoneForUser = await claimWhatsAppIdentity(conn, { tenantId, phone: lead.phone });
    if (!normEmail && !phoneForUser) {
      await conn.rollback(); transactionStarted = false;
      const owned = await findAccountByPhone(conn, { tenantId, phone: lead.phone });
      return res.status(400).json({
        error: owned
          ? 'رقم الواتساب ده مربوط بحساب تاني بالفعل — راجع العميل الموجود أو غيّر الرقم'
          : 'محتاج إيميل أو رقم واتساب صحيح قبل التحويل',
      });
    }

    // 4. Generate subscriber ID + ensure client_code
    const subId = uuidv4();
    let clientCode = lead.client_code || null;
    if (!clientCode) {
      try { clientCode = await getNextClientCode(conn); } catch (_) {}
    }

    // 4b. Create user account so the subscriber can log in.
    //
    // Either identity finds an existing account, and either is enough to make
    // a new one. The email column stays NULL rather than empty for a
    // phone-only customer: the unique key is on (tenant_id, email), so a
    // second empty string would collide with the first.
    let tempPass = null;
    let isNewUser = false;
    let existingUser = null;
    // A lead carrying a staff member's address is not turned into a login for
    // it (lib/staffEmailGuard.js) — the new account would be that staff member.
    if (normEmail && await staffOwnsEmail(conn, req.tenantId, normEmail, ADMIN_EMAILS)) {
      await conn.rollback().catch(() => {});
      return res.status(STAFF_EMAIL_REFUSAL.status).json(STAFF_EMAIL_REFUSAL.body);
    }
    if (normEmail) {
      [[existingUser]] = await conn.query('SELECT id FROM users WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1', [req.tenantId, normEmail]);
    }
    if (!existingUser) existingUser = await findAccountByPhone(conn, { tenantId, phone: lead.phone });
    if (!existingUser) {
      tempPass = generateTemporaryPassword();
      const hash = await bcrypt.hash(tempPass, 12);
      await conn.query(
        'INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role, is_active) VALUES (?,?,?,?,?,?,?,1)',
        [uuidv4(), req.tenantId, normEmail || null, phoneForUser, hash, sanitize(lead.name, 300), 'user']
      );
      isNewUser = true;
    }

    // 5. Resolve collection staff
    let csId = lead.assigned_cs_id || null;
    let csName = lead.assigned_cs_name || null;
    if (!csId) {
      const rep = await pickCollectionOfficer(pool, req.tenantId, { market: subscriberMarket({ branch: lead.branch }) });
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
        normEmail || null,
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
        `أهلاً ${lead.name} 🎉\nتم تفعيل اشتراكك في معهد الدراسات النفسية.\nيسعدنا انضمامك لأسرتنا. 💚`
      ).catch(() => {});
    }
    if (lead.email) {
      enqueueEmailSequence({ tenantId, triggerEvent: 'enrollment', recipientEmail: lead.email, recipientName: lead.name }).catch(error => logger.warn('[lead-convert] sequence enqueue failed', { error: error.message }));
    }
    // Send login credentials email if new user account was created.
    // Only where there is an address to send it to — a phone-only customer
    // signs in with the number, and mailing an empty recipient throws.
    if (isNewUser && tempPass && normEmail) {
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
// The score formula lives in lib/leadScoreSql.js — shared with the job that
// keeps leads.score current — so the two can never disagree.

module.exports = router;
