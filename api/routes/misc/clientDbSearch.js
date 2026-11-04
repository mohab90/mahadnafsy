'use strict';

// Where a person sits and who may link a site account to a client. The client database screen asks the server for its own search (routes/misc/clientDbList.js); the
// second «search the whole database» block that stood above it showed the same people twice and its route (GET /api/admin/client-db/search) is gone (4 Nov 2026).
// Below: the site-account link the staff make, and the button at the foot of every screen (GET /api/admin/client-lookup).

const express = require('express');
const { pool } = require('../../lib/db');
const logger = require('../../lib/logger');
const { requireAuth, requireAdminOrStaff, requirePermission, invalidateIdentity } = require('../../middleware/auth');
const { candidatesFor, linkSiteAccount } = require('../../lib/siteAccountLink');
const { actorName } = require('../../lib/clientHistory');
const { leadScope } = require('../../lib/leadAccess');
const { SEARCH_MIN_CHARS, foldText } = require('../../lib/searchText');
const { personMatch } = require('../../lib/systemSearch');
const { isArchiveSource } = require('../../lib/leadArchive');
const { resolveDataScope } = require('../../constants/permissions');
const { canBookAnyClient } = require('../../lib/bookingAccess');

const router = express.Router();

function subscriberPlace(row) {
  if (row.deleted_at) return 'أرشيف العملاء';
  if (Number(row.is_active) === 0) return 'عميل غير نشط';
  const branch = String(row.branch || '').toUpperCase();
  return branch === 'DAQQI' ? 'عميل الدقي' : branch === 'TAGAMOA' ? 'عميل التجمع' : 'عميل أونلاين';
}

function leadPlace(row) {
  if (row.merged_into_lead_id) return 'ليد مدمج في آخر';
  if (row.deleted_at || Number(row.hidden) === 1) return 'ليد محذوف';
  const status = String(row.status || '').toLowerCase();
  if (status === 'archived') return 'أرشيف الليدز';
  if (isArchiveSource(row.source)) {
    return /دولي/.test(row.source || '') || ['ONLINE_SAUDI', 'ONLINE_ABROAD'].includes(String(row.branch || '').toUpperCase())
      ? 'داتا سعودي' : 'محلي قديم';
  }
  if (status === 'converted') return 'ليد تحوّل لعميل';
  return 'عميل محتمل';
}

