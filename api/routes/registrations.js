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
const { findLeadByContact, phoneIdentityClause } = require('../lib/leadMatching');
const { branchIdForBranch } = require('../lib/branches');
const { normalizeBranch, isBranch } = require('../constants/branches');
const { toIdentity } = require('../lib/phoneNumber');

/**
 * The branch a registration is being converted into, validated against the enum.
 *
 * Both conversion routes took whatever string the body carried straight into the
 * insert and into branchIdForBranch. subscribers.branch is an enum, so a typo
 * either errored as an opaque 500 or landed empty — and an empty branch is
 * invisible: العملاء الأونلاين and the الدقي round picker both select on branch,
 * so the conversion would report success and the customer would appear on
 * neither screen.
 *
 * It is also the field that decides which screen a converted client belongs to,
 * which is what makes DAQQI a legitimate destination here and not only online.
 * Returns null when the caller named a branch that does not exist, so the route
 * can say so instead of writing it.
 */
function requestedBranch(body) {
  if (body?.branch === undefined || body?.branch === null || body?.branch === '') return 'ONLINE_EGYPT';
  const branch = normalizeBranch(body.branch);
  return branch && isBranch(branch) ? branch : null;
}

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
      // Archived leads count as known too. Matching only hidden=0 put every
      // registration whose lead had been archived back at the top of this
      // queue as if it were new: 202 rows where 94 needed action, so 108 were
      // dismissed work reappearing, and converting one would have created a
      // second lead for someone a colleague had deliberately archived.
      //
      // lib/reconcileChecks.js settled this question already — its own comment
      // records the same hidden=0 comparison inflating its count from 53 to
      // 173 — and this is the same question, so it gets the same answer.
      pool.query(
        `SELECT email, phone FROM leads WHERE tenant_id=?`,
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
    const branch = requestedBranch(req.body);
    if (!branch) return res.status(400).json({ error: 'فرع غير معروف' });
    await conn.beginTransaction();
    const [[user]] = await conn.query(
      'SELECT id, email, phone, name FROM users WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1 FOR UPDATE',
      [userId, tenantId]
    );
    if (!user) { await conn.rollback(); return res.status(404).json({ error: 'Registration not found' }); }
    // Same comparison as the lead side, for the same reason. This one was worse:
    // `phone=?` compared the stored string with the account's string, so any
    // difference in how the number was written — a country code, a space —
    // meant an existing client was not found and a second record was created.
    // The NULL-guard on email let one empty address match another besides.
    const phoneClause = phoneIdentityClause(user.phone);
    const cleanEmail = String(user.email || '').trim();
    const terms = ['firebase_uid=?'];
    const values = [userId];
    if (cleanEmail) { terms.push('LOWER(TRIM(email))=LOWER(?)'); values.push(cleanEmail.toLowerCase()); }
    if (phoneClause) { terms.push(phoneClause.sql); values.push(...phoneClause.params); }
    const [[existing]] = await conn.query(
      `SELECT id FROM subscribers WHERE tenant_id=? AND (${terms.join(' OR ')}) LIMIT 1`,
      [tenantId, ...values]
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
      // NULL, never '': uq_subs_tenant_phone lets any number of NULLs through
       // and exactly one ''. With one blank already stored, every registration
       // without a phone failed here — six times in the August logs.
       [subscriberId, userId, clientCode, (user.name || '').trim() || null, user.email, toIdentity(user.phone) || null,
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
    const branch = requestedBranch(req.body);
    if (!branch) return res.status(400).json({ error: 'فرع غير معروف' });
    await conn.beginTransaction();
    const [[user]] = await conn.query(
      'SELECT id, email, phone, name FROM users WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1 FOR UPDATE',
      [userId, tenantId]
    );
    if (!user) { await conn.rollback(); return res.status(404).json({ error: 'Registration not found' }); }
    // The shared matcher, not a second attempt at the same comparison.
    //
    // This used to strip non-digits from the stored phone and compare it with
    // the account's phone exactly as typed, so 01006627192 never met
    // +201006627192 and the same person was written down twice: once by the
    // campaign that found them, once by their own signup. Six live pairs — the
    // marketing lead sitting at "new" beside a "converted" duplicate. Its
    // NULL-guard on email also let one empty address match another, which is
    // the bug already documented at routes/admin/subscribers.js:606.
    const existing = await findLeadByContact(conn, {
      tenantId, phone: user.phone, email: user.email,
    });
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
       user.email, toIdentity(user.phone) || null, branch, branchIdForBranch(branch),
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
         (SELECT 1 FROM leads l WHERE l.tenant_id=?
            AND ((? IS NOT NULL AND LOWER(TRIM(l.email))=LOWER(TRIM(?)))
              OR (? IS NOT NULL AND REGEXP_REPLACE(l.phone,'[^0-9]','')=?)) LIMIT 1) AS has_lead`,
      [tenantId, userId, user.email, user.email, user.phone, user.phone,
       tenantId, user.email, user.email, user.phone, user.phone]
    );
    // An archived lead counts as claimed here too: the person is known, and a
    // login belonging to someone a colleague already triaged is not this
    // route's to delete. The listing above uses the same definition.
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
