'use strict';

// «قاعدة العملاء الموحدة»: the numbers and the list of the client database, from the server. The screen counted what its browser had loaded — 500 clients and 500
// leads — and showed that as «الإجمالي 989 · مشتركون 505 · أونلاين 270 · الدقي 235» while the institute holds thousands (3 Nov 2026: «لازم يسمع في القاعدة كل
// عملاء السيستم»). The three screens of clients (this one, عملاء الأونلاين, عملاء الدقي) are all `subscribers`; this one adds the leads and the site sign-ups.
//
//   GET /api/admin/client-db/summary — the real counts.
//   GET /api/admin/client-db/page    — one page of people (clients, leads, sign-ups) with the filters of the screen, in the caller's own scope.

const express = require('express');
const { pool } = require('../../lib/db');
const logger = require('../../lib/logger');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { financialScopeClause, resolveFinancialScope } = require('../../lib/financialScope');
const { leadScope } = require('../../lib/leadAccess');
const { foldText } = require('../../lib/searchText');
const { personMatch } = require('../../lib/systemSearch');
const { hasPermission } = require('../../constants/permissions');
const { CONVERTED_SQL } = require('../../lib/leadStatuses');

const router = express.Router();
const PAGE_MAX = 100;

/** The kind of client a record is — online, Dokki or the regular branch — by the same rule as the screen's getSubType: the client type first, then the branch. */
function subTypeSql(alias) {
  const type = `UPPER(COALESCE(${alias}.client_type, ''))`;
  const branch = `UPPER(COALESCE(${alias}.branch, ''))`;
  return `(CASE
    WHEN ${type} = 'QATAMIYA' THEN 'regular'
    WHEN ${type} LIKE 'DAQQI%' THEN 'daqqi'
    WHEN ${type} LIKE 'ONLINE%' OR ${type} LIKE 'LEAD_LOCAL%' OR ${type} LIKE 'LEAD_INTL%' THEN 'online'
    WHEN ${branch} IN ('', 'OTHER') THEN 'online'
    WHEN ${branch} LIKE 'DAQQI%' OR ${branch} = 'TAGAMOA' THEN 'daqqi'
    WHEN ${branch} = 'QATAMIYA' THEN 'regular'
    ELSE 'online' END)`;
}

/** The three populations with the caller's reach; a population the caller may not see is absent. */
function populations(req) {
  const staff = req.staffRecord || null;
  const holds = permission => req.isSuperAdmin || hasPermission(staff, permission);
  const out = {};
  const subScope = financialScopeClause(resolveFinancialScope(req, { allowAssigned: true }), { branchColumn: 's.branch_id', subscriberAlias: 's' });
  if (subScope.sql !== ' AND 1=0') {
    out.subscriber = { where: `s.deleted_at IS NULL${subScope.sql}`, params: subScope.params };
  }
  const range = leadScope(req, 'l');
  if (!range.none && holds('view_leads')) {
    // Not the ones that became clients, are archived, hidden or merged, nor a person already a client by number (the screen drew them once).
    out.lead = {
      where: `l.deleted_at IS NULL AND l.hidden = 0 AND l.merged_into_lead_id IS NULL AND l.status NOT IN ${CONVERTED_SQL} AND l.status <> 'archived'${range.sql}
              AND NOT EXISTS (SELECT 1 FROM subscribers s2 WHERE s2.tenant_id = l.tenant_id AND s2.deleted_at IS NULL AND l.phone_digits <> '' AND s2.phone_digits = l.phone_digits COLLATE utf8mb4_unicode_ci)`,
      params: range.params,
    };
  }
  if (holds('view_leads')) {
    // Accounts that signed up on the site and are neither a client nor a member of the staff.
    out.registration = {
      where: `u.is_active = 1
              AND NOT EXISTS (SELECT 1 FROM subscribers s WHERE s.tenant_id = u.tenant_id AND s.firebase_uid = u.id)
              AND NOT EXISTS (SELECT 1 FROM staff st WHERE st.tenant_id = u.tenant_id AND st.deleted_at IS NULL AND st.email <> '' AND st.email = u.email)`,
      params: [],
    };
  }
  return out;
}

