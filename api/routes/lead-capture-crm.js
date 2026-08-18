'use strict';
const { amountDueNow, installmentTotal } = require('../lib/enrollmentPricing');

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const logger = require('../lib/logger').child({ module: 'lead-capture-crm-route' });
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { getNextClientCode } = require('../lib/mappers');
const { normalizePhone } = require('../lib/helpers');
const { branchIdForBranch, normalizeBranch } = require('../lib/branches');
const { DEFAULT_TENANT_ID, resolveTenantId } = require('../lib/tenantScope');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/rateLimits');
const { getTenantSetting, setTenantSetting } = require('../lib/tenantSettings');
const { logLeadEvent } = require('../lib/crm');
const { getNextSalesRep } = require('../lib/leadAssignment');
const { resolveClientContext } = require('../lib/clientContext');
const { resolveSubscriberRow } = require('../lib/subscriberIdentity');

function routeError(res, error, message = 'lead capture crm route failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

function scopedTenantId(req) {
  return req.tenantId || resolveTenantId(req) || DEFAULT_TENANT_ID;
}

router.post('/api/registrations', publicLimiter, async (req, res) => {
  let conn;
  let transactionStarted = false;
  let registrationLock = null;
  try {
    const item = req.body || {};
    const name = String(item.name || '').trim().slice(0, 120);
    const phone = String(item.phone || '').trim().slice(0, 30);
    if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
    const tenantId = scopedTenantId(req);
    const clientContext = await resolveClientContext(req);
    if (!clientContext.locationResolved) {
      return res.status(503).json({ error: 'Customer location could not be verified', code: 'LOCATION_UNAVAILABLE' });
    }
    conn = await pool.getConnection();
    const normPhone = normalizePhone(item.phone);
    registrationLock = `registration:${crypto.createHash('sha256').update(`${tenantId}:${normPhone || phone}`).digest('hex').slice(0, 40)}`;
    const [[lock]] = await conn.query('SELECT GET_LOCK(?,5) AS acquired', [registrationLock]);
    if (Number(lock?.acquired) !== 1) return res.status(409).json({ error: 'Registration is already being processed' });
    await conn.beginTransaction();
    transactionStarted = true;
    // Public callers cannot choose a database primary key. Reuse only a row
    // found by the tenant-bound identity lookup below.
    let id = uuidv4();
    let existing = null;
    if (normPhone) {
      [[existing]] = await conn.query(
        `SELECT id, client_code, crm_json, assigned_sales_id, assigned_sales_name
           FROM leads
          WHERE tenant_id=? AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10)=RIGHT(?,10)
            AND hidden=0 LIMIT 1 FOR UPDATE`,
        [tenantId, normPhone]
      );
      if (existing) id = existing.id;
    }
    let code = existing?.client_code || null;
    if (!code) code = await getNextClientCode(conn);
    const { id: _id, email, source, status, notes, branch: _branch, createdAt, created_at, ...crmData } = item;
    const branchVal = clientContext.branch;
    let salesId = existing?.assigned_sales_id || null;
    let salesName = existing?.assigned_sales_name || null;
    if (!salesId) {
      const rep = await getNextSalesRep(tenantId, conn, { branch: branchVal });
      salesId = rep?.id || null;
      salesName = rep?.name || null;
    }
    let previousCrm = {};
    try { previousCrm = existing?.crm_json ? JSON.parse(existing.crm_json) : {}; } catch (_) {}
    const crmPayload = {
      ...previousCrm,
      ...crmData,
      branch: branchVal,
      clientCode: code,
      assignedSalesId: salesId,
      assignedSalesName: salesName,
    };
    await conn.query(
      `INSERT INTO leads
         (id, tenant_id, client_code, name, email, phone, source, status, notes, branch, branch_id,
          assigned_sales_id, assigned_sales_name, crm_json, hidden, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,NOW())
       ON DUPLICATE KEY UPDATE
         name=VALUES(name), email=COALESCE(VALUES(email),email), phone=VALUES(phone),
         source=COALESCE(VALUES(source),source), notes=COALESCE(VALUES(notes),notes),
         crm_json=VALUES(crm_json), client_code=COALESCE(client_code,VALUES(client_code)),
         assigned_sales_id=COALESCE(assigned_sales_id,VALUES(assigned_sales_id)),
         assigned_sales_name=COALESCE(assigned_sales_name,VALUES(assigned_sales_name)),
         branch=COALESCE(NULLIF(branch,''),VALUES(branch)), branch_id=COALESCE(branch_id,VALUES(branch_id))`,
      [id, tenantId, code, name, email || null, phone, source || 'تسجيل اهتمام',
       'new', notes || null, branchVal, branchIdForBranch(branchVal), salesId, salesName, JSON.stringify(crmPayload)]
    );
    await logLeadEvent(id, existing ? 'updated' : 'created', existing ? 'Public registration refreshed' : 'Public registration captured', { source: source || 'registration', assignedSalesId: salesId }, tenantId, conn);
    await conn.commit();
    transactionStarted = false;
    if (!existing) await require('../lib/lifecycle').trigger('lead_created', { name, email, phone, tenantId });
    res.json({ ok: true, id, clientCode: code });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    routeError(res, e);
  } finally {
    if (registrationLock && conn) await conn.query('SELECT RELEASE_LOCK(?)', [registrationLock]).catch(() => {});
    if (conn) conn.release();
  }
});

router.post('/api/leads-public', publicLimiter, async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  let leadLock = null;
  try {
    const { name, phone, notes, source, branch } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
    const tenantId = scopedTenantId(req);
    // Same customer submitting again (chatbot re-visit, double-click) must not create a
    // second lead row — match by the last 10 phone digits and append the note instead.
    // (owner requirement: no duplicate data)
    const normPhone = normalizePhone(phone);
    leadLock = `lead-public:${crypto.createHash('sha256').update(`${tenantId}:${normPhone || phone}`).digest('hex').slice(0, 40)}`;
    const [[lock]] = await conn.query('SELECT GET_LOCK(?,5) AS acquired', [leadLock]);
    if (Number(lock?.acquired) !== 1) return res.status(409).json({ error: 'Lead submission is already being processed' });
    await conn.beginTransaction();
    transactionStarted = true;
    if (normPhone) {
      const [[existing]] = await conn.query(
        `SELECT id FROM leads WHERE tenant_id=? AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) = RIGHT(?, 10) AND hidden = 0 LIMIT 1 FOR UPDATE`,
        [tenantId, normPhone]
      );
      if (existing) {
        await conn.query(
          `UPDATE leads SET notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE CONCAT(notes, '\n', ?) END, updated_at = NOW() WHERE id = ? AND tenant_id=?`,
          [(notes || '').trim().slice(0, 500), (notes || '').trim().slice(0, 500), existing.id, tenantId]
        );
        await logLeadEvent(existing.id, 'note_added', 'Public form submitted again', { source: source || 'chatbot' }, tenantId, conn);
        await conn.commit();
        transactionStarted = false;
        return res.json({ ok: true, id: existing.id, existing: true });
      }
    }
    const id = `lead-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let code = null;
    try { code = await getNextClientCode(conn); } catch (_) {}
    const normalizedBranch = normalizeBranch(branch, 'OTHER');
    const rep = await getNextSalesRep(tenantId, conn, { branch: normalizedBranch });
    await conn.execute(
      `INSERT INTO leads (id, tenant_id, client_code, name, phone, notes, status, interest_level, source, lead_type, branch, branch_id, assigned_sales_id, assigned_sales_name, created_at, hidden)
       VALUES (?, ?, ?, ?, ?, ?, 'new', 'medium', ?, 'general', ?, ?, ?, ?, NOW(), 0)`,
      [id, tenantId, code, name.trim().slice(0, 120), phone.trim().slice(0, 30), (notes || '').trim().slice(0, 500), (source || 'chatbot').slice(0, 50), normalizedBranch, branchIdForBranch(normalizedBranch), rep?.id || null, rep?.name || null]
    );
    await logLeadEvent(id, 'created', 'Public lead captured', { source: source || 'chatbot', assignedSalesId: rep?.id || null }, tenantId, conn);
    await conn.commit();
    transactionStarted = false;
    await require('../lib/lifecycle').trigger('lead_created', { name, phone, tenantId });
    res.json({ ok: true, id });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    routeError(res, e);
  } finally {
    if (leadLock) await conn.query('SELECT RELEASE_LOCK(?)', [leadLock]).catch(() => {});
    conn.release();
  }
});

// Read is gated on 'view_leads', not 'view_settings'. This payload is the lead
// sources / stage labels the leads screen needs to render at all, and the leads
// screen is a rep's main workspace — requiring a settings permission meant every
// rep got "تعذر تحميل إعدادات CRM" on every visit, with the source dropdowns
// falling back to defaults. Writing still needs full admin (PUT below).
router.get('/api/admin/crm-settings', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    res.json(await getTenantSetting('crm_settings', { tenantId: req.tenantId, fallback: {} }));
  } catch (e) { routeError(res, e); }
});

router.put('/api/admin/crm-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    await setTenantSetting('crm_settings', req.body || {}, { tenantId: req.tenantId, actorId: req.user?.uid });
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/leads/distribute', requireAuth, requireAdmin, async (req, res) => {
  const { mode = 'unassigned' } = req.body || {};
  const conn = await pool.getConnection();
  let transactionStarted = false;
  let distributionLock = null;
  try {
    const tenantId = scopedTenantId(req);
    distributionLock = `crm-distribute:${tenantId}`;
    const [[lock]] = await conn.query('SELECT GET_LOCK(?,5) AS acquired', [distributionLock]);
    if (Number(lock?.acquired) !== 1) return res.status(409).json({ error: 'Lead distribution is already running' });
    await conn.beginTransaction();
    transactionStarted = true;
    const whereClause = mode === 'all'
      ? `WHERE hidden=0 AND tenant_id=? AND status NOT IN ('converted','lost')`
      : `WHERE hidden=0 AND tenant_id=? AND assigned_sales_id IS NULL AND status NOT IN ('converted','lost')`;
    const [targets] = await conn.execute(
      `SELECT id FROM leads ${whereClause} ORDER BY created_at ASC FOR UPDATE`,
      [tenantId]
    );
    const [reps] = await conn.execute(
      `SELECT id, name FROM staff WHERE tenant_id=? AND role IN ('SALES','MANAGER') AND is_active=1 ORDER BY name ASC`,
      [tenantId]
    );
    if (!reps.length) {
      await conn.rollback(); transactionStarted = false;
      return res.json({ ok: false, assigned: 0, reason: 'No sales reps found' });
    }
    if (!targets.length) {
      await conn.rollback(); transactionStarted = false;
      return res.json({ ok: true, assigned: 0 });
    }
    let rrIdx = Number(await getTenantSetting('crm_rr_index', { tenantId, fallback: 0, db: conn })) || 0;
    // Optional ceiling on how many leads one rep may be handed in a day. Without
    // it, a large import lands on the team all at once and a rep with 200 new
    // names works none of them properly. Counts what each rep already received
    // today, from any source, so the cap is a real daily total and not just a
    // limit on this run. Absent or zero means no ceiling, exactly as before.
    const dailyCap = Math.max(0, Number(req.body?.dailyCap) || 0);
    const assignedToday = new Map();
    if (dailyCap > 0) {
      const [todayRows] = await conn.execute(
        `SELECT assigned_sales_id AS id, COUNT(*) AS n
           FROM leads
          WHERE tenant_id=? AND assigned_sales_id IS NOT NULL AND DATE(assigned_at)=CURDATE()
          GROUP BY assigned_sales_id`,
        [tenantId]
      );
      todayRows.forEach(row => assignedToday.set(String(row.id), Number(row.n) || 0));
    }
    const atCap = rep => dailyCap > 0 && (assignedToday.get(String(rep.id)) || 0) >= dailyCap;

    // One extra virtual "no rep" slot in the cycle alongside the real reps, so roughly
    // 1 in (reps+1) leads is deliberately left unassigned instead of force-distributing
    // every lead — those land in the "محلي جديد" tab for manual placement. (owner request)
    const totalSlots = reps.length + 1;
    let count = 0;
    let skippedAtCap = 0;
    for (let i = 0; i < targets.length; i++) {
      // Everyone full: stop rather than spin through the remaining leads.
      if (dailyCap > 0 && reps.every(atCap)) { skippedAtCap += targets.length - i; break; }
      const slot = rrIdx % totalSlots;
      rrIdx++;
      if (slot === reps.length) continue;
      const rep = reps[slot];
      // Skip a rep who has hit today's ceiling and let the cycle carry on, so
      // the lead goes to the next person rather than being dropped.
      if (atCap(rep)) { i--; continue; }
      await conn.execute(
        `UPDATE leads SET assigned_sales_id=?, assigned_sales_name=?, assigned_at=NOW() WHERE id=? AND tenant_id=?`,
        [rep.id, rep.name, targets[i].id, tenantId]
      );
      if (dailyCap > 0) assignedToday.set(String(rep.id), (assignedToday.get(String(rep.id)) || 0) + 1);
      count++;
    }
    await setTenantSetting('crm_rr_index', rrIdx, { tenantId, actorId: req.user?.uid, db: conn });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, assigned: count, reps: reps.length, skippedAtCap, dailyCap });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    routeError(res, e);
  } finally {
    if (distributionLock) await conn.query('SELECT RELEASE_LOCK(?)', [distributionLock]).catch(() => {});
    conn.release();
  }
});

router.post('/api/public/checkout-intent', requireAuth, publicLimiter, async (req, res) => {
  let conn;
  let transactionStarted = false;
  let checkoutLock = null;
  try {
    const {
      itemId, itemType, itemTitle, customerName, customerEmail, customerPhone,
      paymentLinkToken, payMode,
    } = req.body || {};
    // 'cash' or 'installment'. The rate is applied here and never taken from
    // the client: /enroll showed a discounted price and sent none of it, so a
    // customer who picked قسط was billed the full list price at checkout.
    const normalizedPayMode = payMode === 'installment' ? 'installment' : 'cash';
    const { uid, email } = req.user;
    if (!uid) return res.status(401).json({ error: 'Authenticated customer required' });
    // The account is the identity, not the body. A WhatsApp-only client has no
    // email at all and used to be turned away here — unable to buy anything.
    const identity = await resolveSubscriberRow(req, ['id', 'lead_id', 'email', 'phone']);
    const accountEmail = String(email || identity?.email || '').toLowerCase().trim();
    if (!accountEmail && !identity) return res.status(401).json({ error: 'Authenticated customer required' });
    const normalizedType = String(itemType || '').toLowerCase();
    if (!['course', 'bundle', 'consultation', 'certificate'].includes(normalizedType)) {
      return res.status(400).json({ error: 'Invalid item type' });
    }
    if (!itemId && normalizedType !== 'consultation') {
      return res.status(400).json({ error: 'itemId required' });
    }
    const tenantId = scopedTenantId(req);
    // A supplied email may never point the checkout at a different account: the
    // subscriber below is looked up by it. When the account has its own email the
    // body must match it exactly; when it doesn't, the supplied address is
    // accepted as contact detail only and the identity stays the account link.
    const requestedEmail = String(customerEmail || '').toLowerCase().trim();
    if (accountEmail && requestedEmail && requestedEmail !== accountEmail) {
      return res.status(403).json({ error: 'Checkout email must match the authenticated account' });
    }
    const normalizedEmail = accountEmail || requestedEmail;
    const clientContext = await resolveClientContext(req);
    if (!clientContext.locationResolved) {
      return res.status(503).json({ error: 'Customer location could not be verified', code: 'LOCATION_UNAVAILABLE' });
    }
    conn = await pool.getConnection();
    const branch = clientContext.branch;
    const branchId = branchIdForBranch(branch);
    let paymentLink = null;
    if (paymentLinkToken) {
      [[paymentLink]] = await conn.query(
        `SELECT id,item_type,item_id,amount,currency,subscriber_id,expires_at,used_at
           FROM payment_links
          WHERE tenant_id=? AND token=? LIMIT 1`,
        [tenantId, String(paymentLinkToken)]
      );
      if (!paymentLink) return res.status(404).json({ error: 'Payment link not found' });
      if (paymentLink.used_at) return res.status(409).json({ error: 'Payment link already used' });
      if (new Date(paymentLink.expires_at).getTime() <= Date.now()) {
        return res.status(410).json({ error: 'Payment link expired' });
      }
      if (paymentLink.item_type !== normalizedType || String(paymentLink.item_id) !== String(itemId)) {
        return res.status(409).json({ error: 'Payment link item does not match checkout' });
      }
    }

    // Product prices are authoritative on the server. Never trust a price sent
    // by the browser, even on the manually reviewed transfer path.
    let expectedAmount = 0;
    let basePrice = 0;
    let expectedCurrency = clientContext.currency;
    let canonicalTitle = String(itemTitle || '').trim().slice(0, 500);
    if (normalizedType === 'course') {
      const [[course]] = await conn.query(
        'SELECT id, title, title_ar, price_egp, price_sar, price_usd FROM courses WHERE id=? AND tenant_id=? LIMIT 1',
        [itemId, tenantId]
      );
      if (!course) return res.status(404).json({ error: 'Course not found' });
      basePrice = Number(course[`price_${expectedCurrency.toLowerCase()}`]) || 0;
      expectedAmount = basePrice > 0 ? amountDueNow(basePrice, normalizedPayMode) : 0;
      canonicalTitle = course.title_ar || course.title || canonicalTitle;
    } else if (normalizedType === 'bundle') {
      const [[bundle]] = await conn.query(
        'SELECT id, title, price_egp, price_sar, price_usd FROM bundles WHERE id=? AND tenant_id=? LIMIT 1',
        [itemId, tenantId]
      );
      if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
      basePrice = Number(bundle[`price_${expectedCurrency.toLowerCase()}`]) || 0;
      expectedAmount = basePrice > 0 ? amountDueNow(basePrice, normalizedPayMode) : 0;
      canonicalTitle = bundle.title || canonicalTitle;
    } else if (normalizedType === 'certificate') {
      const [[certificate]] = await conn.query(
        `SELECT cr.id, cr.price, cr.currency, cr.custom_name, cr.type
           FROM certificate_requests cr
           JOIN subscribers s ON s.id=cr.subscriber_id AND s.tenant_id=cr.tenant_id
          WHERE cr.id=? AND cr.tenant_id=? AND (cr.subscriber_id=? OR (?<>'' AND LOWER(TRIM(s.email))=?))
            AND cr.status IN ('PENDING','PRICED') LIMIT 1`,
        [itemId, tenantId, identity?.id || '', normalizedEmail, normalizedEmail]
      );
      if (!certificate) return res.status(404).json({ error: 'Eligible certificate request not found' });
      expectedAmount = Number(certificate.price) || 0;
      const certificateCurrency = String(certificate.currency || '').toUpperCase();
      if (certificateCurrency !== expectedCurrency) {
        return res.status(409).json({
          error: 'Certificate price currency does not match the verified customer location',
          code: 'CURRENCY_CONTEXT_MISMATCH',
        });
      }
      canonicalTitle = certificate.custom_name || certificate.type || canonicalTitle;
    } else if (normalizedType === 'consultation') {
      const therapistId = String(req.body?.therapistId || '').trim();
      if (paymentLink) {
        const [[consultation]] = await conn.query(
          `SELECT c.id,c.client_email,c.subscriber_id,c.amount,c.currency,t.name AS therapist_name
             FROM consultations c
             JOIN therapists t ON t.id=c.therapist_id AND t.tenant_id=c.tenant_id
            WHERE c.id=? AND c.tenant_id=? AND c.deleted_at IS NULL
              AND c.status IN ('PENDING','CONFIRMED') LIMIT 1`,
          [itemId, tenantId]
        );
        if (!consultation) return res.status(404).json({ error: 'Consultation not found' });
        // Either proof of ownership is enough. Email alone rejected every
        // WhatsApp-only client outright, since theirs is always the empty string.
        const ownsBySubscriber = identity?.id && String(consultation.subscriber_id || '') === String(identity.id);
        const ownsByEmail = normalizedEmail
          && String(consultation.client_email || '').toLowerCase().trim() === normalizedEmail;
        if (consultation.client_email && !ownsBySubscriber && !ownsByEmail) {
          return res.status(403).json({ error: 'Consultation belongs to another customer' });
        }
        expectedAmount = Number(consultation.amount) || Number(paymentLink.amount) || 0;
        canonicalTitle = `Consultation - ${consultation.therapist_name}`;
      } else if (therapistId) {
        const [[therapist]] = await conn.query(
          `SELECT id, name, price_egp, price_sar, price_usd FROM therapists
            WHERE id=? AND tenant_id=? AND is_active=1 AND is_consultation_enabled=1 LIMIT 1`,
          [therapistId, tenantId]
        );
        if (!therapist) return res.status(404).json({ error: 'Therapist not available' });
        expectedAmount = Number(therapist[`price_${expectedCurrency.toLowerCase()}`]) || 0;
        canonicalTitle = `Consultation - ${therapist.name}`;
      } else if (String(req.body?.subtype || '').toLowerCase() === 'express') {
        const content = await getTenantSetting('content', { tenantId, fallback: {}, db: conn });
        const configured = Number(content[`express.price.${expectedCurrency}`]) || 0;
        expectedAmount = configured;
        canonicalTitle = 'Express consultation';
      } else {
        return res.status(400).json({ error: 'therapistId required' });
      }
    }
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) return res.status(400).json({ error: 'A positive server-verifiable amount is required' });
    if (paymentLink) {
      const linkCurrency = String(paymentLink.currency || '').toUpperCase();
      if (linkCurrency !== expectedCurrency) {
        return res.status(409).json({
          error: 'Payment link currency does not match the verified customer location',
          code: 'CURRENCY_CONTEXT_MISMATCH',
        });
      }
      expectedAmount = Number(paymentLink.amount);
      if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
        return res.status(409).json({ error: 'Payment link amount is invalid' });
      }
    }

    const checkoutDiscriminator = [tenantId, uid, normalizedEmail, normalizedType, itemId || '', paymentLink?.id || '', req.body?.therapistId || '', req.body?.sessionDate || '', req.body?.subtype || ''].join(':');
    checkoutLock = `checkout:${crypto.createHash('sha256').update(checkoutDiscriminator).digest('hex').slice(0, 48)}`;
    const [[lockResult]] = await conn.query('SELECT GET_LOCK(?,5) AS acquired', [checkoutLock]);
    if (Number(lockResult?.acquired) !== 1) return res.status(409).json({ error: 'Checkout is already being processed' });

    await conn.beginTransaction();
    transactionStarted = true;
    // Locked by id: the subscriber was already resolved from the account, so the
    // body cannot steer this at somebody else's record.
    const [[subscriber]] = identity
      ? await conn.query(
        'SELECT id, lead_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
        [identity.id, tenantId]
      )
      : [[null]];
    if (paymentLink) {
      const [[lockedLink]] = await conn.query(
        `SELECT id,subscriber_id,expires_at,used_at
           FROM payment_links WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
        [paymentLink.id, tenantId]
      );
      if (!lockedLink || lockedLink.used_at || new Date(lockedLink.expires_at).getTime() <= Date.now()) {
        const error = new Error('Payment link is no longer available');
        error.status = 409;
        throw error;
      }
      if (lockedLink.subscriber_id && String(lockedLink.subscriber_id) !== String(subscriber?.id || '')) {
        const error = new Error('Payment link belongs to another customer');
        error.status = 403;
        throw error;
      }
    }
    // Guarded: with no email this would match every lead stored with a blank one
    // and attach this checkout to a stranger's lead.
    const [[existingLead]] = normalizedEmail
      ? await conn.query(
        'SELECT id FROM leads WHERE LOWER(TRIM(email))=? AND tenant_id=? AND hidden=0 ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
        [normalizedEmail, tenantId]
      )
      : [[null]];
    const leadId = subscriber?.lead_id || existingLead?.id || uuidv4();
    const crmJson = JSON.stringify({ interestedCourseIds: itemId ? [itemId] : [], itemTitle: canonicalTitle, itemType: normalizedType });
    await conn.query(
      `INSERT INTO leads (id, tenant_id, name, email, phone, source, status, branch, branch_id, hidden, crm_json, created_at)
       VALUES (?, ?, ?, ?, ?, 'checkout_intent', 'new', ?, ?, 0, ?, NOW())
       ON DUPLICATE KEY UPDATE
          name=VALUES(name), phone=COALESCE(NULLIF(VALUES(phone),''),phone),
          branch=COALESCE(NULLIF(branch,''),VALUES(branch)), branch_id=COALESCE(branch_id,VALUES(branch_id)),
          crm_json=VALUES(crm_json)`,
      // NULL rather than '' — leads.email is unique per tenant, so a blank string
      // would make the second email-less checkout collide with the first.
      // email.split('@') used to throw outright when the account had no email.
      [leadId, tenantId,
       String(customerName || normalizedEmail.split('@')[0] || 'عميل').trim().slice(0, 255),
       normalizedEmail || null,
       String(customerPhone || identity?.phone || '').trim().slice(0, 50), branch, branchId, crmJson]
    );
    // Reuse of a recent pending order is keyed on the customer. With no email the
    // subscriber link is the only safe key — matching on customer_email='' would
    // hand this checkout somebody else's unclaimed order.
    let pendingOrder = null;
    if (!paymentLink && (normalizedEmail || subscriber?.id)) {
      const ownerSql = normalizedEmail ? 'customer_email=?' : 'subscriber_id=?';
      const ownerParam = normalizedEmail || subscriber.id;
      [[pendingOrder]] = await conn.query(
        `SELECT id FROM orders
         WHERE tenant_id=? AND ${ownerSql} AND type=? AND item_id=? AND status='pending'
           AND created_at>=DATE_SUB(NOW(), INTERVAL 24 HOUR)
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [tenantId, ownerParam, normalizedType.toUpperCase(), itemId || normalizedType]
      );
    }
    const orderId = pendingOrder?.id || uuidv4();
    const notes = JSON.stringify({
      checkout: 'manual_transfer',
      therapistId: req.body?.therapistId || null,
      sessionDate: req.body?.sessionDate || null,
      sessionType: req.body?.sessionType || null,
      subtype: req.body?.subtype || null,
      paymentLinkId: paymentLink?.id || null,
    });
    await conn.query(
      `INSERT INTO orders
         (id, subscriber_id, item_id, item_title, type, status, amount, currency, payment_method,
          customer_name, customer_email, customer_phone, course_id, bundle_id, notes, tenant_id, branch_id, created_at)
       VALUES (?,?,?,?,?,'pending',?,?, 'TRANSFER',?,?,?,?,?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE amount=VALUES(amount), currency=VALUES(currency),
         item_title=VALUES(item_title), customer_name=VALUES(customer_name),
         customer_phone=VALUES(customer_phone), notes=VALUES(notes), tenant_id=VALUES(tenant_id), branch_id=VALUES(branch_id)`,
      [orderId, subscriber?.id || null, itemId || normalizedType, canonicalTitle || normalizedType,
       normalizedType.toUpperCase(), expectedAmount, expectedCurrency,
       String(customerName || '').trim().slice(0, 255), normalizedEmail || null, String(customerPhone || identity?.phone || '').trim().slice(0, 50),
       normalizedType === 'course' ? itemId : null, normalizedType === 'bundle' ? itemId : null,
       notes, tenantId, branchId]
    );
    if (paymentLink) {
      const [consumed] = await conn.query(
        `UPDATE payment_links
            SET used_at=NOW(),used_by_order_id=?
          WHERE id=? AND tenant_id=? AND used_at IS NULL AND expires_at>NOW()`,
        [orderId, paymentLink.id, tenantId]
      );
      if (Number(consumed.affectedRows) !== 1) throw new Error('Payment link redemption conflict');
    }
    await conn.commit();
    transactionStarted = false;
    res.json({
      ok: true, orderId, amount: expectedAmount, currency: expectedCurrency,
      payMode: normalizedPayMode,
      basePrice: basePrice || undefined,
      planTotal: normalizedPayMode === 'installment' && basePrice ? installmentTotal(basePrice) : undefined,
    });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[checkout-intent]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not create checkout order' });
  } finally {
    if (checkoutLock && conn) await conn.query('SELECT RELEASE_LOCK(?)', [checkoutLock]).catch(() => {});
    if (conn) conn.release();
  }
});

module.exports = router;
