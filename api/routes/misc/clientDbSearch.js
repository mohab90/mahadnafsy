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
const { identitySpellings } = require('../../lib/phoneNumber');
const { SEARCH_MIN_CHARS, foldText, foldedSql, searchNumber } = require('../../lib/searchText');
const { isArchiveSource } = require('../../lib/leadArchive');

const router = express.Router();
const PER_KIND = 50;

const escapeLike = value => String(value).replace(/[\\%_]/g, match => `\\${match}`);

function subscriberPlace(row) {
  if (row.deleted_at) return 'أرشيف العملاء';
  if (Number(row.is_active) === 0) return 'عميل غير نشط';
  return String(row.branch || '').toUpperCase() === 'DAQQI' ? 'عميل الدقي' : 'عميل أونلاين';
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
    const number = searchNumber(q);
    const digits = number ? number.digits : '';
    // A phone number is matched by every spelling it can be stored as; other text
    // by substring, read as every list reads it (lib/searchText.js): «احمد» finds
    // «أحمد», and a shorter number its digits with or without the 0.
    const byPhone = digits.length >= 8 ? [...new Set([digits, ...identitySpellings(digits)])] : null;
    const like = `%${escapeLike(q)}%`;
    const shortNumber = number && !byPhone ? `%${number.core}%` : null;
    const textMatch = (column, withCode) => ({
      sql: `(${foldedSql(`${column}.name`)} LIKE ? OR LOWER(COALESCE(${column}.email, '')) LIKE ?`
        + (withCode ? ` OR LOWER(COALESCE(${column}.client_code, '')) LIKE ?` : '')
        + (shortNumber ? ` OR REGEXP_REPLACE(COALESCE(${column}.phone, ''), '[^0-9]', '') LIKE ?` : '') + ')',
      params: [like, like, ...(withCode ? [like] : []), ...(shortNumber ? [shortNumber] : [])],
    });
    const match = column => (byPhone
      ? { sql: `(${column}.phone IN (?) OR ${column}.phone LIKE ?)`, params: [byPhone, `%${escapeLike(digits.slice(-9))}%`] }
      : textMatch(column, true));

    // The caller's own scope, as the global search applies it.
    const subScope = financialScopeClause(
      resolveFinancialScope(req, { allowAssigned: true }),
      { branchColumn: 's.branch_id', subscriberAlias: 's' }
    );
    const leadRange = leadScope(req, 'l');

    const subMatch = match('s');
    const leadMatch = match('l');
    const userMatch = byPhone
      ? { sql: '(u.phone IN (?) OR u.phone LIKE ?)', params: [byPhone, `%${escapeLike(digits.slice(-9))}%`] }
      : textMatch('u', false);

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

module.exports = router;