router.get('/api/admin/client-db/summary', requireAuth, requireAdminOrStaff, requirePermission('view_client_db'), async (req, res) => {
  try {
    const pop = populations(req);
    const [subs, leads, registrations] = await Promise.all([
      pop.subscriber ? pool.query(
        `SELECT COUNT(*) AS total, COALESCE(SUM(${subTypeSql('s')} = 'online'), 0) AS online, COALESCE(SUM(${subTypeSql('s')} = 'daqqi'), 0) AS daqqi,
                COALESCE(SUM(${subTypeSql('s')} = 'regular'), 0) AS regular
           FROM subscribers s WHERE s.tenant_id = ? AND ${pop.subscriber.where}`, [req.tenantId, ...pop.subscriber.params]) : [[{ total: 0, online: 0, daqqi: 0, regular: 0 }]],
      pop.lead ? pool.query(`SELECT COUNT(*) AS total FROM leads l WHERE l.tenant_id = ? AND ${pop.lead.where}`, [req.tenantId, ...pop.lead.params]) : [[{ total: 0 }]],
      pop.registration ? pool.query(`SELECT COUNT(*) AS total FROM users u WHERE u.tenant_id = ? AND ${pop.registration.where}`, [req.tenantId, ...pop.registration.params]) : [[{ total: 0 }]],
    ]);
    const s = subs[0][0];
    const summary = {
      subscribers: Number(s.total) || 0, online: Number(s.online) || 0, daqqi: Number(s.daqqi) || 0, regular: Number(s.regular) || 0,
      leads: Number(leads[0][0].total) || 0, registrations: Number(registrations[0][0].total) || 0,
    };
    res.json({ ...summary, total: summary.subscribers + summary.leads + summary.registrations });
  } catch (error) {
    logger.error('[client-db-summary]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const SORTS = {
  date_desc: 't.created_at DESC, t.id',
  date_asc: 't.created_at ASC, t.id',
  name_asc: 't.name ASC, t.id',
};

router.get('/api/admin/client-db/page', requireAuth, requireAdminOrStaff, requirePermission('view_client_db'), async (req, res) => {
  try {
    const type = String(req.query.type || 'all');
    const branch = String(req.query.branch || '').toUpperCase();
    const course = String(req.query.course || '');
    const q = foldText(String(req.query.q || '').slice(0, 80));
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), PAGE_MAX);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const order = SORTS[String(req.query.sort || 'date_desc')] || SORTS.date_desc;
    const pop = populations(req);

    const parts = [];
    if (pop.subscriber && ['all', 'subscriber', 'subscriber_online', 'subscriber_daqqi', 'subscriber_regular'].includes(type)) {
      const filters = [];
      const params = [];
      if (type !== 'all' && type !== 'subscriber') { filters.push(`${subTypeSql('s')} = ?`); params.push(type.replace('subscriber_', '')); }
      if (branch) { filters.push("UPPER(COALESCE(s.branch, '')) = ?"); params.push(branch); }
      if (course) { filters.push('EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id = s.tenant_id AND e.subscriber_id = s.id AND e.course_id = ?)'); params.push(course); }
      if (q) { const match = personMatch(q, 's', { withPhone2: true }); filters.push(match.sql); params.push(...match.params); }
      parts.push({
        sql: `SELECT 'subscriber' AS kind, s.id COLLATE utf8mb4_unicode_ci AS id, s.client_code COLLATE utf8mb4_unicode_ci AS client_code, s.name COLLATE utf8mb4_unicode_ci AS name, s.phone COLLATE utf8mb4_unicode_ci AS phone, s.email COLLATE utf8mb4_unicode_ci AS email, s.branch COLLATE utf8mb4_unicode_ci AS branch,
                     s.client_type COLLATE utf8mb4_unicode_ci AS client_type, 'مشترك' AS status, s.created_at, COALESCE(s.assigned_sales_name, '') COLLATE utf8mb4_unicode_ci AS sales_name
                FROM subscribers s WHERE s.tenant_id = ? AND ${pop.subscriber.where}${filters.length ? ` AND ${filters.join(' AND ')}` : ''}`,
        params: [req.tenantId, ...pop.subscriber.params, ...params],
      });
    }
    // A course filter is about what a client bought: a lead has none, and a sign-up has none.
    if (pop.lead && !course && ['all', 'lead', 'lead_local', 'lead_intl'].includes(type)) {
      const filters = [];
      const params = [];
      if (type === 'lead_local') filters.push("l.client_type LIKE '%LOCAL%'");
      if (type === 'lead_intl') filters.push("l.client_type LIKE '%INTL%'");
      if (branch) { filters.push("UPPER(COALESCE(l.branch, '')) = ?"); params.push(branch); }
      if (q) { const match = personMatch(q, 'l'); filters.push(match.sql); params.push(...match.params); }
      parts.push({
        sql: `SELECT 'lead' AS kind, l.id COLLATE utf8mb4_unicode_ci AS id, l.client_code COLLATE utf8mb4_unicode_ci AS client_code, l.name COLLATE utf8mb4_unicode_ci AS name, l.phone COLLATE utf8mb4_unicode_ci AS phone, l.email COLLATE utf8mb4_unicode_ci AS email, l.branch COLLATE utf8mb4_unicode_ci AS branch,
                     l.client_type COLLATE utf8mb4_unicode_ci AS client_type, l.status COLLATE utf8mb4_unicode_ci AS status, l.created_at, COALESCE(l.assigned_sales_name, '') COLLATE utf8mb4_unicode_ci AS sales_name
                FROM leads l WHERE l.tenant_id = ? AND ${pop.lead.where}${filters.length ? ` AND ${filters.join(' AND ')}` : ''}`,
        params: [req.tenantId, ...pop.lead.params, ...params],
      });
    }
    if (pop.registration && !course && !branch && ['all', 'registration'].includes(type)) {
      const filters = [];
      const params = [];
      if (q) { const match = personMatch(q, 'u', { withCode: false }); filters.push(match.sql); params.push(...match.params); }
      parts.push({
        sql: `SELECT 'registration' AS kind, u.id COLLATE utf8mb4_unicode_ci AS id, NULL AS client_code, u.name COLLATE utf8mb4_unicode_ci AS name, u.phone COLLATE utf8mb4_unicode_ci AS phone, u.email COLLATE utf8mb4_unicode_ci AS email, NULL AS branch, NULL AS client_type, 'registration' AS status,
                     u.created_at, '' AS sales_name
                FROM users u WHERE u.tenant_id = ? AND ${pop.registration.where}${filters.length ? ` AND ${filters.join(' AND ')}` : ''}`,
        params: [req.tenantId, ...pop.registration.params, ...params],
      });
    }
    if (!parts.length) return res.json({ rows: [], total: 0 });

    // Each text column of the union names one collation: the three tables do not all hold theirs in the same one on every database, and a UNION of two refuses (the
    // release's staging run showed it for the new table's columns, 3 Nov 2026).
    const union = parts.map(part => part.sql).join(' UNION ALL ');
    const unionParams = parts.flatMap(part => part.params);
    const [[count], [page]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM (${union}) t`, unionParams).then(([rows]) => [rows[0]]),
      pool.query(`SELECT t.* FROM (${union}) t ORDER BY ${order} LIMIT ? OFFSET ?`, [...unionParams, limit, offset]),
    ]);

    // What the page's clients have paid and which courses they hold — for these rows only.
    const clientIds = page.filter(row => row.kind === 'subscriber').map(row => row.id);
    const paid = new Map();
    const courses = new Map();
    const papers = new Map();
    if (clientIds.length) {
      const [[payments], [enrolments], [bundles], [files]] = await Promise.all([
        pool.query(
          `SELECT subscriber_id, COALESCE(SUM(amount_egp), 0) AS paid FROM payments
            WHERE tenant_id = ? AND subscriber_id IN (?) AND status = 'paid' AND deleted_at IS NULL GROUP BY subscriber_id`, [req.tenantId, clientIds]),
        pool.query(
          `SELECT e.subscriber_id, e.course_id, c.title FROM enrollments e JOIN courses c ON c.id = e.course_id AND c.tenant_id = e.tenant_id
            WHERE e.tenant_id = ? AND e.subscriber_id IN (?) AND e.course_id IS NOT NULL`, [req.tenantId, clientIds]),
        pool.query(
          `SELECT DISTINCT p.subscriber_id, b.title FROM payments p JOIN bundles b ON b.id = p.bundle_id AND b.tenant_id = p.tenant_id
            WHERE p.tenant_id = ? AND p.subscriber_id IN (?) AND p.bundle_id IS NOT NULL AND p.status = 'paid' AND p.deleted_at IS NULL`, [req.tenantId, clientIds]),
        // The names and papers the export carries; a picture is a link, never an inline image (those are megabytes a row).
        pool.query(
          `SELECT id, name_en, national_id, CASE WHEN personal_photo_url LIKE 'http%' THEN personal_photo_url END AS personal_photo_url,
                  CASE WHEN id_photo_url LIKE 'http%' THEN id_photo_url END AS id_photo_url FROM subscribers WHERE tenant_id = ? AND id IN (?)`, [req.tenantId, clientIds]),
      ]);
      for (const row of files) papers.set(row.id, row);
      for (const row of payments) paid.set(row.subscriber_id, Math.round(Number(row.paid) || 0));
      for (const row of bundles) courses.set(row.subscriber_id, [...(courses.get(row.subscriber_id) || []), { id: null, title: `📦 ${row.title}` }]);
      for (const row of enrolments) courses.set(row.subscriber_id, [...(courses.get(row.subscriber_id) || []), { id: row.course_id, title: row.title }]);
    }

    res.json({
      total: Number(count.total) || 0,
      rows: page.map(row => {
        const held = courses.get(row.id) || [];
        return {
          kind: row.kind, id: row.id, clientCode: row.client_code || '', name: row.name || '', phone: row.phone || '', email: row.email || '',
          branch: row.branch || '', clientType: row.client_type || null, status: row.status, createdAt: row.created_at,
          totalPaid: paid.get(row.id) || 0, assignedSalesName: row.sales_name || '',
          courseIds: held.map(entry => entry.id).filter(Boolean), courseNames: held.map(entry => entry.title).join('، '),
          ...(row.kind === 'subscriber' ? {
            nameEn: papers.get(row.id)?.name_en || '', nationalId: papers.get(row.id)?.national_id || '',
            personalPhotoUrl: papers.get(row.id)?.personal_photo_url || '', idPhotoUrl: papers.get(row.id)?.id_photo_url || '',
          } : {}),
        };
      }),
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
    logger.error('[client-db-page]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
