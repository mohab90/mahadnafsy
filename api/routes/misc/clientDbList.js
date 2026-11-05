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
const { createTtlCache } = require('../../lib/ttlCache');

const router = express.Router();
const PAGE_MAX = 100;
// The counts walk every lead against the clients (seconds at hundreds of thousands of rows) and change slowly: the same question inside a minute is answered once.
const COUNT_TTL_MS = 60 * 1000;
// Held a minute; once expired the old count is returned at once for up to ten minutes more while a new one is computed behind (lib/ttlCache.js): the first
// screen of the day waits for the 3–5 s count at 600,000 leads, nobody after it does.
const memo = createTtlCache({ max: 200 });
const remembered = (key, load) => memo.cached(key, COUNT_TTL_MS, load, { staleMs: 10 * 60 * 1000 });
// A page reads at most this many rows from each population: deeper than that is what the filters and the search are for.
const DEEP_MAX = 20000;

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
              AND NOT EXISTS (SELECT 1 FROM staff st WHERE st.tenant_id = u.tenant_id AND st.deleted_at IS NULL AND st.email <> '' AND st.email = u.email)
              -- Not twice: a sign-in with the e-mail or the number of a client is that client (lib/autoLinkAccounts.js links them; until it has, it is not a second person here).
              AND NOT EXISTS (SELECT 1 FROM subscribers sm WHERE sm.tenant_id = u.tenant_id AND sm.deleted_at IS NULL
                              AND ((u.email IS NOT NULL AND u.email <> '' AND sm.email = u.email COLLATE utf8mb4_unicode_ci)
                                OR (u.phone IS NOT NULL AND u.phone <> '' AND sm.phone_digits = REGEXP_REPLACE(u.phone, '[^0-9]', '') COLLATE utf8mb4_unicode_ci)))`,
      params: [],
    };
  }
  return out;
}

router.get('/api/admin/client-db/summary', requireAuth, requireAdminOrStaff, requirePermission('view_client_db'), async (req, res) => {
  try {
    const pop = populations(req);
    const summaryKey = JSON.stringify(['summary', req.tenantId, pop.subscriber, pop.lead, pop.registration]);
    const cached = await remembered(summaryKey, async () => {
    const [subs, leads, registrations, left] = await Promise.all([
      pop.subscriber ? pool.query(
        `SELECT COUNT(*) AS total, COALESCE(SUM(${subTypeSql('s')} = 'online'), 0) AS online, COALESCE(SUM(${subTypeSql('s')} = 'daqqi'), 0) AS daqqi,
                COALESCE(SUM(${subTypeSql('s')} = 'regular'), 0) AS regular
           FROM subscribers s WHERE s.tenant_id = ? AND ${pop.subscriber.where}`, [req.tenantId, ...pop.subscriber.params]) : [[{ total: 0, online: 0, daqqi: 0, regular: 0 }]],
      pop.lead ? pool.query(`SELECT COUNT(*) AS total FROM leads l WHERE l.tenant_id = ? AND ${pop.lead.where}`, [req.tenantId, ...pop.lead.params]) : [[{ total: 0 }]],
      pop.registration ? pool.query(`SELECT COUNT(*) AS total FROM users u WHERE u.tenant_id = ? AND ${pop.registration.where}`, [req.tenantId, ...pop.registration.params]) : [[{ total: 0 }]],
      // The leads the total leaves out, so a number that looks short can be read: hidden, archived, merged, become clients.
      pop.lead ? pool.query(
        `SELECT COALESCE(SUM(l.hidden <> 0), 0) AS hidden, COALESCE(SUM(l.hidden = 0 AND l.status = 'archived'), 0) AS archived,
                COALESCE(SUM(l.hidden = 0 AND l.status <> 'archived' AND l.merged_into_lead_id IS NOT NULL), 0) AS merged,
                COALESCE(SUM(l.hidden = 0 AND l.status <> 'archived' AND l.merged_into_lead_id IS NULL AND l.status IN ${CONVERTED_SQL}), 0) AS converted
           FROM leads l WHERE l.tenant_id = ? AND l.deleted_at IS NULL${leadScope(req, 'l').sql}`, [req.tenantId, ...leadScope(req, 'l').params]) : [[{ hidden: 0, archived: 0, merged: 0, converted: 0 }]],
    ]);
    const s = subs[0][0];
    const summary = {
      subscribers: Number(s.total) || 0, online: Number(s.online) || 0, daqqi: Number(s.daqqi) || 0, regular: Number(s.regular) || 0,
      leads: Number(leads[0][0].total) || 0, registrations: Number(registrations[0][0].total) || 0,
      leftOut: { hidden: Number(left[0][0].hidden) || 0, archived: Number(left[0][0].archived) || 0, merged: Number(left[0][0].merged) || 0, converted: Number(left[0][0].converted) || 0 },
    };
    return { ...summary, total: summary.subscribers + summary.leads + summary.registrations };
    });
    res.json(cached);
  } catch (error) {
    logger.error('[client-db-summary]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const SORTS = {
  // `by` orders one population in its own query (the id runs the same way as the date, so the index serves the sort without a filesort); `compare` merges the pages.
  date_desc: { by: alias => `${alias}.created_at DESC, ${alias}.id DESC`, compare: (a, b) => (new Date(b.created_at) - new Date(a.created_at)) || String(b.id).localeCompare(String(a.id)), leadIndex: true },
  date_asc: { by: alias => `${alias}.created_at ASC, ${alias}.id ASC`, compare: (a, b) => (new Date(a.created_at) - new Date(b.created_at)) || String(a.id).localeCompare(String(b.id)), leadIndex: true },
  name_asc: { by: alias => `${alias}.name ASC, ${alias}.id ASC`, compare: (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar') || String(a.id).localeCompare(String(b.id)) },
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
        alias: 's',
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
        alias: 'l',
        sql: `SELECT 'lead' AS kind, l.id COLLATE utf8mb4_unicode_ci AS id, l.client_code COLLATE utf8mb4_unicode_ci AS client_code, l.name COLLATE utf8mb4_unicode_ci AS name, l.phone COLLATE utf8mb4_unicode_ci AS phone, l.email COLLATE utf8mb4_unicode_ci AS email, l.branch COLLATE utf8mb4_unicode_ci AS branch,
                     l.client_type COLLATE utf8mb4_unicode_ci AS client_type, l.status COLLATE utf8mb4_unicode_ci AS status, l.created_at, COALESCE(l.assigned_sales_name, '') COLLATE utf8mb4_unicode_ci AS sales_name
                FROM leads l${order.leadIndex && !q && !branch && ['all', 'lead'].includes(type) ? ' FORCE INDEX (idx_leads_tenant_hidden_created_id)' : ''} WHERE l.tenant_id = ? AND ${pop.lead.where}${filters.length ? ` AND ${filters.join(' AND ')}` : ''}`,
        params: [req.tenantId, ...pop.lead.params, ...params],
      });
    }
    if (pop.registration && !course && !branch && ['all', 'registration'].includes(type)) {
      const filters = [];
      const params = [];
      if (q) { const match = personMatch(q, 'u', { withCode: false }); filters.push(match.sql); params.push(...match.params); }
      parts.push({
        alias: 'u',
        sql: `SELECT 'registration' AS kind, u.id COLLATE utf8mb4_unicode_ci AS id, NULL AS client_code, u.name COLLATE utf8mb4_unicode_ci AS name, u.phone COLLATE utf8mb4_unicode_ci AS phone, u.email COLLATE utf8mb4_unicode_ci AS email, NULL AS branch, NULL AS client_type, 'registration' AS status,
                     u.created_at, '' AS sales_name
                FROM users u WHERE u.tenant_id = ? AND ${pop.registration.where}${filters.length ? ` AND ${filters.join(' AND ')}` : ''}`,
        params: [req.tenantId, ...pop.registration.params, ...params],
      });
    }
    if (!parts.length) return res.json({ rows: [], total: 0 });

    // Each text column of the union names one collation: the three tables do not all hold theirs in the same one on every database, and a UNION of two refuses (the
    // release's staging run showed it for the new table's columns, 3 Nov 2026).
    // Each population is counted and read on its own, ordered by its own index, and the pages are merged here: one sort over the union of every lead and client
    // took 5 s at 600,000 leads. A page needs only the first offset + limit rows of each.
    if (offset + limit > DEEP_MAX) return res.status(400).json({ error: 'الصفحة بعيدة — ضيّق البحث أو استخدم الفلاتر', code: 'PAGE_TOO_DEEP' });
    const counts = await Promise.all(parts.map(part => remembered(JSON.stringify(['count', req.tenantId, part.sql, part.params]),
      async () => Number((await pool.query(`SELECT COUNT(*) AS total FROM (${part.sql}) t`, part.params))[0][0].total) || 0)));
    const reads = await Promise.all(parts.map((part, index) => (counts[index] === 0 ? [] : pool.query(
      `${part.sql} ORDER BY ${order.by(part.alias)} LIMIT ?`, [...part.params, offset + limit]).then(([rows]) => rows))));
    const count = { total: counts.reduce((sum, value) => sum + value, 0) };
    const page = reads.flat().sort(order.compare).slice(offset, offset + limit);

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