// «مفيش كورسات كأنها حساب جديد»: the client records a site account may belong to (by name), and the link a member of the staff makes (lib/siteAccountLink.js).
router.get('/api/admin/site-accounts/:userId/candidates', requireAuth, requireAdminOrStaff, requirePermission('view_client_db'), async (req, res) => {
  try {
    const found = await candidatesFor(pool, { tenantId: req.tenantId, userId: req.params.userId });
    if (!found) return res.status(404).json({ error: 'حساب الموقع مش موجود' });
    res.json({ account: { id: found.user.id, name: found.user.name, email: found.user.email, phone: found.user.phone }, candidates: found.candidates });
  } catch (e) {
    logger.error('[site-account-candidates]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/site-accounts/:userId/link', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  const conn = await pool.getConnection();
  let started = false;
  try {
    const subscriberId = String(req.body?.subscriberId || '');
    if (!subscriberId) return res.status(400).json({ error: 'اختار العميل' });
    await conn.beginTransaction();
    started = true;
    const result = await linkSiteAccount(conn, { tenantId: req.tenantId, userId: req.params.userId, subscriberId, force: req.body?.force === true, actor: actorName(req) });
    if (!result.ok) {
      await conn.rollback(); started = false;
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    await conn.commit(); started = false;
    invalidateIdentity(req.tenantId, req.params.userId);
    res.json({ ok: true, clientCode: result.clientCode, already: Boolean(result.already) });
  } catch (e) {
    if (started) await conn.rollback().catch(() => {});
    logger.error('[site-account-link]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// GET /api/admin/client-lookup?q= — «بحث»: the button at the foot of every screen.
//
// «ده للبحث داخل قاعدة العملاء بالكامل وللاسف مش شغال صح عند الموظفين وبيظهر
// عملاءهم فقط … يظهر كل العملاء علي الموقع من اول حرفين». The button matched the
// browser's loaded lists — a rep's own clients — and the database search under it
// needed view_client_db and the rep's own scope. So a rep booking a client who was
// already someone else's found nobody, and registered them a second time.
//
// This answers every staff account (the button is on all of them; every role holds
// manage_payments, which is what it books with), across every owner and branch, from
// the second letter: who the person is, where they sit in the system and WHO
// HAS THEM. It returns that and nothing more (no money, no notes, no history);
// whether the caller may open the file is told per row (canOpen), and the file
// itself stays behind its own checks (/api/staff/client/:code).

const LOOKUP_PER_KIND = 20;
const FULL_ACCESS_ROLES = ['online_manager', 'daqqi_manager', 'tagamoa_manager', 'manager'];

// Mirrors the opening rule of GET /api/staff/client/:code for a subscriber.
function canOpenSubscriber(req, row, linkedLead) {
  if (req.isSuperAdmin || canBookAnyClient(req)) return true;
  const staff = req.staffRecord;
  if (!staff) return false;
  const role = String(staff.role || '').toLowerCase();
  if (role === 'admin' || FULL_ACCESS_ROLES.includes(role)) return true;
  if (resolveDataScope(staff, { isSuperAdmin: false }) === 'all') return true;
  if (role === 'reception_daqqi' || role === 'reception_tagamoa') {
    const own = role === 'reception_tagamoa' ? 'TAGAMOA' : 'DAQQI';
    return String(row.branch || '').toUpperCase().replace(/[-\s]/g, '_') === own;
  }
  if (row.assigned_sales_id === staff.id || row.assigned_cs_id === staff.id) return true;
  return Boolean(linkedLead && (linkedLead.assigned_sales_id === staff.id || linkedLead.assigned_cs_id === staff.id));
}

// What a row IS, said once for every screen: a lead, or a subscriber of one of the three
// places the institute teaches in — «مشترك دي متنفعش، هو مشترك أونلاين ولا دقي؟».
function typeOf(kind, branch) {
  if (kind === 'lead') return { type: 'lead', typeLabel: 'ليد' };
  const key = String(branch || '').toUpperCase().replace(/[-\s]/g, '_');
  if (key === 'DAQQI') return { type: 'daqqi', typeLabel: 'مشترك الدقي' };
  if (key === 'TAGAMOA') return { type: 'tagamoa', typeLabel: 'مشترك التجمع' };
  return { type: 'online', typeLabel: 'مشترك أونلاين' };
}

// Who comes first: the name that starts with what was typed, then one with a word that does,
// then the rest; the caller's own before another's; a lead before a subscriber on a tie.
function rankOf(row, q) {
  const name = foldText(row.name || '');
  const starts = name.startsWith(q) ? 0 : name.split(/\s+/).some(word => word.startsWith(q)) ? 1 : 2;
  return starts * 4 + (row.mine ? 0 : 2) + (row.kind === 'lead' ? 0 : 1);
}

router.get('/api/admin/client-lookup', requireAuth, requireAdminOrStaff, requirePermission('manage_payments'), async (req, res) => {
  try {
    const q = foldText(String(req.query.q || '').slice(0, 80));
    if (q.length < SEARCH_MIN_CHARS) return res.json({ rows: [] });

    const subMatch = personMatch(q, 's', { withPhone2: true });
    const leadMatch = personMatch(q, 'l');
    const leadRange = leadScope(req, 'l');
    // Whether the caller's own lead scope reaches the row, asked of the same SQL
    // the lists use, so the two cannot disagree.
    const leadOpens = leadRange.none ? '0' : `(1=1${leadRange.sql})`;

    const [[subscribers], [leads]] = await Promise.all([
      pool.query(
        `SELECT s.id, s.client_code, s.name, s.phone, s.phone_slot, s.phone_shared_with, s.email, s.branch, s.is_active, s.assigned_sales_id, s.assigned_cs_id,
                COALESCE(cs.name, s.assigned_cs_name, sa.name, s.assigned_sales_name) AS owner_name,
                l.assigned_sales_id AS lead_sales_id, l.assigned_cs_id AS lead_cs_id
           FROM subscribers s
           LEFT JOIN staff cs ON cs.id = s.assigned_cs_id AND cs.tenant_id = s.tenant_id
           LEFT JOIN staff sa ON sa.id = s.assigned_sales_id AND sa.tenant_id = s.tenant_id
           LEFT JOIN leads l ON l.id = s.lead_id AND l.tenant_id = s.tenant_id
          WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND ${subMatch.sql}
          ORDER BY s.created_at DESC LIMIT ${LOOKUP_PER_KIND}`,
        [req.tenantId, ...subMatch.params]),
      // Hidden leads are people too — and the ones a rep would register a second time.
      pool.query(
        `SELECT l.id, l.client_code, l.name, l.phone, l.email, l.branch, l.status, l.source, l.hidden,
                ${leadOpens} AS can_open, COALESCE(st.name, l.assigned_sales_name) AS owner_name, l.assigned_sales_id
           FROM leads l
           LEFT JOIN staff st ON st.id = l.assigned_sales_id AND st.tenant_id = l.tenant_id
          WHERE l.tenant_id = ? AND l.deleted_at IS NULL
            AND l.merged_into_lead_id IS NULL AND ${leadMatch.sql}
          ORDER BY l.created_at DESC LIMIT ${LOOKUP_PER_KIND}`,
        [...(leadRange.none ? [] : leadRange.params), req.tenantId, ...leadMatch.params]),
    ]);

    // A lead that already became a client is shown once, as the client.
    const rows = [
      ...subscribers.map(s => ({
        kind: 'subscriber', ...typeOf('subscriber', s.branch), id: s.id, clientCode: s.client_code || null, name: s.name, phone: s.phone, email: s.email || null,
        place: subscriberPlace(s), branch: s.branch || null, owner: s.owner_name || null,
        // Two people on one number, on purpose (lib/phoneDuplicates.js): told on the row so nobody takes it for a duplicate.
        sharedPhone: Number(s.phone_slot) > 0 || Boolean(s.phone_shared_with),
        mine: Boolean(req.staffRecord && (s.assigned_sales_id === req.staffRecord.id || s.assigned_cs_id === req.staffRecord.id)),
        canOpen: canOpenSubscriber(req, s, { assigned_sales_id: s.lead_sales_id, assigned_cs_id: s.lead_cs_id }),
      })),
      ...leads.filter(l => String(l.status || '').toLowerCase() !== 'converted').map(l => ({
        kind: 'lead', ...typeOf('lead', l.branch), id: l.id, clientCode: l.client_code || null, name: l.name, phone: l.phone, email: l.email || null,
        place: Number(l.hidden) === 1 ? 'ليد مخفي' : leadPlace(l), branch: l.branch || null, owner: l.owner_name || null,
        mine: Boolean(req.staffRecord && l.assigned_sales_id === req.staffRecord.id),
        // A hidden lead is shown so nobody registers the person twice, but has no file page to open.
        // Customer service and the Dokki desk open any lead (lib/bookingAccess.js); the rest only their own.
        canOpen: Number(l.hidden) === 1 ? false : (req.isSuperAdmin || canBookAnyClient(req)) ? true : Number(l.can_open) === 1,
      })),
    ].sort((a, b) => rankOf(a, q) - rankOf(b, q));
    res.json({ rows, capped: subscribers.length === LOOKUP_PER_KIND || leads.length === LOOKUP_PER_KIND });
  } catch (e) {
    logger.error('[client-lookup]', e.message);
    res.status(500).json({ error: 'تعذّر البحث، حاول مرة أخرى' });
  }
});

module.exports = router;
