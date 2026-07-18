'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'lead-capture-crm-route' });
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { getNextClientCode } = require('../lib/mappers');
const { normalizePhone } = require('../lib/helpers');
const { branchIdForBranch, defaultDigitalBranch, normalizeBranch } = require('../lib/branches');
const { DEFAULT_TENANT_ID, resolveTenantId } = require('../lib/tenantScope');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/rateLimits');

function routeError(res, error, message = 'lead capture crm route failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

function scopedTenantId(req) {
  return req.tenantId || resolveTenantId(req) || DEFAULT_TENANT_ID;
}

router.post('/api/registrations', publicLimiter, async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const item = req.body || {};
    const name = String(item.name || '').trim().slice(0, 120);
    const phone = String(item.phone || '').trim().slice(0, 30);
    if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
    const tenantId = scopedTenantId(req);
    await conn.beginTransaction();
    transactionStarted = true;
    const normPhone = normalizePhone(item.phone);
    let id = item.id || uuidv4();
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
    const { id: _id, email, source, status, notes, branch, createdAt, created_at, ...crmData } = item;
    const branchVal = defaultDigitalBranch(branch || crmData.branch);
    let salesId = existing?.assigned_sales_id || null;
    let salesName = existing?.assigned_sales_name || null;
    if (!salesId) {
      const [[rep]] = await conn.query(
        `SELECT s.id, s.name FROM staff s
         LEFT JOIN leads l ON l.assigned_sales_id=s.id AND l.tenant_id=? AND l.hidden=0
         WHERE s.tenant_id=? AND s.is_active=1 AND UPPER(s.role) IN ('SALES','MANAGER')
         GROUP BY s.id, s.name ORDER BY COUNT(l.id) ASC, s.name ASC LIMIT 1`,
        [tenantId, tenantId]
      );
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
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, id, clientCode: code });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    routeError(res, e);
  } finally { conn.release(); }
});

