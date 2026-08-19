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
const { toIdentity } = require('../lib/phoneNumber');
const { phoneIdentityClause } = require('../lib/leadMatching');

const normEmail = (v) => (v || '').toString().trim().toLowerCase() || null;
const normPhone = (v) => (v || '').toString().replace(/[^0-9]/g, '') || null;

// Same pattern lib/phoneNumber.js strips the Egyptian country code against —
// a bare 10-digit local mobile means "registered from Egypt"; anything else
// (a number that kept its own country code) means abroad. Best-effort only:
// a VPN or a Saudi-based Egyptian expat typing their EG number will read as
// "محلي" either way, since a phone number is the only signal a self-
// registration carries. Good enough to pre-sort which branch bucket
// (ONLINE_EGYPT vs ONLINE_ABROAD/ONLINE_SAUDI) staff should default to.
const EG_MOBILE_NATIONAL = /^1[0125]\d{8}$/;
function originForPhone(phone) {
  const identity = toIdentity(phone);
  if (!identity) return null;
  return EG_MOBILE_NATIONAL.test(identity) ? 'محلي' : 'دولي';
}

// A registration is "untriaged" as long as nothing links this account to
// either an online client (subscribers) or a CRM lead (leads) yet — by
// whichever identity it actually has, since a self-registered account may
// carry an email, a phone, or both.
//
// This used to be one query with two correlated NOT EXISTS subqueries, each
// comparing LOWER(TRIM(...)) / REGEXP_REPLACE(...) against an indexed
// column — wrapping an indexed column in a function defeats the index, so
// every row of `users` drove a near-full scan of `leads` and `subscribers`
// (6.6s against a users table of only ~1,500 rows). Loading the claimed
// identifiers once as JS Sets and filtering in memory turns that into three
// flat, fully-indexed queries — the actual matching cost is now O(1) per
// user instead of O(leads + subscribers) per user.
router.get('/api/admin/registrations', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const [usersResult, subsResult, leadsResult] = await Promise.all([
      pool.query(
        `SELECT id, email, phone, name, created_at FROM users
          WHERE tenant_id=? AND is_active=1 ORDER BY created_at DESC LIMIT 2000`,
        [tenantId]
      ),
      pool.query(
        `SELECT firebase_uid, email, phone FROM subscribers WHERE tenant_id=?`,
        [tenantId]
      ),
      pool.query(
        `SELECT email, phone FROM leads WHERE tenant_id=? AND hidden=0`,
        [tenantId]
      ),
    ]);
    const [users] = usersResult;
    const [subs] = subsResult;
    const [leads] = leadsResult;

    const claimedUids = new Set(subs.map(s => s.firebase_uid).filter(Boolean));
    const claimedEmails = new Set([
      ...subs.map(s => normEmail(s.email)).filter(Boolean),
      ...leads.map(l => normEmail(l.email)).filter(Boolean),
    ]);
    const claimedPhones = new Set([
      ...subs.map(s => normPhone(s.phone)).filter(Boolean),
      ...leads.map(l => normPhone(l.phone)).filter(Boolean),
    ]);

    const rows = users.filter(u => {
      if (claimedUids.has(u.id)) return false;
      const email = normEmail(u.email);
      if (email && claimedEmails.has(email)) return false;
      const phone = normPhone(u.phone);
      if (phone && claimedPhones.has(phone)) return false;
      return true;
    }).slice(0, 500).map(u => ({ ...u, origin: originForPhone(u.phone) }));

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
    // is_active=1. This used to insert 0, and the online-clients list drops
    // anything inactive (`if (s.isActive === false) return false`) — so the
    // conversion reported success and the customer then appeared nowhere.
    // Converting is already a deliberate staff action; there is nothing left to
    // gate behind an inactive flag.
    //
    // clientStatus='active' in crm_json for the same reason: the view tabs in
    // OnlineClientsTab switch on it, and a row with no status falls through
    // every named tab.
    await conn.query(
      `INSERT INTO subscribers
         (id, firebase_uid, client_code, name, email, phone, branch, branch_id, is_active, tenant_id, created_at, crm_json, source)
       VALUES (?,?,?,?,?,?,?,?,1,?,NOW(),?,?)`,
      [subscriberId, userId, clientCode, (user.name || '').trim() || null, user.email, user.phone || '',
       branch, branchIdForBranch(branch), tenantId,
       JSON.stringify({ clientStatus: 'active', convertedFromRegistrationId: userId, convertedAt: new Date().toISOString() }),
       'تسجيل موقع']
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
    // The phone half compared an *identity* (users.phone, country code and trunk
    // zero already stripped) against a lead's raw digits, so a lead stored as
    // 01012345678 never equalled the same person's 1012345678 and this duplicate
    // check quietly passed — which is how the same customer ends up as two
    // leads. phoneIdentityClause compares every spelling of the one number.
    const phoneMatch = phoneIdentityClause(user.phone);
    const [[existing]] = await conn.query(
      `SELECT id FROM leads WHERE tenant_id=? AND hidden=0 AND (
         (? IS NOT NULL AND LOWER(TRIM(email))=LOWER(TRIM(?)))
         OR ${phoneMatch ? phoneMatch.sql : '1=0'}
       ) LIMIT 1`,
      [tenantId, user.email, user.email, ...(phoneMatch ? phoneMatch.params : [])]
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

// DELETE /api/admin/registrations/:userId — discard a registration outright
// (spam signups, wrong numbers, duplicates typed twice). Re-checks it is
// still untriaged under the same rules as the list query before deleting —
// never delete a users row that a lead or subscriber now depends on.
router.delete('/api/admin/registrations/:userId', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { userId } = req.params;
    const [[user]] = await pool.query(
      'SELECT id, email, phone FROM users WHERE id=? AND tenant_id=? LIMIT 1',
      [userId, tenantId]
    );
    if (!user) return res.status(404).json({ error: 'Registration not found' });
    const [[claimed]] = await pool.query(
      `SELECT
         (SELECT 1 FROM subscribers s WHERE s.tenant_id=? AND (s.firebase_uid=?
            OR (? IS NOT NULL AND LOWER(TRIM(s.email))=LOWER(TRIM(?)))
            OR (? IS NOT NULL AND s.phone=?)) LIMIT 1) AS has_subscriber,
         (SELECT 1 FROM leads l WHERE l.tenant_id=? AND l.hidden=0
            AND ((? IS NOT NULL AND LOWER(TRIM(l.email))=LOWER(TRIM(?)))
              OR (? IS NOT NULL AND REGEXP_REPLACE(l.phone,'[^0-9]','')=?)) LIMIT 1) AS has_lead`,
      [tenantId, userId, user.email, user.email, user.phone, user.phone,
       tenantId, user.email, user.email, user.phone, user.phone]
    );
    if (claimed.has_subscriber || claimed.has_lead) {
      return res.status(409).json({ error: 'الحساب ده اتحوّل بالفعل، مينفعش يتحذف من هنا' });
    }
    await pool.query('DELETE FROM users WHERE id=? AND tenant_id=?', [userId, tenantId]);
    logger.info(`[registrations] deleted untriaged registration ${userId}`);
    res.json({ ok: true });
  } catch (error) {
    logger.error('[registrations/delete]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
