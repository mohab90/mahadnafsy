'use strict';
/**
 * "التسجيلات" (Registrations) — accounts created by self-service signup
 * (/api/user/signup) that staff haven't triaged yet.
 *
 * Registration used to auto-create a lead for every signup, so a self-
 * registered customer was immediately a "potential client" whether or not
 * they ever meant to be one. This gives staff a real third bucket — neither
 * a lead nor an online client — with two explicit outcomes: promote to a
 * paying-track online client (subscriber), or send to the CRM as a lead.
 * The registration route itself no longer creates a lead automatically;
 * see the comment removed from api/routes/auth.js.
 */
const express = require('express');
const router = express.Router();
const logger = require('../lib/logger');
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { getNextClientCode } = require('../lib/mappers');
const { getNextSalesRep } = require('../lib/leadAssignment');
const { branchIdForBranch } = require('../lib/branches');

// A registration is "untriaged" as long as nothing links this account to
// either an online client (subscribers) or a CRM lead (leads) yet — by
// whichever identity it actually has, since a self-registered account may
// carry an email, a phone, or both.
router.get('/api/admin/registrations', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.phone, u.name, u.created_at
         FROM users u
        WHERE u.tenant_id=? AND u.is_active=1
          AND NOT EXISTS (
            SELECT 1 FROM subscribers s
             WHERE s.tenant_id=u.tenant_id
               AND (s.firebase_uid=u.id
                 OR (u.email IS NOT NULL AND LOWER(TRIM(s.email))=LOWER(TRIM(u.email)))
                 OR (u.phone IS NOT NULL AND s.phone=u.phone))
          )
          AND NOT EXISTS (
            SELECT 1 FROM leads l
             WHERE l.tenant_id=u.tenant_id AND l.hidden=0
               AND ((u.email IS NOT NULL AND LOWER(TRIM(l.email))=LOWER(TRIM(u.email)))
                 OR (u.phone IS NOT NULL AND REGEXP_REPLACE(l.phone,'[^0-9]','')=u.phone))
          )
        ORDER BY u.created_at DESC
        LIMIT 500`,
      [tenantId]
    );
    res.json(rows);
  } catch (error) {
    logger.error('[registrations/list]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/registrations/:userId/convert-online', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const tenantId = req.tenantId;
    const { userId } = req.params;
    const branch = String(req.body?.branch || 'ONLINE_EGYPT');
    await conn.beginTransaction();
    const [[user]] = await conn.query(
      'SELECT id, email, phone, name FROM users WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1 FOR UPDATE',
      [userId, tenantId]
    );
    if (!user) { await conn.rollback(); return res.status(404).json({ error: 'Registration not found' }); }
    const [[existing]] = await conn.query(
      `SELECT id FROM subscribers WHERE tenant_id=? AND (firebase_uid=?
         OR (? IS NOT NULL AND LOWER(TRIM(email))=LOWER(TRIM(?)))
         OR (? IS NOT NULL AND phone=?)) LIMIT 1`,
      [tenantId, userId, user.email, user.email, user.phone, user.phone]
    );
    if (existing) { await conn.rollback(); return res.status(409).json({ error: 'Already an online client' }); }
    const subscriberId = uuidv4();
    const clientCode = await getNextClientCode(conn);
    await conn.query(
      `INSERT INTO subscribers
         (id, firebase_uid, client_code, name, email, phone, branch, branch_id, is_active, tenant_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,0,?,NOW())`,
      [subscriberId, userId, clientCode, (user.name || '').trim() || null, user.email, user.phone || '',
       branch, branchIdForBranch(branch), tenantId]
    );
    await conn.commit();
    logger.info(`[registrations] converted ${userId} to online client ${subscriberId}`);
    res.json({ ok: true, subscriberId });
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.error('[registrations/convert-online]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

router.post('/api/admin/registrations/:userId/convert-lead', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const tenantId = req.tenantId;
    const { userId } = req.params;
    const branch = String(req.body?.branch || 'ONLINE_EGYPT');
    await conn.beginTransaction();
    const [[user]] = await conn.query(
      'SELECT id, email, phone, name FROM users WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1 FOR UPDATE',
      [userId, tenantId]
    );
    if (!user) { await conn.rollback(); return res.status(404).json({ error: 'Registration not found' }); }
    const [[existing]] = await conn.query(
      `SELECT id FROM leads WHERE tenant_id=? AND hidden=0 AND (
         (? IS NOT NULL AND LOWER(TRIM(email))=LOWER(TRIM(?)))
         OR (? IS NOT NULL AND REGEXP_REPLACE(phone,'[^0-9]','')=?)
       ) LIMIT 1`,
      [tenantId, user.email, user.email, user.phone, user.phone]
    );
    if (existing) { await conn.rollback(); return res.status(409).json({ error: 'Already a lead' }); }
    const leadId = uuidv4();
    const clientCode = await getNextClientCode(conn);
    const salesRep = await getNextSalesRep(tenantId, conn, { branch });
    await conn.query(
      `INSERT INTO leads
         (id, tenant_id, client_code, name, email, phone, source, status, hidden,
          branch, branch_id, assigned_sales_id, assigned_sales_name, created_at)
       VALUES (?,?,?,?,?,?,'تسجيل دخول','new',0,?,?,?,?,NOW())`,
      [leadId, tenantId, clientCode, (user.name || '').trim() || (user.phone || '').trim() || 'عميل جديد',
       user.email, user.phone || '', branch, branchIdForBranch(branch),
       salesRep?.id || null, salesRep?.name || null]
    );
    await conn.commit();
    logger.info(`[registrations] converted ${userId} to lead ${leadId}`);
    res.json({ ok: true, leadId });
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.error('[registrations/convert-lead]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

module.exports = router;