router.post('/api/leads-public', publicLimiter, async (req, res) => {
  try {
    const { name, phone, notes, source, branch } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
    const tenantId = scopedTenantId(req);
    // Same customer submitting again (chatbot re-visit, double-click) must not create a
    // second lead row — match by the last 10 phone digits and append the note instead.
    // (owner requirement: no duplicate data)
    const normPhone = normalizePhone(phone);
    if (normPhone) {
      const [[existing]] = await pool.query(
        `SELECT id FROM leads WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) = RIGHT(?, 10) AND hidden = 0 LIMIT 1`,
        [normPhone]
      );
      if (existing) {
        await pool.query(
          `UPDATE leads SET notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE CONCAT(notes, '\n', ?) END, updated_at = NOW() WHERE id = ?`,
          [(notes || '').trim().slice(0, 500), (notes || '').trim().slice(0, 500), existing.id]
        );
        return res.json({ ok: true, id: existing.id, existing: true });
      }
    }
    const id = `lead-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let code = null;
    const conn = await pool.getConnection();
    try { code = await getNextClientCode(conn); } catch (_) {} finally { conn.release(); }
    await pool.execute(
      `INSERT INTO leads (id, tenant_id, client_code, name, phone, notes, status, interest_level, source, lead_type, branch, branch_id, created_at, hidden)
       VALUES (?, ?, ?, ?, ?, ?, 'new', 'medium', ?, 'general', ?, ?, NOW(), 0)`,
      [id, tenantId, code, name.trim().slice(0, 120), phone.trim().slice(0, 30), (notes || '').trim().slice(0, 500), (source || 'chatbot').slice(0, 50), normalizeBranch(branch, 'OTHER'), branchIdForBranch(branch)]
    );
    res.json({ ok: true, id });
  } catch (e) { routeError(res, e); }
});

router.get('/api/admin/crm-settings', requireAuth, requireAdminOrStaff, async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'crm_settings'");
    res.json(rows[0]?.value ? JSON.parse(rows[0].value) : {});
  } catch (e) { routeError(res, e); }
});

router.put('/api/admin/crm-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query(
      "INSERT INTO site_config (`key`, `value`) VALUES ('crm_settings', ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/leads/distribute', requireAuth, requireAdmin, async (req, res) => {
  const { mode = 'unassigned' } = req.body || {};
  try {
    const tenantId = scopedTenantId(req);
    const whereClause = mode === 'all'
      ? `WHERE hidden=0 AND tenant_id=? AND status NOT IN ('converted','lost')`
      : `WHERE hidden=0 AND tenant_id=? AND assigned_sales_id IS NULL AND status NOT IN ('converted','lost')`;
    const [targets] = await pool.execute(
      `SELECT id FROM leads ${whereClause} ORDER BY created_at ASC`,
      [tenantId]
    );
    const [reps] = await pool.execute(
      `SELECT id, name FROM staff WHERE role IN ('SALES','MANAGER') AND is_active=1 ORDER BY name ASC`
    );
    if (!reps.length) return res.json({ ok: false, assigned: 0, reason: 'No sales reps found' });
    if (!targets.length) return res.json({ ok: true, assigned: 0 });
    const [rrRows] = await pool.query("SELECT `value` FROM site_config WHERE `key`='crm_rr_index'");
    let rrIdx = parseInt(rrRows[0]?.value || '0') || 0;
    // One extra virtual "no rep" slot in the cycle alongside the real reps, so roughly
    // 1 in (reps+1) leads is deliberately left unassigned instead of force-distributing
    // every lead — those land in the "محلي جديد" tab for manual placement. (owner request)
    const totalSlots = reps.length + 1;
    let count = 0;
    for (let i = 0; i < targets.length; i++) {
      const slot = rrIdx % totalSlots;
      rrIdx++;
      if (slot === reps.length) continue;
      const rep = reps[slot];
      await pool.execute(
        `UPDATE leads SET assigned_sales_id=?, assigned_sales_name=? WHERE id=? AND tenant_id=?`,
        [rep.id, rep.name, targets[i].id, tenantId]
      );
      count++;
    }
    await pool.query(
      "INSERT INTO site_config (`key`,`value`) VALUES ('crm_rr_index',?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [String(rrIdx)]
    );
    res.json({ ok: true, assigned: count, reps: reps.length });
  } catch (e) { routeError(res, e); }
});

router.post('/api/public/checkout-intent', requireAuth, publicLimiter, async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { itemId, itemType, itemTitle, customerName, customerEmail, customerPhone } = req.body || {};
    const { uid, email } = req.user;
    if (!email || !uid) return res.status(401).json({ error: 'Authenticated customer required' });
    const normalizedType = String(itemType || '').toLowerCase();
    if (!['course', 'bundle', 'consultation', 'certificate'].includes(normalizedType)) {
      return res.status(400).json({ error: 'Invalid item type' });
    }
    if (!itemId && normalizedType !== 'consultation') {
      return res.status(400).json({ error: 'itemId required' });
    }
    const tenantId = scopedTenantId(req);
    const normalizedEmail = String(customerEmail || email).toLowerCase().trim();
    if (normalizedEmail !== email.toLowerCase().trim()) return res.status(403).json({ error: 'Checkout email must match the authenticated account' });
    const branch = defaultDigitalBranch(req.body?.branch || 'ONLINE_EGYPT');
    const branchId = branchIdForBranch(branch);

    // Product prices are authoritative on the server. Never trust a price sent
    // by the browser, even on the manually reviewed transfer path.
    let expectedAmount = 0;
    let expectedCurrency = 'EGP';
    let canonicalTitle = String(itemTitle || '').trim().slice(0, 500);
    if (normalizedType === 'course') {
      const [[course]] = await conn.query('SELECT id, title, title_ar, price_egp FROM courses WHERE id=? AND tenant_id=? LIMIT 1', [itemId, tenantId]);
      if (!course) return res.status(404).json({ error: 'Course not found' });
      expectedAmount = Number(course.price_egp) || 0;
      canonicalTitle = course.title_ar || course.title || canonicalTitle;
    } else if (normalizedType === 'bundle') {
      const [[bundle]] = await conn.query('SELECT id, title, price_egp FROM bundles WHERE id=? AND tenant_id=? LIMIT 1', [itemId, tenantId]);
      if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
      expectedAmount = Number(bundle.price_egp) || 0;
      canonicalTitle = bundle.title || canonicalTitle;
    } else if (normalizedType === 'certificate') {
      const [[certificate]] = await conn.query(
        `SELECT cr.id, cr.price, cr.currency, cr.custom_name, cr.type
           FROM certificate_requests cr
           JOIN subscribers s ON s.id=cr.subscriber_id AND s.tenant_id=cr.tenant_id
          WHERE cr.id=? AND cr.tenant_id=? AND LOWER(TRIM(s.email))=?
            AND cr.status IN ('PENDING','PRICED') LIMIT 1`,
        [itemId, tenantId, normalizedEmail]
      );
      if (!certificate) return res.status(404).json({ error: 'Eligible certificate request not found' });
      expectedAmount = Number(certificate.price) || 0;
      expectedCurrency = ['EGP', 'SAR', 'USD'].includes(String(certificate.currency || '').toUpperCase())
        ? String(certificate.currency).toUpperCase() : 'EGP';
      canonicalTitle = certificate.custom_name || certificate.type || canonicalTitle;
    } else if (normalizedType === 'consultation') {
      const therapistId = String(req.body?.therapistId || '').trim();
      if (therapistId) {
        const [[therapist]] = await conn.query(
          'SELECT id, name, price_egp FROM therapists WHERE id=? AND is_active=1 AND is_consultation_enabled=1 LIMIT 1',
          [therapistId]
        );
        if (!therapist) return res.status(404).json({ error: 'Therapist not available' });
        expectedAmount = Number(therapist.price_egp) || 0;
        canonicalTitle = `Consultation - ${therapist.name}`;
      } else if (String(req.body?.subtype || '').toLowerCase() === 'express') {
        const [[row]] = await conn.query("SELECT `value` FROM site_config WHERE `key`='content' LIMIT 1");
        let configured = 0;
        try { configured = Number(JSON.parse(row?.value || '{}')['express.price.EGP']) || 0; } catch { configured = 0; }
        expectedAmount = configured;
        canonicalTitle = 'Express consultation';
      } else {
        return res.status(400).json({ error: 'therapistId required' });
      }
    }
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) return res.status(400).json({ error: 'A positive server-verifiable amount is required' });

    await conn.beginTransaction();
    transactionStarted = true;
    const [[subscriber]] = await conn.query(
      'SELECT id, lead_id FROM subscribers WHERE LOWER(TRIM(email))=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [normalizedEmail, tenantId]
    );
    const [[existingLead]] = await conn.query(
      'SELECT id FROM leads WHERE LOWER(TRIM(email))=? AND tenant_id=? AND hidden=0 ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
      [normalizedEmail, tenantId]
    );
    const leadId = subscriber?.lead_id || existingLead?.id || uuidv4();
    const crmJson = JSON.stringify({ interestedCourseIds: itemId ? [itemId] : [], itemTitle: canonicalTitle, itemType: normalizedType });
    await conn.query(
      `INSERT INTO leads (id, tenant_id, name, email, phone, source, status, branch, branch_id, hidden, crm_json, created_at)
       VALUES (?, ?, ?, ?, ?, 'checkout_intent', 'new', ?, ?, 0, ?, NOW())
       ON DUPLICATE KEY UPDATE
          name=VALUES(name), phone=COALESCE(NULLIF(VALUES(phone),''),phone),
          branch=COALESCE(NULLIF(branch,''),VALUES(branch)), branch_id=COALESCE(branch_id,VALUES(branch_id)),
          crm_json=VALUES(crm_json)`,
      [leadId, tenantId, String(customerName || email.split('@')[0]).trim().slice(0, 255), normalizedEmail,
       String(customerPhone || '').trim().slice(0, 50), branch, branchId, crmJson]
    );
    const [[pendingOrder]] = await conn.query(
      `SELECT id FROM orders
       WHERE tenant_id=? AND customer_email=? AND type=? AND item_id=? AND status='PENDING'
         AND created_at>=DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [tenantId, normalizedEmail, normalizedType.toUpperCase(), itemId || normalizedType]
    );
    const orderId = pendingOrder?.id || uuidv4();
    const notes = JSON.stringify({
      checkout: 'manual_transfer',
      therapistId: req.body?.therapistId || null,
      sessionDate: req.body?.sessionDate || null,
      sessionType: req.body?.sessionType || null,
      subtype: req.body?.subtype || null,
    });
    await conn.query(
      `INSERT INTO orders
         (id, subscriber_id, item_id, item_title, type, status, amount, currency, payment_method,
          customer_name, customer_email, customer_phone, course_id, bundle_id, notes, tenant_id, branch_id, created_at)
       VALUES (?,?,?,?,?,'PENDING',?,?, 'TRANSFER',?,?,?,?,?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE amount=VALUES(amount), item_title=VALUES(item_title), customer_name=VALUES(customer_name),
         customer_phone=VALUES(customer_phone), notes=VALUES(notes), tenant_id=VALUES(tenant_id), branch_id=VALUES(branch_id)`,
      [orderId, subscriber?.id || null, itemId || normalizedType, canonicalTitle || normalizedType,
       normalizedType.toUpperCase(), expectedAmount, expectedCurrency,
       String(customerName || '').trim().slice(0, 255), normalizedEmail, String(customerPhone || '').trim().slice(0, 50),
       normalizedType === 'course' ? itemId : null, normalizedType === 'bundle' ? itemId : null,
       notes, tenantId, branchId]
    );
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, orderId, amount: expectedAmount, currency: expectedCurrency });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[checkout-intent]', e.message);
    res.status(500).json({ error: 'Could not create checkout order' });
  } finally { conn.release(); }
});

module.exports = router;
