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

router.post('/api/registrations', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const item = req.body;
    // Returning customer (the client generates a fresh id per submission) must UPDATE
    // their existing lead, not create a second row — match by the last 10 phone digits
    // so 01xx / +201xx / 0020 1xx all resolve to the same physical number.
    // (owner requirement: no client can register twice / no duplicate data)
    const normPhone = normalizePhone(item.phone);
    let id = item.id || uuidv4();
    if (normPhone) {
      const [[existing]] = await pool.query(
        `SELECT id FROM leads WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) = RIGHT(?, 10) AND hidden = 0 LIMIT 1`,
        [normPhone]
      );
      if (existing) id = existing.id;
    }
    let code = `C${Date.now()}`;
    try {
      await conn.beginTransaction();
      const [cRows] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1 FOR UPDATE');
      const next = cRows[0]?.next_value ?? 10001;
      await conn.query('UPDATE client_code_counter SET next_value=? WHERE id=1', [next + 1]);
      await conn.commit();
      code = `C${next}`;
    } catch { await conn.rollback(); }
    conn.release();
    const { id: _id, name, email, phone, source, status, notes, branch, createdAt, created_at, ...crmData } = item;
    const branchVal = defaultDigitalBranch(branch || crmData.branch);
    await pool.query(
      `INSERT INTO leads (id, client_code, name, email, phone, source, status, notes, branch, branch_id, crm_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE crm_json=VALUES(crm_json),
         client_code=COALESCE(client_code, VALUES(client_code)),
          branch=IF(branch IS NULL OR branch='', VALUES(branch), branch),
          branch_id=IF(branch_id IS NULL OR branch_id='' OR branch_id='branch-other', VALUES(branch_id), branch_id)`,
      [id, code, name || '', email || null, phone || '', source || 'تسجيل اهتمام',
       'new', notes || null, branchVal, branchIdForBranch(branchVal), JSON.stringify({ ...crmData, branch: branchVal, clientCode: code })]
    );
    res.json({ ok: true, id, clientCode: code });
  } catch (e) {
    try { conn.release(); } catch { /* ignore */ }
    routeError(res, e);
  }
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
  try {
    const { itemId, itemType, itemTitle } = req.body || {};
    const { uid, email } = req.user;
    if (!email) return res.json({ ok: false, reason: 'no_email' });
    const tenantId = scopedTenantId(req);
    const [[alreadySub]] = await pool.query(
      'SELECT id FROM subscribers WHERE LOWER(TRIM(email)) = ? AND tenant_id = ? LIMIT 1',
      [email.toLowerCase().trim(), tenantId]
    );
    if (alreadySub) return res.json({ ok: true, skipped: true, reason: 'already_subscriber' });
    const leadId = `checkout-${tenantId}-${uid}`;
    const crmJson = JSON.stringify({ interestedCourseIds: itemId ? [itemId] : [], itemTitle, itemType });
    await pool.query(
      `INSERT INTO leads (id, tenant_id, name, email, source, status, branch, branch_id, hidden, crm_json, created_at)
       VALUES (?, ?, ?, ?, 'checkout_intent', 'new', ?, ?, 0, ?, NOW())
       ON DUPLICATE KEY UPDATE
          source = IF(source = 'checkout_intent', source, source),
          branch = IF(branch IS NULL OR branch='', VALUES(branch), branch),
          branch_id = IF(branch_id IS NULL OR branch_id='' OR branch_id='branch-other', VALUES(branch_id), branch_id),
          crm_json = VALUES(crm_json)`,
      [leadId, tenantId, email.split('@')[0], email.toLowerCase().trim(), 'ONLINE_EGYPT', branchIdForBranch('ONLINE_EGYPT'), crmJson]
    );
    res.json({ ok: true });
  } catch (e) {
    logger.warn('[checkout-intent]', e.message);
    res.json({ ok: false, reason: e.message });
  }
});

module.exports = router;
