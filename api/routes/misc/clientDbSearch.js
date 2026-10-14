'use strict';

// GET /api/admin/client-db/search?q= — every person the institute holds, in one
// search: clients (active, inactive and archived), leads (on the table, archived,
// imported archives, hidden, merged) and accounts that signed up on the site and
// are neither yet.
//
// «قاعدة البيانات يكون فيها كل العملاء لما اعمل بحث يظهر بتوع تسجيل الدخول وعملاء
// الارشيف ويظهر مصدر كل واحد». The client database screen assembled its list in
// the browser from the subscriber and lead arrays — and an online customer
// service account holds no view_leads, so it saw no leads and no registrations at
// all, and nobody saw an archived lead there. This needs view_client_db only and
// returns read-only rows; it grants no lead management.

const express = require('express');
const { pool } = require('../../lib/db');
const logger = require('../../lib/logger');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { financialScopeClause, resolveFinancialScope } = require('../../lib/financialScope');
const { leadScope } = require('../../lib/leadAccess');
const { SEARCH_MIN_CHARS, foldText } = require('../../lib/searchText');
const { personMatch } = require('../../lib/systemSearch');
const { isArchiveSource } = require('../../lib/leadArchive');
const { resolveDataScope } = require('../../constants/permissions');

const router = express.Router();
const PER_KIND = 50;

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

router.get('/api/admin/client-db/search', requireAuth, requireAdminOrStaff, requirePermission('view_client_db'), async (req, res) => {
  try {
    const q = foldText(req.query.q);
    if (q.length < SEARCH_MIN_CHARS) return res.json({ rows: [] });
    // Matched as the header's search matches a person (lib/systemSearch.js): a
    // phone number by every spelling it can be stored as; other text by
    // substring, read as every list reads it (lib/searchText.js).
    // The caller's own scope, as the global search applies it.
    const subScope = financialScopeClause(
      resolveFinancialScope(req, { allowAssigned: true }),
      { branchColumn: 's.branch_id', subscriberAlias: 's' }
    );
    const leadRange = leadScope(req, 'l');

    const subMatch = personMatch(q, 's');
    const leadMatch = personMatch(q, 'l');
    const userMatch = personMatch(q, 'u', { withCode: false });

    const [[subscribers], [leads], [users]] = await Promise.all([
      subScope.sql === ' AND 1=0' ? [[]] : pool.query(
        `SELECT s.id, s.client_code, s.name, s.phone, s.email, s.branch, s.source, s.is_active, s.deleted_at, s.created_at,
                st.name AS owner_name
           FROM subscribers s
           LEFT JOIN staff st ON st.id = s.assigned_cs_id AND st.tenant_id = s.tenant_id
          WHERE s.tenant_id = ? AND ${subMatch.sql}${subScope.sql}
          ORDER BY s.created_at DESC LIMIT ${PER_KIND}`,
        [req.tenantId, ...subMatch.params, ...subScope.params]),
      leadRange.none ? [[]] : pool.query(
        `SELECT l.id, l.client_code, l.name, l.phone, l.email, l.branch, l.source, l.status, l.hidden, l.deleted_at,
                l.merged_into_lead_id, l.created_at, COALESCE(st.name, l.assigned_sales_name) AS owner_name
           FROM leads l
           LEFT JOIN staff st ON st.id = l.assigned_sales_id AND st.tenant_id = l.tenant_id
          WHERE l.tenant_id = ? AND ${leadMatch.sql}${leadRange.sql}
          ORDER BY l.created_at DESC LIMIT ${PER_KIND}`,
        [req.tenantId, ...leadMatch.params, ...leadRange.params]),
      // Accounts not yet a client: no subscriber claims them by uid. Staff logins are not customers.
      pool.query(
        `SELECT u.id, u.name, u.phone, u.email, u.created_at
           FROM users u
          WHERE u.tenant_id = ? AND u.is_active = 1 AND ${userMatch.sql}
            AND NOT EXISTS (SELECT 1 FROM subscribers s WHERE s.tenant_id = u.tenant_id AND s.firebase_uid = u.id)
            AND NOT EXISTS (SELECT 1 FROM staff st WHERE st.tenant_id = u.tenant_id AND st.deleted_at IS NULL
                             AND st.email <> '' AND st.email = u.email)
          ORDER BY u.created_at DESC LIMIT ${PER_KIND}`,
        [req.tenantId, ...userMatch.params]),
    ]);

    const rows = [
      ...subscribers.map(s => ({
        kind: 'subscriber', id: s.id, clientCode: s.client_code || null, name: s.name, phone: s.phone, email: s.email,
        branch: s.branch, source: s.source || null, place: subscriberPlace(s), owner: s.owner_name || null, createdAt: s.created_at,
      })),
      ...leads.map(l => ({
        kind: 'lead', id: l.id, clientCode: l.client_code || null, name: l.name, phone: l.phone, email: l.email,
        branch: l.branch, source: l.source || null, status: l.status, place: leadPlace(l), owner: l.owner_name || null, createdAt: l.created_at,
      })),
      ...users.map(u => ({
        kind: 'registration', id: u.id, clientCode: null, name: u.name, phone: u.phone, email: u.email,
        branch: null, source: 'تسجيل دخول بالموقع', place: 'تسجيل دخول بالموقع', owner: null, createdAt: u.created_at,
      })),
    ];
    res.json({ rows, capped: subscribers.length === PER_KIND || leads.length === PER_KIND || users.length === PER_KIND });
  } catch (e) {
    logger.error('[client-db-search]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
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
  if (req.isSuperAdmin) return true;
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

    const subMatch = personMatch(q, 's');
    const leadMatch = personMatch(q, 'l');
    const leadRange = leadScope(req, 'l');
    // Whether the caller's own lead scope reaches the row, asked of the same SQL
    // the lists use, so the two cannot disagree.
    const leadOpens = leadRange.none ? '0' : `(1=1${leadRange.sql})`;

    const [[subscribers], [leads]] = await Promise.all([
      pool.query(
        `SELECT s.id, s.client_code, s.name, s.phone, s.email, s.branch, s.is_active, s.assigned_sales_id, s.assigned_cs_id,
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
        mine: Boolean(req.staffRecord && (s.assigned_sales_id === req.staffRecord.id || s.assigned_cs_id === req.staffRecord.id)),
        canOpen: canOpenSubscriber(req, s, { assigned_sales_id: s.lead_sales_id, assigned_cs_id: s.lead_cs_id }),
      })),
      ...leads.filter(l => String(l.status || '').toLowerCase() !== 'converted').map(l => ({
        kind: 'lead', ...typeOf('lead', l.branch), id: l.id, clientCode: l.client_code || null, name: l.name, phone: l.phone, email: l.email || null,
        place: Number(l.hidden) === 1 ? 'ليد مخفي' : leadPlace(l), branch: l.branch || null, owner: l.owner_name || null,
        mine: Boolean(req.staffRecord && l.assigned_sales_id === req.staffRecord.id),
        // A hidden lead is shown so nobody registers the person twice, but has no file page to open.
        canOpen: Number(l.hidden) === 1 ? false : req.isSuperAdmin ? true : Number(l.can_open) === 1,
      })),
    ].sort((a, b) => rankOf(a, q) - rankOf(b, q));
    res.json({ rows, capped: subscribers.length === LOOKUP_PER_KIND || leads.length === LOOKUP_PER_KIND });
  } catch (e) {
    logger.error('[client-lookup]', e.message);
    res.status(500).json({ error: 'تعذّر البحث، حاول مرة أخرى' });
  }
});

module.exports = router;
