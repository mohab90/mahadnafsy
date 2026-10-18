'use strict';
const { certificateDue } = require('../../lib/certificatePricing');
const { loadPlacements, placeCourse, ownOrPlaced } = require('../../lib/coursePlacement');
const { certificatePricing } = require('../../lib/certificatePayments');
const { CONVERTED_SQL, TERMINAL_SQL } = require('../../lib/leadStatuses');
const { NEXT_FOLLOWUP } = require('../../lib/leadTableFilter');
const { ARCHIVE_SOURCE_PREFIXES } = require('../../lib/leadArchive');
const logger = require('../../lib/logger');
const crypto   = require('crypto');
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../../lib/id');

const { pool, cacheInvalidate, cached } = require('../../lib/db');
const { resolvePaymentExecutors } = require('../../lib/paymentExecutor');
const { mailer } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { tryJson, sanitize, parseLimit, parseOffset, parseCrm, calcLeadScoreServer, sendRouteError } = require('../../lib/helpers');
const { COURSE_COLS, mapCourse, getNextClientCode } = require('../../lib/mappers');
const { createNotification } = require('../../lib/notification');
const { logLeadEvent } = require('../../lib/crm');
const { branchesFromScope, leadScope } = require('../../lib/leadAccess');
const { enqueueEmailSequence } = require('../../lib/emailSequence');
const { ADMIN_EMAILS, requireAuth, requireAdminOrStaff, requirePermission, requireAnyPermission } = require('../../middleware/auth');
const { VALID_BRANCHES, VALID_PAY_TYPES, VALID_SOURCES, normalizeDataScope, resolveDataScope, hasPermission, PERMISSIONS } = require('../../constants/permissions');
const { safeIsoString, safeDateOnly, sqlCairoDayStartUtc, sqlCairoDayEndUtc, sqlCairoWall, cairoToday, cairoDayStartUtc, addDaysToDateOnly } = require('../../lib/dates');
const { bulkOperationLimiter } = require('../../middleware/rateLimits');
const { keyset } = require('../../lib/pagination');
const { installmentPlansBySubscriber, withInstallmentPlans } = require('../../lib/installmentPlansBySubscriber');
const { loadCollectionPicker, subscriberMarket } = require('../../lib/collectionDistribution');
const { requireCollectionLead } = require('../collection-distribution');
const { BRANCH_ROLES, requestedBranch } = require('../../lib/physicalBranches');
const { buildView: buildClientsView, dueInstallments, readFilters: readClientFilters } = require('../../lib/staffClientsView');
const { mapInstallmentPlan } = require('../../lib/installmentMath');

async function loadEnrollmentProjection(tenantId, subscriberIds) {
  if (!subscriberIds.length) return {};
  const [rows] = await pool.query(
    `SELECT subscriber_id,course_id,bundle_id,access_type,lecture_limit FROM enrollments
     WHERE tenant_id=? AND status='active' AND subscriber_id IN (${subscriberIds.map(() => '?').join(',')})`,
    [tenantId, ...subscriberIds]
  );
  return rows.reduce((projection, row) => {
    const entry = projection[row.subscriber_id] ||= { ids: [], bundleIds: [], access: {} };
    // The track a course was opened through: the online screen shows a
    // track booking as the track, not as the courses inside it.
    if (row.bundle_id && !entry.bundleIds.includes(String(row.bundle_id))) entry.bundleIds.push(String(row.bundle_id));
    if (!row.course_id) return projection;
    const courseId = String(row.course_id);
    if (!entry.ids.includes(courseId)) entry.ids.push(courseId);
    entry.access[courseId] = row.access_type === 'limited'
      ? { mode: 'limited', lectureLimit: Number(row.lecture_limit) || 1 } : 'full';
    return projection;
  }, {});
}

async function loadCompletionProjection(tenantId, subscriberIds) {
  if (!subscriberIds.length) return {};
  const [rows] = await pool.query(
    `SELECT id,subscriber_id,course_id,certificate_code,completed_at,status,version,revoked_at,revoke_reason
     FROM course_completions
     WHERE tenant_id=? AND subscriber_id IN (${subscriberIds.map(() => '?').join(',')})
     ORDER BY completed_at DESC`,
    [tenantId, ...subscriberIds]
  );
  return rows.reduce((projection, row) => {
    (projection[row.subscriber_id] ||= []).push({
      id: row.id, courseId: row.course_id, certificateNumber: row.certificate_code,
      issuedAt: safeIsoString(row.completed_at) || null, status: row.status || 'active',
      version: Number(row.version || 1), revokedAt: safeIsoString(row.revoked_at) || undefined,
      revokeReason: row.revoke_reason || undefined,
    });
    return projection;
  }, {});
}

/**
 * GET /api/admin/online-performance — how the online team is doing, in numbers.
 *
 * «إدارة فريق الأونلاين» counted its own figures in the browser out of the
 * subscribers and leads arrays, so the smallest way to show somebody the team's
 * numbers was to hand them every client and every lead. Computed here instead:
 * nothing in this response names a client.
 */
router.get('/api/admin/online-performance', requireAuth, requireAdminOrStaff,
  requireAnyPermission(PERMISSIONS.MANAGE_SALES_TEAM, PERMISSIONS.VIEW_PERF_ONLINE), async (req, res) => {
    try {
      const [[byStaff], [months], [[totals]]] = await Promise.all([
        pool.query(
          `SELECT st.id, st.name, LOWER(st.role) role,
                  COALESCE(cs.clients, 0) clients,
                  COALESCE(sl.leads, 0) leads,
                  COALESCE(sl.converted, 0) converted
             FROM staff st
             LEFT JOIN (
               SELECT assigned_cs_id id, COUNT(*) clients FROM subscribers
                WHERE tenant_id=? AND deleted_at IS NULL AND branch IN ('ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD') AND assigned_cs_id IS NOT NULL
                GROUP BY assigned_cs_id
             ) cs ON cs.id = st.id
             LEFT JOIN (
               SELECT assigned_sales_id id, COUNT(*) leads,
                      SUM(CASE WHEN status IN ${CONVERTED_SQL} THEN 1 ELSE 0 END) converted
                 FROM leads
                WHERE tenant_id=? AND branch IN ('ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD') AND assigned_sales_id IS NOT NULL
                GROUP BY assigned_sales_id
             ) sl ON sl.id = st.id
            WHERE st.tenant_id=? AND st.is_active=1 AND st.deleted_at IS NULL
              AND LOWER(st.role) IN ('online_manager','sales','collection','support','sales_collection_manager')
            ORDER BY clients DESC, leads DESC`, [req.tenantId, req.tenantId, req.tenantId]),
        // Six months of both, so the screen's chart has a server-side source.
        pool.query(
          `SELECT month, SUM(clients) clients, SUM(leads) leads FROM (
             SELECT DATE_FORMAT(${sqlCairoWall('created_at')}, '%Y-%m') month, COUNT(*) clients, 0 leads
               FROM subscribers
              WHERE tenant_id=? AND deleted_at IS NULL AND branch IN ('ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD')
                AND created_at >= DATE_SUB(${sqlCairoDayStartUtc()}, INTERVAL 6 MONTH)
              GROUP BY month
             UNION ALL
             SELECT DATE_FORMAT(${sqlCairoWall('created_at')}, '%Y-%m') month, 0 clients, COUNT(*) leads
               FROM leads
              WHERE tenant_id=? AND branch IN ('ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD')
                AND created_at >= DATE_SUB(${sqlCairoDayStartUtc()}, INTERVAL 6 MONTH)
              GROUP BY month
           ) monthly GROUP BY month ORDER BY month`, [req.tenantId, req.tenantId]),
        pool.query(
          `SELECT
             (SELECT COUNT(*) FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL AND branch IN ('ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD')) clients,
             (SELECT COUNT(*) FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL AND branch IN ('ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD') AND is_active=1) active_clients,
             (SELECT COUNT(*) FROM leads WHERE tenant_id=? AND branch IN ('ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD')) leads`,
          [req.tenantId, req.tenantId, req.tenantId]),
      ]);

      res.json({
        totals: {
          clients: Number(totals?.clients || 0),
          activeClients: Number(totals?.active_clients || 0),
          leads: Number(totals?.leads || 0),
        },
        months: months.map(row => ({ month: row.month, clients: Number(row.clients || 0), leads: Number(row.leads || 0) })),
        byStaff: byStaff.map(row => ({
          id: row.id, name: row.name, role: row.role,
          clients: Number(row.clients || 0),
          leads: Number(row.leads || 0),
          converted: Number(row.converted || 0),
        })),
        canSeeDetail: Boolean(req.isSuperAdmin) || hasPermission(req.staffRecord, PERMISSIONS.VIEW_SUBSCRIBERS),
      });
    } catch (e) { sendRouteError(res, e); }
  });


// GET /api/admin/subscribers/stats
//
// The campaign screens show "المشتركون (1,353)" beside "الليدات (26,878)" in an
// audience picker. Rendering that one number was the entire reason those screens
// pulled both whole tables into the browser.
//
// Scoped exactly like the list route above — same resolveDataScope call, same
// branch/assigned_sales/assigned_cs clauses — so a rep's count describes the
// same population their list does. A count that disagreed with the list beneath
// it would be worse than no count.
router.get('/api/admin/subscribers/stats', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    const isSuper = !!req.isSuperAdmin;
    const scope = resolveDataScope(req.staffRecord, { isSuperAdmin: isSuper, fallback: 'assigned_sales' });
    if (scope === 'none') return res.json({ total: 0, active: 0, byBranch: {} });

    const adminExclusions = ADMIN_EMAILS.length > 0
      ? `AND (s.email IS NULL OR s.email NOT IN (${ADMIN_EMAILS.map(() => '?').join(',')}))`
      : '';
    let scopeClause = '1=1';
    const scopeParams = [];
    if (scope.startsWith('branch:')) {
      const branches = branchesFromScope(scope);
      scopeClause = branches.length ? ownOrPlaced(branches) : '1=0';
      scopeParams.push(...branches, ...branches);
    } else if (scope === 'assigned_sales') {
      const staffId = req.staffRecord?.id;
      if (!staffId) return res.status(403).json({ error: 'Staff record required' });
      scopeClause = `(s.assigned_sales_id = ? OR (s.lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM leads l WHERE l.id = s.lead_id AND l.tenant_id=s.tenant_id AND l.assigned_sales_id = ?)))`;
      scopeParams.push(staffId, staffId);
    } else if (scope === 'assigned_cs') {
      const staffId = req.staffRecord?.id;
      if (!staffId) return res.status(403).json({ error: 'Staff record required' });
      scopeClause = `s.assigned_cs_id = ?`;
      scopeParams.push(staffId);
    }

    const params = [req.tenantId, ...ADMIN_EMAILS, ...scopeParams];
    const [rows] = await pool.query(
      `SELECT COALESCE(NULLIF(s.branch, ''), '') AS branch, COUNT(*) AS cnt
         FROM subscribers s
        WHERE s.tenant_id = ? AND s.deleted_at IS NULL ${adminExclusions}
          AND ${scopeClause}
        GROUP BY COALESCE(NULLIF(s.branch, ''), '')`,
      params,
    );

    const byBranch = {};
    let total = 0;
    for (const row of rows) {
      const count = Number(row.cnt);
      byBranch[String(row.branch || '')] = count;
      total += count;
    }

    // paidBySubscriber=1: what each of those clients has paid, net, in EGP.
    // The retention and subscriptions screens summed a totalPaid the subscriber
    // list never carries, so every revenue figure on them read 0 ج.
    let paidBySubscriber;
    if (req.query.paidBySubscriber === '1') {
      const [paidRows] = await pool.query(
        `SELECT p.subscriber_id AS id,
                SUM(COALESCE(p.amount_egp, CASE WHEN COALESCE(p.currency, 'EGP') = 'EGP' THEN p.amount END)) AS egp
           FROM payments p
           JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
          WHERE p.tenant_id = ? AND p.status = 'paid' AND p.deleted_at IS NULL
            AND s.deleted_at IS NULL ${adminExclusions} AND ${scopeClause}
          GROUP BY p.subscriber_id`,
        params,
      );
      paidBySubscriber = Object.fromEntries(paidRows.map(r => [r.id, Math.round(Number(r.egp) || 0)]));
    }

    // overview=1: what الرئيسية shows beside the total — the clients who joined
    // today and each course's clients. It counted both out of the 500 newest
    // clients it loaded at sign-in; it loads none now (admin siteLists.ts, 11 Oct
    // 2026), so the database counts them, over the same clients as the total.
    let overview;
    if (req.query.overview === '1') {
      const [[[todayRow]], [courseRows]] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) AS cnt FROM subscribers s
            WHERE s.tenant_id = ? AND s.deleted_at IS NULL ${adminExclusions} AND ${scopeClause}
              AND s.created_at >= ${sqlCairoDayStartUtc()} AND s.created_at < ${sqlCairoDayEndUtc()}`,
          params,
        ),
        pool.query(
          `SELECT e.course_id AS id, COUNT(DISTINCT e.subscriber_id) AS cnt
             FROM enrollments e
             JOIN subscribers s ON s.id = e.subscriber_id AND s.tenant_id = e.tenant_id
            WHERE s.tenant_id = ? AND e.status = 'active' AND s.deleted_at IS NULL ${adminExclusions} AND ${scopeClause}
            GROUP BY e.course_id`,
          params,
        ),
      ]);
      overview = {
        createdToday: Number(todayRow?.cnt) || 0,
        byCourse: Object.fromEntries(courseRows.map(row => [row.id, Number(row.cnt) || 0])),
      };
    }

    res.json({ total, byBranch, ...(paidBySubscriber ? { paidBySubscriber } : {}), ...(overview || {}) });
  } catch (e) { logger.error('[route]', e.message); sendRouteError(res, e); }
});


// ?branch=DAQQI (or a comma list). A screen about one branch used to receive a
// page of every branch's clients — the 500 newest of the whole institute — and
// count the branch's own out of whatever happened to be in it: the Dokki list read
// 140 clients when the branch has far more, because only 140 of the newest 500
// were Dokki's. Filtering at the database returns the branch's clients, all of
// them, in pages. ANDed with the caller's data scope, never instead of it.
function branchFilter(req, column = 's.branch') {
  const raw = String(req.query.branch || '').trim();
  if (!raw) return { sql: '', params: [] };
  const branches = [...new Set(raw.split(',')
    .map(value => value.trim().toUpperCase().replace(/[-\s]/g, '_'))
    .filter(value => VALID_BRANCHES.has(value)))];
  // Named but none of them real: nothing, rather than everything.
  if (!branches.length) return { sql: ' AND 1=0', params: [] };
  // Its own, or a course placed there (lib/coursePlacement.js).
  return column === 's.branch'
    ? { sql: ` AND ${ownOrPlaced(branches)}`, params: [...branches, ...branches] }
    : { sql: ` AND ${column} IN (${branches.map(() => '?').join(',')})`, params: branches };
}

// The data-scope clause every subscriber list shares, as one function. The list,
// the count and the stats each carried their own copy of this block.
function subscriberScope(req) {
  const isSuper = !!req.isSuperAdmin;
  const scope = resolveDataScope(req.staffRecord, { isSuperAdmin: isSuper, fallback: 'assigned_sales' });
  if (scope === 'none') return { none: true };
  let clause = '1=1';
  const params = [];
  if (scope.startsWith('branch:')) {
    const branches = branchesFromScope(scope);
    clause = branches.length ? ownOrPlaced(branches) : '1=0';
    params.push(...branches, ...branches);
  } else if (scope === 'assigned_sales') {
    const staffId = req.staffRecord?.id;
    if (!staffId) return { forbidden: true };
    clause = `(s.assigned_sales_id = ? OR (s.lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM leads l WHERE l.id = s.lead_id AND l.tenant_id=s.tenant_id AND l.assigned_sales_id = ?)))`;
    params.push(staffId, staffId);
  } else if (scope === 'assigned_cs') {
    const staffId = req.staffRecord?.id;
    if (!staffId) return { forbidden: true };
    clause = 's.assigned_cs_id = ?';
    params.push(staffId);
  }
  return { clause, params };
}

// GET /api/admin/subscribers/count?branch=DAQQI — how many, and in which status,
// answered by the database in one small query instead of by loading every row and
// counting them in the browser. Same population as the list beside it (active,
// not staff, inside the caller's scope), so the number printed above a table is
// the number the table will end up holding.
router.get('/api/admin/subscribers/count', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    const scope = subscriberScope(req);
    if (scope.none) return res.json({ total: 0, byStatus: {} });
    if (scope.forbidden) return res.status(403).json({ error: 'Staff record required' });
    const branch = branchFilter(req);
    const adminExclusions = ADMIN_EMAILS.length > 0
      ? `AND (s.email IS NULL OR s.email NOT IN (${ADMIN_EMAILS.map(() => '?').join(',')}))`
      : '';
    const [rows] = await pool.query(
      `SELECT CASE WHEN JSON_VALID(s.crm_json) THEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.crm_json,'$.clientStatus')),'') ELSE '' END AS client_status,
              COUNT(*) AS cnt
         FROM subscribers s
        WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND s.is_active=1 AND (${scope.clause})${branch.sql} AND NOT EXISTS (
          SELECT 1 FROM staff st WHERE st.tenant_id=s.tenant_id AND st.email = s.email AND st.is_active = 1
        ) ${adminExclusions}
        GROUP BY client_status`,
      [req.tenantId, ...scope.params, ...branch.params, ...ADMIN_EMAILS.map(e => e.toLowerCase())]
    );
    const byStatus = {};
    let total = 0;
    for (const row of rows) { byStatus[row.client_status || ''] = Number(row.cnt); total += Number(row.cnt); }
    res.json({ total, byStatus });
  } catch (e) { logger.error('[route]', e.message); sendRouteError(res, e); }
});

router.get('/api/admin/subscribers', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    const limit  = parseLimit(req.query.limit, 500, 5000);
    const offset = parseOffset(req.query.offset);
    // This was the admin dashboard's main subscriber-list load and had NO scoping at
    // all — every authenticated staff member (including reception_daqqi, who should
    // only ever see Dokki clients) got every branch's subscribers with full payment
    // history. /api/staff/subscribers already scopes correctly by DATA_SCOPE; apply
    // the same rule here since this is the endpoint the admin app actually calls.
    const isSuper = !!req.isSuperAdmin;
    const scope   = resolveDataScope(req.staffRecord, { isSuperAdmin: isSuper, fallback: 'assigned_sales' });
    if (scope === 'none') return res.json([]);

    const adminExclusions = ADMIN_EMAILS.length > 0
      ? `AND (s.email IS NULL OR s.email NOT IN (${ADMIN_EMAILS.map(() => '?').join(',')}))`
      : '';
    let scopeClause = '1=1';
    const scopeParams = [];
    if (scope.startsWith('branch:')) {
      const branches = branchesFromScope(scope);
      scopeClause = branches.length ? ownOrPlaced(branches) : '1=0';
      scopeParams.push(...branches, ...branches);
    } else if (scope === 'assigned_sales') {
      const staffId = req.staffRecord?.id;
      if (!staffId) return res.status(403).json({ error: 'Staff record required' });
      // crm_json used to be an OR-fallback here for a NULL assigned_sales_id column,
      // back when nothing ever actively cleared the column while crm_json still held
      // a value. A bulk unassign proved that assumption false: crm_json is a
      // write-once snapshot from creation time, never invalidated by later
      // reassignment/unassignment, so matching on it let unassigned records
      // resurface as "still mine" (and, worse, get silently reassigned back — see
      // the auto-backfill this scope used to feed at /api/staff/my-subscribers).
      // The column is the only field every assignment code path keeps current.
      scopeClause = `(s.assigned_sales_id = ? OR (s.lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM leads l WHERE l.id = s.lead_id AND l.tenant_id=s.tenant_id AND l.assigned_sales_id = ?)))`;
      scopeParams.push(staffId, staffId);
    } else if (scope === 'assigned_cs') {
      const staffId = req.staffRecord?.id;
      if (!staffId) return res.status(403).json({ error: 'Staff record required' });
      scopeClause = `s.assigned_cs_id = ?`;
      scopeParams.push(staffId);
    }
    // scope === 'all' falls through with scopeClause = '1=1' (no extra restriction)

    // Optional server-side search/filter — additive, backward-compatible: callers that
    // don't pass q/status get identical results to before. Lets the admin UI eventually
    // query a page at a time instead of paging through the entire table into memory.
    let searchClause = '';
    const searchParams = [];
    const q = (req.query.q || '').trim();
    if (q) {
      // Same shape-routing as the leads list: a client code or a complete email
      // is an identifier typed in full, so match it exactly and let the index
      // serve it instead of forcing a full scan with a leading wildcard.
      if (/^C\d+$/i.test(q)) {
        searchClause += ' AND s.client_code = ?';
        searchParams.push(q.toUpperCase());
      } else if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q)) {
        searchClause += ' AND s.email = ?';
        searchParams.push(q);
      } else {
        searchClause += ' AND (s.name LIKE ? OR s.phone LIKE ? OR s.email LIKE ? OR s.client_code LIKE ?)';
        const like = `%${q}%`;
        searchParams.push(like, like, like, like);
      }
    }
    const statusFilter = (req.query.status || '').trim();
    if (statusFilter && statusFilter !== 'all') {
      searchClause += ' AND s.status = ?';
      searchParams.push(statusFilter);
    }
    const byBranch = branchFilter(req);
    searchClause += byBranch.sql;
    searchParams.push(...byBranch.params);

    const [rows] = await pool.query(
      `SELECT s.*,
              COALESCE(ss.name, s.assigned_sales_name) AS assigned_sales_name,
              COALESCE(cs.name, s.assigned_cs_name)    AS assigned_cs_name
       FROM subscribers s
       LEFT JOIN staff ss ON ss.id = s.assigned_sales_id AND ss.tenant_id=s.tenant_id
       LEFT JOIN staff cs ON cs.id = s.assigned_cs_id AND cs.tenant_id=s.tenant_id
       WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND s.is_active=1 AND (${scopeClause}) AND NOT EXISTS (
         SELECT 1 FROM staff st WHERE st.tenant_id=s.tenant_id AND st.email = s.email AND st.is_active = 1
       ) ${adminExclusions}${searchClause}
       ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`,
      [req.tenantId, ...scopeParams, ...ADMIN_EMAILS.map(e => e.toLowerCase()), ...searchParams, limit, offset]
    );
    if (rows.length === 0) return res.json([]);

    // Batch-load payments from the payments table (authoritative source, one query for all)
    const ids = rows.map(r => r.id);
    const plansBySub = await installmentPlansBySubscriber(req.tenantId, ids);
    // A course placed in another branch than the client's (lib/coursePlacement.js).
    const placementsBySub = await loadPlacements(pool, req.tenantId, ids);
    const placeholders = ids.map(() => '?').join(',');
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, course_expected, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title, cert_type,
              certificate_request_id, branch
       FROM payments
       WHERE tenant_id=? AND subscriber_id IN (${placeholders}) AND deleted_at IS NULL
       ORDER BY \`date\` ASC`,
      [req.tenantId, ...ids]
    );
    const executors = await resolvePaymentExecutors(pool, req.tenantId, payRows);
    const payBySubId = {};
    payRows.forEach(p => {
      if (!payBySubId[p.subscriber_id]) payBySubId[p.subscriber_id] = [];
      const dateStr = safeDateOnly(p.date);
      payBySubId[p.subscriber_id].push({
        id: p.id,
        amount: Number(p.amount) || 0,
        currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(),
        paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null,
        isInstallment: !!p.is_installment,
        courseId: p.course_id || null,
        bundleId: p.bundle_id || null,
        courseExpected: p.course_expected != null ? Number(p.course_expected) : undefined,
        note: p.note || null,
        at: dateStr,
        status: p.status || 'paid',
        staffId: p.staff_id || null,
        staffName: executors.get(String(p.id)) ?? null,
        fromAccountNumber: p.from_account || null,
        source: p.source || null,
        itemTitle: p.item_title || null,
        certType: p.cert_type || null,
        certId: p.certificate_request_id || null,
        branch: p.branch || null,
      });
    });

    const enrollmentProjection = await loadEnrollmentProjection(req.tenantId, ids);
    const completionProjection = await loadCompletionProjection(req.tenantId, ids);

    const [certificateRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, type, custom_name, name_ar, name_en,
              nationality, id_number, status, price, paid_amount, currency, note,
              admin_note, requested_at, issued_at
       FROM certificate_requests
       WHERE tenant_id=? AND subscriber_id IN (${placeholders})
       ORDER BY requested_at DESC`,
      [req.tenantId, ...ids]
    );
    // The price a certificate shows is the price list's for its type and currency (lib/certificatePricing.js certificateDue).
    const certificatePricingConfig = await certificatePricing(pool, req.tenantId);
    const certificatesBySub = {};
    certificateRows.forEach(request => {
      if (!certificatesBySub[request.subscriber_id]) certificatesBySub[request.subscriber_id] = [];
      certificatesBySub[request.subscriber_id].push({
        id: request.id,
        courseId: request.course_id || undefined,
        type: String(request.type || 'OTHER').toLowerCase(),
        customName: request.custom_name || undefined,
        nameAr: request.name_ar || undefined,
        nameEn: request.name_en || undefined,
        nationality: request.nationality ? String(request.nationality).toLowerCase() : undefined,
        idNumber: request.id_number || undefined,
        status: String(request.status || 'PENDING').toLowerCase(),
        price: certificateDue(certificatePricingConfig, request) || undefined,
        paidAmount: request.paid_amount != null ? Number(request.paid_amount) : 0,
        currency: request.currency || undefined,
        requestedAt: safeIsoString(request.requested_at) || null,
        issuedAt: safeIsoString(request.issued_at) || undefined,
        note: request.note || undefined,
        adminNote: request.admin_note || undefined,
      });
    });

    res.json(rows.map(r => {
      const crm = withInstallmentPlans(parseCrm(r.crm_json), plansBySub.get(r.id));
      // client_code column is authoritative
      const clientCode = r.client_code || crm.clientCode || null;
      // payments table is authoritative; fall back to crm_json if no DB records found
      const paymentHistory = payBySubId[r.id] && payBySubId[r.id].length > 0
        ? payBySubId[r.id]
        : [];
      const enrolledCourseIds = enrollmentProjection[r.id]?.ids || [];
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone, phone2: r.phone2 || '',
        firebaseUid: r.firebase_uid, isActive: !!r.is_active,
        notes: r.notes, createdAt: r.created_at,
        ...crm, coursePlacements: placementsBySub.get(r.id) || {},          // other CRM fields: courseAccess, installmentPlans, etc.
        enrolledCourseIds,
        enrolledBundleIds: enrollmentProjection[r.id]?.bundleIds || [],
        courseAccess: enrollmentProjection[r.id]?.access || {},
        certificates: completionProjection[r.id] || [],
        clientCode,      // authoritative
        // The certificate's English name and the national id, and the Drive links of the
        // pictures asked for with a certificate or a carnet — the client's row in an export.
        nameEn: r.name_en || crm.nameEn || null,
        nationalId: r.national_id || crm.nationalId || null,
        personalPhotoUrl: r.personal_photo_url || null,
        idPhotoUrl: r.id_photo_url || null,
        paymentHistory,  // authoritative from payments table
        extraCertificateRequests: certificatesBySub[r.id] || [],
        branch: (() => { const rb = r.branch || crm.branch || null; if (!rb) return null; const nb = rb.toUpperCase().replace(/[-\s]/g,'_'); return ['DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER'].includes(nb) ? nb : rb; })(),
        assignedSalesId: r.assigned_sales_id || null,
        assignedSalesName: r.assigned_sales_name || null,
        assignedCsId: r.assigned_cs_id || null,
        assignedCsName: r.assigned_cs_name || null,
        updatedAt: safeIsoString(r.updated_at) || null,
      };
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/staff/subscribers
// UNIFIED endpoint — server scopes data automatically based on role.
// All staff roles call this ONE endpoint. The server decides what they see.
// Scoping rules are defined in api/constants/permissions.js → DATA_SCOPE.
// ─────────────────────────────────────────────────────────────────────────────
/** One leads row as the staff screens read it (the list and the home summary share it). */
function mapStaffLeadRow(r) {
  const crm = parseCrm(r.crm_json);
  return {
    ...crm,
    id: r.id, name: r.name, email: r.email, phone: r.phone, phone2: r.phone2 || '',
    status: r.status, source: r.source, notes: r.notes,
    leadType: r.lead_type || crm.leadType || 'course',
    enrolledCourseId: r.enrolled_course_id || crm.enrolledCourseId || '',
    interestLevel: r.interest_level || crm.interestLevel || 'medium',
    assignedSalesId: r.assigned_sales_id || null,
    assignedSalesName: r.assigned_sales_name || null,
    assignedCsId: r.assigned_cs_id || null,
    assignedCsName: r.assigned_cs_name || null,
    interestedCourseIds: tryJson(r.interested_course_ids_json, crm.interestedCourseIds || []),
    createdAt: r.created_at, updatedAt: r.updated_at,
    communications: Array.isArray(crm.communications) ? crm.communications : [],
    nextFollowUpDate: r.next_follow_up_date || crm.nextFollowUpDate || null,
    paidAmount: r.paid_amount, clientCode: r.client_code,
    hidden: !!r.hidden, branch: r.branch, clientType: r.client_type || null,
  };
}

/**
 * Whose clients this staff member may see, as an SQL condition on `subscribers s`: the one rule behind the list
 * (/api/staff/subscribers), the home summary and the payments page, so they can never disagree about the set.
 * `{ none: true }` for a role that sees no clients, `{ forbidden: true }` for a scope that needs a staff record
 * the account does not have; otherwise `{ where, params }` (params follow the tenant id).
 */
function staffSubscriberScope(req) {
  const staffId  = req.staffRecord?.id;
  const isSuper  = !!req.isSuperAdmin;
  const scope    = resolveDataScope(req.staffRecord, { isSuperAdmin: isSuper, fallback: 'assigned_sales' });
  if (scope === 'none') return { none: true };

  let whereClause = '1=1';
  const params    = [];

  if (scope === 'all') {
    // Full access — return everything (excluding staff/admin emails)
    const adminExclusions = ADMIN_EMAILS.length > 0
      ? ` AND (s.email IS NULL OR s.email NOT IN (${ADMIN_EMAILS.map(() => '?').join(',')}))`
      : '';
    whereClause = `NOT EXISTS (
      SELECT 1 FROM staff st WHERE st.tenant_id=s.tenant_id AND st.email = s.email AND st.is_active = 1
    )${adminExclusions}`;
    params.push(...ADMIN_EMAILS.map(e => e.toLowerCase()));
  } else if (scope === 'assigned_sales') {
    if (!staffId) return { forbidden: true };
    // See the matching comment on /api/admin/subscribers above — crm_json is a
    // stale creation-time snapshot, not a live mirror of the column.
    whereClause = `(s.assigned_sales_id = ? OR (s.lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM leads l WHERE l.id = s.lead_id AND l.tenant_id=s.tenant_id AND l.assigned_sales_id = ?)))`;
    params.push(staffId, staffId);
  } else if (scope === 'assigned_cs') {
    if (!staffId) return { forbidden: true };
    whereClause = `s.assigned_cs_id = ?`;
    params.push(staffId);
  } else if (scope.startsWith('branch:')) {
    const branches = branchesFromScope(scope); // e.g. 'DAQQI' or 'ONLINE_EGYPT,ONLINE_SAUDI'
    whereClause = branches.length ? ownOrPlaced(branches) : '1=0';
    params.push(...branches, ...branches);
  }
  return { where: whereClause, params };
}

/**
 * The clients of one query as the staff screens read them: payments, enrolments, instalment plans, placements and
 * certificates. `lite` leaves out what only the row on screen shows (who recorded each payment, the certificate
 * requests), for the pass that filters a whole scope before one page of it is shaped in full.
 */
async function shapeStaffSubscribers(tenantId, rows, { lite = false } = {}) {
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id);
  const plansBySub = await installmentPlansBySubscriber(tenantId, ids);
  // A course placed in another branch than the client's (lib/coursePlacement.js).
  const placementsBySub = await loadPlacements(pool, tenantId, ids);
  const [payRows] = await pool.query(
    `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
            payment_type, payment_method, transaction_id, is_installment, course_expected, \`date\`, note,
            status, staff_id, staff_name, from_account, source, item_title, cert_type,
            certificate_request_id, branch
     FROM payments
     WHERE tenant_id=? AND subscriber_id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL
     ORDER BY \`date\` ASC`,
    [tenantId, ...ids]
  );
  const executors = lite ? new Map() : await resolvePaymentExecutors(pool, tenantId, payRows);
  const payBySubId = {};
  payRows.forEach(p => {
    if (!payBySubId[p.subscriber_id]) payBySubId[p.subscriber_id] = [];
    const dateStr = safeDateOnly(p.date);
    payBySubId[p.subscriber_id].push({
      id: p.id, amount: Number(p.amount)||0, currency: p.currency||'EGP',
      paymentType: (p.payment_type||'other').toLowerCase(), paymentMethod: p.payment_method||null,
      transactionId: p.transaction_id||null, isInstallment: !!p.is_installment,
      courseId: p.course_id||null, bundleId: p.bundle_id||null,
      courseExpected: p.course_expected != null ? Number(p.course_expected) : undefined,
      note: p.note||null, at: dateStr,
      status: p.status||'paid', staffId: p.staff_id||null, staffName: executors.get(String(p.id)) ?? null,
      fromAccountNumber: p.from_account||null, source: p.source||null, itemTitle: p.item_title||null,
      certType: p.cert_type || null, certId: p.certificate_request_id || null, branch: p.branch || null,
    });
  });

  const enrollmentProjection = await loadEnrollmentProjection(tenantId, ids);
  const completionProjection = await loadCompletionProjection(tenantId, ids);

  const [staffCertificateRows] = lite ? [[]] : await pool.query(
    `SELECT id, subscriber_id, course_id, type, custom_name, name_ar, name_en,
            nationality, id_number, status, price, paid_amount, currency, note,
            admin_note, requested_at, issued_at
     FROM certificate_requests
     WHERE tenant_id=? AND subscriber_id IN (${ids.map(() => '?').join(',')})
     ORDER BY requested_at DESC`,
    [tenantId, ...ids]
  );
  const certificatePricingConfig = lite ? null : await certificatePricing(pool, tenantId);
  const staffCertificatesBySub = {};
  staffCertificateRows.forEach(request => {
    if (!staffCertificatesBySub[request.subscriber_id]) staffCertificatesBySub[request.subscriber_id] = [];
    staffCertificatesBySub[request.subscriber_id].push({
      id: request.id,
      courseId: request.course_id || undefined,
      type: String(request.type || 'OTHER').toLowerCase(),
      customName: request.custom_name || undefined,
      nameAr: request.name_ar || undefined,
      nameEn: request.name_en || undefined,
      nationality: request.nationality ? String(request.nationality).toLowerCase() : undefined,
      idNumber: request.id_number || undefined,
      status: String(request.status || 'PENDING').toLowerCase(),
      price: certificateDue(certificatePricingConfig, request) || undefined,
      paidAmount: request.paid_amount != null ? Number(request.paid_amount) : 0,
      currency: request.currency || undefined,
      requestedAt: safeIsoString(request.requested_at) || null,
      issuedAt: safeIsoString(request.issued_at) || undefined,
      note: request.note || undefined,
      adminNote: request.admin_note || undefined,
    });
  });

  return rows.map(r => {
    const crm = withInstallmentPlans(parseCrm(r.crm_json), plansBySub.get(r.id));
    const paymentHistory = payBySubId[r.id]?.length > 0 ? payBySubId[r.id] : [];
    const enrolledCourseIds = enrollmentProjection[r.id]?.ids || [];
    const rb = r.branch || crm.branch || null;
    const nb = rb ? rb.toUpperCase().replace(/[-\s]/g,'_') : null;
    return {
      id: r.id, name: r.name, email: r.email, phone: r.phone, phone2: r.phone2 || '',
      firebaseUid: r.firebase_uid, isActive: !!r.is_active,
      notes: r.notes, createdAt: r.created_at,
      ...crm, coursePlacements: placementsBySub.get(r.id) || {},
      enrolledCourseIds,
      enrolledBundleIds: enrollmentProjection[r.id]?.bundleIds || [],
      courseAccess: enrollmentProjection[r.id]?.access || {},
      certificates: completionProjection[r.id] || [],
      clientCode: r.client_code || crm.clientCode || null,
      paymentHistory,
      extraCertificateRequests: staffCertificatesBySub[r.id] || [],
      branch: (nb && VALID_BRANCHES.has(nb)) ? nb : rb,
      clientType: r.client_type || null,
      assignedSalesId:   r.assigned_sales_id || null,
      assignedSalesName: r.assigned_sales_name || null,
      assignedCsId:      r.assigned_cs_id || null,
      assignedCsName:    r.assigned_cs_name || null,
      updatedAt: safeIsoString(r.updated_at) || null,
    };
  });
}

/**
 * GET /api/staff/subscribers?paged=1 — «عملائي» a page at a time: { rows, total, tabCounts, followCounts, figures }.
 *
 *   view     active | real-local | real-saudi | real-intl | finished | paused | refunded | old_local | old_intl
 *   q, from, to, course, collector (a staff id, or __none__), status, cert, remaining, follow — the screen's filters
 *   limit, offset
 *
 * The same clients and the same rules the screen applied to its whole downloaded list (lib/staffClientsView.js), so
 * the page, the total, the tab counts and the figures above the table agree with one another as they did there.
 */
async function staffClientsPage(req, sc) {
  const tenantId = req.tenantId;
  const filters = readClientFilters(req.query);
  const limit = parseLimit(req.query.limit, 24, 500);
  const offset = parseOffset(req.query.offset || 0);
  const [rows] = await pool.query(
    `SELECT s.*,
            COALESCE(ss.name, s.assigned_sales_name) AS assigned_sales_name,
            COALESCE(cs.name, s.assigned_cs_name)    AS assigned_cs_name
       FROM subscribers s
       LEFT JOIN staff ss ON ss.id = s.assigned_sales_id AND ss.tenant_id=s.tenant_id
       LEFT JOIN staff cs ON cs.id = s.assigned_cs_id AND cs.tenant_id=s.tenant_id
      WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND (${sc.where})
      ORDER BY s.created_at DESC, s.id DESC`,
    [tenantId, ...sc.params]
  );
  const clients = [];
  for (let i = 0; i < rows.length; i += 1000) clients.push(...await shapeStaffSubscribers(tenantId, rows.slice(i, i + 1000), { lite: true }));

  const catalogueRows = await cached(`staff-clients:catalogue:${tenantId}`, 30 * 1000, async () => {
    const [courses] = await pool.query('SELECT id, price_egp, price_sar, price_usd FROM courses WHERE tenant_id=?', [tenantId]);
    const [bundles] = await pool.query(
      `SELECT b.id, b.price_egp, b.price_sar, b.price_usd, GROUP_CONCAT(bc.course_id) AS course_ids
         FROM bundles b LEFT JOIN bundle_courses bc ON bc.bundle_id = b.id WHERE b.tenant_id=? GROUP BY b.id`, [tenantId]);
    return { courses, bundles };
  });
  const priceOf = row => ({ EGP: Number(row.price_egp) || 0, SAR: Number(row.price_sar) || 0, USD: Number(row.price_usd) || 0 });
  const catalogue = {
    courses: new Map(catalogueRows.courses.map(row => [row.id, { price: priceOf(row) }])),
    bundles: new Map(catalogueRows.bundles.map(row => [row.id, { price: priceOf(row), courseIds: row.course_ids ? String(row.course_ids).split(',') : [] }])),
  };

  const today = cairoToday();
  const view = buildClientsView(clients, filters, {
    today, catalogue,
    weekStart: addDaysToDateOnly(today, -new Date(`${today}T00:00:00Z`).getUTCDay()),
    monthStart: `${today.slice(0, 7)}-01`,
    // A rep's «عملائي» is every client they sold, whichever branch studies (the screen's isSalesStaff).
    allBranches: String(req.staffRecord?.role || '').toLowerCase() === 'sales',
  });
  const rowById = new Map(rows.map(row => [row.id, row]));
  const pageRows = view.ids.slice(offset, offset + limit).map(id => rowById.get(id));
  return {
    rows: await shapeStaffSubscribers(tenantId, pageRows),
    total: view.ids.length, tabCounts: view.tabCounts, followCounts: view.followCounts, figures: view.figures,
  };
}

router.get('/api/staff/subscribers', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    const sc = staffSubscriberScope(req);
    if (sc.none) return res.json([]);
    if (sc.forbidden) return res.status(403).json({ error: 'Staff record required' });
    if (req.query.paged === '1') return res.json(await staffClientsPage(req, sc));
    const whereClause = sc.where;
    const params    = [req.tenantId, ...sc.params];

    const limit  = parseLimit(req.query.limit, 5000, 10000);
    const offset = parseOffset(req.query.offset || 0);
    const byBranch = branchFilter(req);
    // q: a name, phone or client code (the pickers that search while the person types, as the refund form does).
    const term = String(req.query.q || '').trim().slice(0, 100);
    const byTerm = term ? { sql: ' AND (s.name LIKE ? OR s.phone LIKE ? OR s.client_code LIKE ?)', params: [`%${term}%`, `%${term}%`, `%${term}%`] } : { sql: '', params: [] };
    params.push(...byBranch.params, ...byTerm.params, limit, offset);

    const [rows] = await pool.query(
      `SELECT s.*,
              COALESCE(ss.name, s.assigned_sales_name) AS assigned_sales_name,
              COALESCE(cs.name, s.assigned_cs_name)    AS assigned_cs_name
       FROM subscribers s
       LEFT JOIN staff ss ON ss.id = s.assigned_sales_id AND ss.tenant_id=s.tenant_id
       LEFT JOIN staff cs ON cs.id = s.assigned_cs_id AND cs.tenant_id=s.tenant_id
       WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND (${whereClause})${byBranch.sql}${byTerm.sql}
       ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`,
      params
    );
    res.json(await shapeStaffSubscribers(req.tenantId, rows));
  } catch (e) { logger.error('[/api/staff/subscribers]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/staff/leads
// UNIFIED endpoint — server scopes leads automatically based on role.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/staff/leads', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const staffId = req.staffRecord?.id;
    const role    = (req.staffRecord?.role || '').toLowerCase();
    const isSuper = !!req.isSuperAdmin;
    const scope   = resolveDataScope(req.staffRecord, { isSuperAdmin: isSuper, fallback: 'assigned_sales' });

    // Roles that should NOT see leads at all. Skipped when the staff row carries
    // an explicit data_scope: that column exists precisely to describe a hybrid
    // job (an HR lead who also runs sales), and a role blocklist would silently
    // override the scope the admin deliberately set.
    // Collection is not on it any more: the desk distributes remaining data to
    // the collection team and they add leads of their own, and they work them
    // from the same «عملائي المحتملون» view a sales rep has.
    const noLeadsRoles = new Set(['support', 'hr', 'accountant', 'trainer', 'instructor']);
    const scopedByHand = Boolean(normalizeDataScope(req.staffRecord?.data_scope));
    if (!isSuper && !scopedByHand && noLeadsRoles.has(role)) return res.json([]);
    if (scope === 'none') return res.json([]);

    let whereClause = 'hidden = 0';
    const params = [];

    if (scope === 'assigned_sales') {
      if (!staffId) return res.status(403).json({ error: 'Staff record required' });
      whereClause = 'hidden = 0 AND assigned_sales_id = ?';
      params.push(staffId);
    }
    // The same set lib/leadAccess.js gives every other lead route.
    else if (scope === 'assigned_cs') {
      if (!staffId) return res.status(403).json({ error: 'Staff record required' });
      whereClause = `hidden = 0 AND (assigned_cs_id = ? OR id IN (SELECT lead_id FROM subscribers WHERE tenant_id=? AND assigned_cs_id=? AND lead_id IS NOT NULL))`;
      params.push(staffId, req.tenantId, staffId);
    }
    // 'all' sees all leads; branch scopes see what lib/leadAccess.js gives
    // them — their branch, or the Dokki desk the leads handed to its team.
    else if (scope.startsWith('branch:')) {
      const branchScope = leadScope(req, 'leads');
      whereClause = `hidden = 0${branchScope.sql}`;
      params.push(...branchScope.params);
    }

    const limit  = parseLimit(req.query.limit, 5000, 20000);
    const offset = parseOffset(req.query.offset || 0);
    params.push(limit, offset);

    const [rows] = await pool.query(
      `SELECT * FROM leads WHERE tenant_id = ? AND (${whereClause}) ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [req.tenantId, ...params]
    );
    res.json(rows.map(mapStaffLeadRow));
  } catch (e) { logger.error('[/api/staff/leads]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/my-subscribers — SALES staff fetch their own subscribers (assigned_sales_id = me)
router.get('/api/staff/my-subscribers', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    const staffId = req.staffRecord?.id;
    if (!staffId) return res.status(403).json({ error: 'Staff record not found' });

    const [rows] = await pool.query(
      `SELECT DISTINCT s.* FROM subscribers s
       LEFT JOIN leads l ON l.id = s.lead_id AND l.tenant_id=s.tenant_id
       WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND (
             s.assigned_sales_id = ?
          OR (s.lead_id IS NOT NULL AND l.assigned_sales_id = ?))
       ORDER BY s.created_at DESC LIMIT 2000`,
      [req.tenantId, staffId, staffId]
    );
    if (rows.length === 0) return res.json([]);

    // An "auto-backfill" used to live here: any row that only matched via the
    // crm_json OR-fallback above (assigned_sales_id column NULL) got silently
    // UPDATEd back to this staff member's id, on every GET of this list. That
    // matched the crm_json fallback's premise at the time — crm_json was assumed
    // to only ever hold a value that was still true. A bulk unassign broke that
    // assumption at scale (crm_json keeps whatever was true at creation, forever,
    // regardless of later reassignment/unassignment): the fallback alone made
    // unassigned subscribers reappear in "my subscribers", and this backfill made
    // that reappearance permanent again the moment the rep so much as loaded
    // their list. Removed along with the fallback it depended on.

    const ids = rows.map(r => r.id);
    const plansBySub = await installmentPlansBySubscriber(req.tenantId, ids);
    // A course placed in another branch than the client's (lib/coursePlacement.js).
    const placementsBySub = await loadPlacements(pool, req.tenantId, ids);
    const enrollmentProjection = await loadEnrollmentProjection(req.tenantId, ids);
    const completionProjection = await loadCompletionProjection(req.tenantId, ids);
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title
       FROM payments
       WHERE tenant_id=? AND subscriber_id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL
       ORDER BY \`date\` ASC`,
      [req.tenantId, ...ids]
    );
    const executors = await resolvePaymentExecutors(pool, req.tenantId, payRows);
    const payBySubId = {};
    payRows.forEach(p => {
      if (!payBySubId[p.subscriber_id]) payBySubId[p.subscriber_id] = [];
      const dateStr = safeDateOnly(p.date);
      payBySubId[p.subscriber_id].push({
        id: p.id, amount: Number(p.amount) || 0, currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(), paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null, isInstallment: !!p.is_installment,
        courseId: p.course_id || null, bundleId: p.bundle_id || null, note: p.note || null, at: dateStr,
        status: p.status || 'paid', staffId: p.staff_id || null,
        staffName: executors.get(String(p.id)) ?? null, fromAccountNumber: p.from_account || null,
        source: p.source || null, itemTitle: p.item_title || null,
      });
    });

    res.json(rows.map(r => {
      const crm = withInstallmentPlans(parseCrm(r.crm_json), plansBySub.get(r.id));
      const clientCode = r.client_code || crm.clientCode || null;
      const paymentHistory = payBySubId[r.id]?.length > 0 ? payBySubId[r.id] : [];
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone, phone2: r.phone2 || '',
        firebaseUid: r.firebase_uid, isActive: !!r.is_active,
        notes: r.notes, createdAt: r.created_at, ...crm, coursePlacements: placementsBySub.get(r.id) || {},
        enrolledCourseIds: enrollmentProjection[r.id]?.ids || [],
        enrolledBundleIds: enrollmentProjection[r.id]?.bundleIds || [],
        courseAccess: enrollmentProjection[r.id]?.access || {},
        certificates: completionProjection[r.id] || [],
        clientCode, paymentHistory,
        branch: (() => { const rb = r.branch || crm.branch || null; if (!rb) return null; const nb = rb.toUpperCase().replace(/[-\s]/g,'_'); return ['DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER'].includes(nb) ? nb : rb; })(),
        clientType: r.client_type || null,
        assignedSalesId: r.assigned_sales_id || null,
        assignedSalesName: r.assigned_sales_name || null,
        updatedAt: safeIsoString(r.updated_at) || null,
      };
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/my-collection-clients — collection staff fetch their own assigned subscribers
router.get('/api/staff/my-collection-clients', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    const staffId = req.staffRecord?.id;
    if (!staffId) return res.status(403).json({ error: 'Staff record not found' });

    const [rows] = await pool.query(
      `SELECT DISTINCT s.* FROM subscribers s
       WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND (
             s.assigned_cs_id = ?
           OR ((s.assigned_cs_id IS NULL OR s.assigned_cs_id = '') AND s.assigned_cs_name = (SELECT name FROM staff WHERE id=? AND tenant_id=? LIMIT 1))
          OR ((s.assigned_cs_id IS NULL OR s.assigned_cs_id = '') AND s.crm_json IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.assignedCollectionId')) = ?)
           OR ((s.assigned_cs_id IS NULL OR s.assigned_cs_id = '') AND s.crm_json IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.assignedCollectionName')) = (SELECT name FROM staff WHERE id=? AND tenant_id=? LIMIT 1)))
       ORDER BY s.created_at DESC LIMIT 5000`,
      [req.tenantId, staffId, staffId, req.tenantId, staffId, staffId, req.tenantId]
    );
    if (rows.length === 0) return res.json([]);

    const ids = rows.map(r => r.id);
    const plansBySub = await installmentPlansBySubscriber(req.tenantId, ids);
    // A course placed in another branch than the client's (lib/coursePlacement.js).
    const placementsBySub = await loadPlacements(pool, req.tenantId, ids);
    const enrollmentProjection = await loadEnrollmentProjection(req.tenantId, ids);
    const completionProjection = await loadCompletionProjection(req.tenantId, ids);
    // Show ALL payments for assigned clients (not filtered by staff_id — client may have payments from multiple staff)
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title
       FROM payments
       WHERE tenant_id=? AND subscriber_id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL
       ORDER BY \`date\` ASC`,
      [req.tenantId, ...ids]
    );
    const executors = await resolvePaymentExecutors(pool, req.tenantId, payRows);
    const payBySubId = {};
    payRows.forEach(p => {
      if (!payBySubId[p.subscriber_id]) payBySubId[p.subscriber_id] = [];
      const dateStr = safeDateOnly(p.date);
      payBySubId[p.subscriber_id].push({
        id: p.id, amount: Number(p.amount) || 0, currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(), paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null, isInstallment: !!p.is_installment,
        courseId: p.course_id || null, bundleId: p.bundle_id || null, note: p.note || null, at: dateStr,
        status: p.status || 'paid', staffId: p.staff_id || null,
        staffName: executors.get(String(p.id)) ?? null, fromAccountNumber: p.from_account || null,
        source: p.source || null, itemTitle: p.item_title || null,
      });
    });

    res.json(rows.map(r => {
      const crm = withInstallmentPlans(parseCrm(r.crm_json), plansBySub.get(r.id));
      const clientCode = r.client_code || crm.clientCode || null;
      const paymentHistory = payBySubId[r.id]?.length > 0 ? payBySubId[r.id] : [];
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone, phone2: r.phone2 || '',
        firebaseUid: r.firebase_uid, isActive: !!r.is_active,
        notes: r.notes, createdAt: r.created_at, ...crm, coursePlacements: placementsBySub.get(r.id) || {},
        enrolledCourseIds: enrollmentProjection[r.id]?.ids || [],
        enrolledBundleIds: enrollmentProjection[r.id]?.bundleIds || [],
        courseAccess: enrollmentProjection[r.id]?.access || {},
        certificates: completionProjection[r.id] || [],
        clientCode, paymentHistory,
        branch: (() => { const rb = r.branch || crm.branch || null; if (!rb) return null; const nb = rb.toUpperCase().replace(/[-\s]/g,'_'); return ['DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER'].includes(nb) ? nb : rb; })(),
        assignedSalesId: r.assigned_sales_id || null,
        assignedSalesName: r.assigned_sales_name || null,
        assignedCollectionId: r.assigned_cs_id || null,
        assignedCollectionName: r.assigned_cs_name || null,
        updatedAt: safeIsoString(r.updated_at) || null,
      };
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/my-daqqi-clients — reception_daqqi staff fetch subscribers with branch=DAQQI
router.get('/api/staff/my-daqqi-clients', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), async (req, res) => {
  // SECURITY: only RECEPTION_DAQQI staff (or super-admins) may access this endpoint
  if (!req.isSuperAdmin) {
    const allowedRoles = new Set(['ADMIN', 'MANAGER', ...BRANCH_ROLES]);
    const staffRole = (req.staffRecord?.role || '').toUpperCase();
    if (!allowedRoles.has(staffRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
  }
  try {
    // ?branch=TAGAMOA for the Tagamoa desk; a branch's own staff get their branch.
    const branch = requestedBranch(req);
    const [rows] = await pool.query(
      `SELECT s.* FROM subscribers s
       WHERE s.tenant_id=? AND s.deleted_at IS NULL AND s.branch = ?
       ORDER BY s.created_at DESC LIMIT 5000`
      , [req.tenantId, branch]
    );
    if (rows.length === 0) return res.json([]);

    const ids = rows.map(r => r.id);
    const plansBySub = await installmentPlansBySubscriber(req.tenantId, ids);
    // A course placed in another branch than the client's (lib/coursePlacement.js).
    const placementsBySub = await loadPlacements(pool, req.tenantId, ids);
    const enrollmentProjection = await loadEnrollmentProjection(req.tenantId, ids);
    const completionProjection = await loadCompletionProjection(req.tenantId, ids);
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title
       FROM payments
       WHERE tenant_id=? AND subscriber_id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL
       ORDER BY \`date\` ASC`,
      [req.tenantId, ...ids]
    );
    const executors = await resolvePaymentExecutors(pool, req.tenantId, payRows);
    const payBySubId = {};
    payRows.forEach(p => {
      if (!payBySubId[p.subscriber_id]) payBySubId[p.subscriber_id] = [];
      const dateStr = safeDateOnly(p.date);
      payBySubId[p.subscriber_id].push({
        id: p.id, amount: Number(p.amount) || 0, currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(), paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null, isInstallment: !!p.is_installment,
        courseId: p.course_id || null, bundleId: p.bundle_id || null, note: p.note || null, at: dateStr,
        status: p.status || 'paid', staffId: p.staff_id || null, staffName: executors.get(String(p.id)) ?? null,
        fromAccountNumber: p.from_account || null, source: p.source || null, itemTitle: p.item_title || null,
      });
    });

    res.json(rows.map(r => {
      const crm = withInstallmentPlans(parseCrm(r.crm_json), plansBySub.get(r.id));
      const clientCode = r.client_code || crm.clientCode || null;
      const paymentHistory = payBySubId[r.id]?.length > 0 ? payBySubId[r.id] : [];
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone, phone2: r.phone2 || '',
        firebaseUid: r.firebase_uid, isActive: !!r.is_active,
        notes: r.notes, createdAt: r.created_at, ...crm, coursePlacements: placementsBySub.get(r.id) || {},
        enrolledCourseIds: enrollmentProjection[r.id]?.ids || [],
        enrolledBundleIds: enrollmentProjection[r.id]?.bundleIds || [],
        courseAccess: enrollmentProjection[r.id]?.access || {},
        certificates: completionProjection[r.id] || [],
        clientCode, paymentHistory,
        branch,
        assignedSalesId: r.assigned_sales_id || null,
        assignedSalesName: r.assigned_sales_name || null,
        assignedCsId: r.assigned_cs_id || null,
        assignedCsName: r.assigned_cs_name || null,
        status: crm.status || (r.is_active ? 'active' : 'inactive'),
        installmentPlans: crm.installmentPlans || [],
      };
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/subscribers/:id/assign-collection — assign a subscriber to a collection staff
// PUT /api/admin/subscribers/:id/course-branch { item, branch } — «تحويل جزئي لكورس معين»: one course (or track)
// of a client placed in another branch, or — with no branch — put back in the client's own. The client keeps
// one file; each branch lists them and shows only the courses that are its own (lib/coursePlacement.js).
router.put('/api/admin/subscribers/:id/course-branch', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    const scope = subscriberScope(req);
    if (scope.none) return res.status(404).json({ error: 'Not found' });
    if (scope.forbidden) return res.status(403).json({ error: 'Staff record required' });
    const [[subscriber]] = await pool.query(
      `SELECT s.id, s.name, s.branch FROM subscribers s WHERE s.id = ? AND s.tenant_id = ? AND s.deleted_at IS NULL AND (${scope.clause})`,
      [req.params.id, req.tenantId, ...scope.params]);
    if (!subscriber) return res.status(404).json({ error: 'Not found' });
    const actor = req.staffRecord?.name || req.user?.email || 'staff';
    const placed = await placeCourse(pool, { tenantId: req.tenantId, subscriberId: subscriber.id, item: req.body?.item, branch: req.body?.branch, actor });
    const { logClientEvent } = require('../../lib/clientHistory');
    const [[course]] = await pool.query('SELECT title FROM courses WHERE id = ? AND tenant_id = ? LIMIT 1', [String(placed.item).replace(/^bundle:/, ''), req.tenantId]).catch(() => [[null]]);
    await logClientEvent(pool, {
      tenantId: req.tenantId, subscriberId: subscriber.id, action: 'course_branch', actor,
      label: placed.branch ? `اتنقل كورس «${course?.title || placed.item}» لفرع ${placed.branch}` : `رجع كورس «${course?.title || placed.item}» لفرع العميل (${subscriber.branch || '—'})`,
    }).catch(() => {});
    res.json({ ok: true, ...placed });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    logger.error('[course-branch]', e.message);
    sendRouteError(res, e);
  }
});

router.put('/api/admin/subscribers/:id/assign-collection', requireAuth, requireAdminOrStaff, requirePermission('manage_subscribers'), async (req, res) => {
  let conn;
  try {
    const subId = req.params.id;
    const { collectionId } = req.body || {};
    if (!subId) return res.status(400).json({ error: 'Missing subscriber id' });
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[row]] = await conn.query('SELECT crm_json FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE', [subId, req.tenantId]);
    if (!row) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Subscriber not found' }); }
    let collection = null;
    if (collectionId) {
      [[collection]] = await conn.query("SELECT id,name FROM staff WHERE id=? AND tenant_id=? AND UPPER(role)='COLLECTION' AND is_active=1 LIMIT 1", [collectionId, req.tenantId]);
      if (!collection) { await conn.rollback(); conn.release(); conn = null; return res.status(400).json({ error: 'Invalid collection staff' }); }
    }
    const crm = tryJson(row.crm_json, {});
    crm.assignedCollectionId = collection?.id || null;
    crm.assignedCollectionName = collection?.name || null;
    await conn.query(
      'UPDATE subscribers SET assigned_cs_id=?, assigned_cs_name=?, crm_json=? WHERE id=? AND tenant_id=?',
      [collection?.id || null, collection?.name || null, JSON.stringify(crm), subId, req.tenantId]
    );
    await conn.commit(); conn.release(); conn = null;
    res.json({ ok: true });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/bulk-assign-collection — hand the unassigned subscribers to
// collection, by the rules on «التحصيل: التوزيع والشيتات»: only officers
// switched on, each within their markets (محلي / سعودي / دولي) and up to their
// cap. A client nobody takes stays unassigned. With nothing configured it is
// the plain rotation over every collection employee it always was.
router.post('/api/admin/bulk-assign-collection', requireAuth, requireAdminOrStaff, requirePermission('manage_subscribers'), requireCollectionLead, bulkOperationLimiter, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection(); await conn.beginTransaction();
    // Get all active collection staff
    const [csRows] = await conn.query(
      "SELECT id, name FROM staff WHERE tenant_id=? AND UPPER(role)='COLLECTION' AND is_active=1 ORDER BY name FOR UPDATE", [req.tenantId]
    );
    if (csRows.length === 0) { await conn.rollback(); conn.release(); conn = null; return res.status(400).json({ error: 'لا يوجد موظفو تحصيل نشطون' }); }

    // Get all subscribers with no assigned_cs_id (and not daqqi branch), with
    // what decides their market: the desk's choice, their latest payment's
    // currency, their branch.
    const [unassigned] = await conn.query(
      `SELECT s.id, s.branch, JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.market')) AS market,
              (SELECT p.currency FROM payments p
                WHERE p.subscriber_id=s.id AND p.tenant_id=s.tenant_id AND p.deleted_at IS NULL
                  AND (p.status IS NULL OR p.status='paid')
                ORDER BY p.date DESC, p.created_at DESC LIMIT 1) AS latestCurrency
         FROM subscribers s
        WHERE s.tenant_id=? AND s.deleted_at IS NULL AND (s.assigned_cs_id IS NULL OR s.assigned_cs_id='')
          AND (s.branch IS NULL OR (s.branch NOT LIKE '%DAQQI%' AND s.branch <> 'TAGAMOA'))
        ORDER BY s.created_at ASC FOR UPDATE`, [req.tenantId]
    );
    if (unassigned.length === 0) { await conn.commit(); conn.release(); conn = null; return res.json({ ok: true, assigned: 0, message: 'لا يوجد مشتركون غير معيّنين' }); }

    const picker = await loadCollectionPicker(conn, req.tenantId);
    if (!picker.size) { await conn.rollback(); conn.release(); conn = null; return res.status(400).json({ error: 'مفيش مسئول تحصيل متاح للتوزيع — فعّل حد من «التحصيل: التوزيع والشيتات»' }); }

    let assigned = 0;
    const given = new Map();
    for (const row of unassigned) {
      const cs = picker.next(subscriberMarket(row));
      if (!cs) continue;
      await conn.query(
        'UPDATE subscribers SET assigned_cs_id=?, assigned_cs_name=? WHERE id=? AND tenant_id=?',
        [cs.id, cs.name, row.id, req.tenantId]
      );
      given.set(cs.name, (given.get(cs.name) || 0) + 1);
      assigned += 1;
    }
    await conn.commit(); conn.release(); conn = null;
    res.json({ ok: true, assigned, left: unassigned.length - assigned, staffCount: given.size, staff: [...given.keys()] });
  } catch (e) { if (conn) { await conn.rollback().catch(() => {}); conn.release(); } logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/client/:code — fetch ONE subscriber or lead by clientCode/id (staff-accessible)
// Sales staff can only see their own clients; admin sees any.

// ────────────────────────────────────────────────────────────
// GET /api/staff/home-summary — «شغل النهاردة» for the staff landing page.
//
// The page counted its figures in the browser out of every lead and every client in the person's scope (all of
// them were downloaded at sign-in, again after every write, every two minutes and at every return to the tab —
// 37,000 leads for one rep on the production-scale lab). The same figures from the database, with the few rows
// the page actually draws; held 15 s and dropped by the next write like the other counters (httpApp.js).
// ────────────────────────────────────────────────────────────
router.get('/api/staff/home-summary', requireAuth, requireAdminOrStaff, requireAnyPermission('view_leads', 'view_subscribers'), async (req, res) => {
  try {
    const staff = req.staffRecord;
    const isSuper = !!req.isSuperAdmin;
    const may = permission => isSuper || (staff && hasPermission(staff, permission));
    const today = cairoToday();
    const key = `figures:staff-home:${req.tenantId}:${staff?.id || req.user?.uid}:${today}`;
    const payload = await cached(key, 15 * 1000, async () => {
      const out = {
        totalLeads: 0, converted: 0, convertedThisMonth: 0, newThisMonth: 0, callsThisMonth: 0, last7: [],
        overdue: [], today: [], recent: [], urgent: [], clients: 0,
        // This month's new clients, by the week the monthly target ring draws (days 1-7, 8-14, 15-21, 22-28), and all of them.
        signups: { month: 0, weeks: [0, 0, 0, 0] },
      };
      const monthStart = cairoDayStartUtc(`${today.slice(0, 7)}-01`);
      const days = Array.from({ length: 7 }, (_, i) => addDaysToDateOnly(today, i - 6));
      const sevenAgo = cairoDayStartUtc(days[0]);
      const sinceUtc = sevenAgo < monthStart ? sevenAgo : monthStart;

      if (may('view_leads')) {
        const scope = leadScope(req, 'l');
        if (!scope.none) {
          const base = `FROM leads l WHERE l.tenant_id=? AND l.hidden=0${scope.sql}`;
          const p = [req.tenantId, ...scope.params];
          const openSql = `l.status NOT IN ${TERMINAL_SQL}`;
          const [[[totals]], [[month]], [overdue], [dueToday], [recent], [urgent], [calls], [convDays]] = await Promise.all([
            pool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(l.status IN ${CONVERTED_SQL}), 0) AS converted,
                                COALESCE(SUM(l.status IN ${CONVERTED_SQL} AND l.updated_at >= ?), 0) AS convertedMonth ${base}`, [monthStart, ...p]),
            pool.query(`SELECT COUNT(*) AS n ${base} AND l.created_at >= ?`, [...p, monthStart]),
            pool.query(`SELECT l.* ${base} AND ${openSql} AND ${NEXT_FOLLOWUP} < ? ORDER BY ${NEXT_FOLLOWUP} ASC LIMIT 30`, [...p, today]),
            pool.query(`SELECT l.* ${base} AND ${openSql} AND ${NEXT_FOLLOWUP} = ? LIMIT 30`, [...p, today]),
            pool.query(`SELECT l.* ${base} ORDER BY l.updated_at DESC LIMIT 8`, p),
            pool.query(`SELECT l.* ${base} AND l.status IN ('new','interested','contacted') AND ${NEXT_FOLLOWUP} IS NULL ORDER BY l.created_at DESC LIMIT 5`, p),
            pool.query(
              `SELECT DATE(${sqlCairoWall('c.date')}) AS day, COUNT(*) AS n
                 FROM communications c JOIN leads l ON l.id=c.lead_id AND l.tenant_id=c.tenant_id
                WHERE l.tenant_id=? AND l.hidden=0${scope.sql} AND c.date >= ? GROUP BY day`, [...p, sinceUtc]),
            pool.query(
              `SELECT DATE(${sqlCairoWall('l.updated_at')}) AS day, COUNT(*) AS n ${base}
                 AND l.status IN ${CONVERTED_SQL} AND l.updated_at >= ? GROUP BY day`, [...p, sevenAgo]),
          ]);
          out.totalLeads = Number(totals.total) || 0;
          out.converted = Number(totals.converted) || 0;
          out.convertedThisMonth = Number(totals.convertedMonth) || 0;
          out.newThisMonth = Number(month.n) || 0;
          out.overdue = overdue.map(mapStaffLeadRow);
          out.today = dueToday.map(mapStaffLeadRow);
          out.recent = recent.map(mapStaffLeadRow);
          out.urgent = urgent.map(mapStaffLeadRow);
          const callsByDay = Object.fromEntries(calls.map(row => [String(row.day).slice(0, 10), Number(row.n) || 0]));
          const convByDay = Object.fromEntries(convDays.map(row => [String(row.day).slice(0, 10), Number(row.n) || 0]));
          out.callsThisMonth = Object.entries(callsByDay).filter(([day]) => day >= `${today.slice(0, 7)}-01`).reduce((sum, [, n]) => sum + n, 0);
          out.last7 = days.map(day => ({ day, calls: callsByDay[day] || 0, converted: convByDay[day] || 0 }));
        }
      }
      if (may('view_subscribers')) {
        const sc = staffSubscriberScope(req);
        if (!sc.none && !sc.forbidden) {
          const [[row]] = await pool.query(
            `SELECT COUNT(*) AS n FROM subscribers s WHERE s.tenant_id=? AND s.deleted_at IS NULL AND (${sc.where})`,
            [req.tenantId, ...sc.params]);
          out.clients = Number(row.n) || 0;
          const [signups] = await pool.query(
            `SELECT DAY(${sqlCairoWall('s.created_at')}) AS d, COUNT(*) AS n FROM subscribers s
              WHERE s.tenant_id=? AND s.deleted_at IS NULL AND (${sc.where}) AND s.created_at >= ? GROUP BY d`,
            [req.tenantId, ...sc.params, monthStart]);
          for (const row of signups) {
            const day = Number(row.d) || 0;
            const n = Number(row.n) || 0;
            out.signups.month += n;
            if (day >= 1 && day <= 28) out.signups.weeks[Math.floor((day - 1) / 7)] += n;
          }
        }
      }
      return out;
    });
    res.json(payload);
  } catch (e) { logger.error('[/api/staff/home-summary]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ────────────────────────────────────────────────────────────
// GET /api/staff/online-manager-summary — the online manager's two header badges and their panels
// («متابعات التحصيل والأقساط»: the instalments due and coming; «مشتركين جدد ومدفوعات»: the last seven days), over the
// manager's own clients. They were counted and listed in the browser out of every loaded client.
// ────────────────────────────────────────────────────────────
router.get('/api/staff/online-manager-summary', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    const sc = staffSubscriberScope(req);
    if (sc.none) return res.json({ installments: { overdue: 0, upcoming: 0, overdueRows: [], upcomingRows: [] }, newClients: { count: 0, rows: [] }, newPayments: { count: 0, rows: [] } });
    if (sc.forbidden) return res.status(403).json({ error: 'Staff record required' });
    const tenantId = req.tenantId;
    const today = cairoToday();
    const since = addDaysToDateOnly(today, -7);
    const scopeParams = [tenantId, ...sc.params];
    const live = `s.tenant_id = ? AND s.deleted_at IS NULL AND (${sc.where})`;
    const [[planRows], [newClients], [[paymentCount]], [newPayments]] = await Promise.all([
      pool.query(
        `SELECT ip.id, ip.course_id, ip.bundle_id, ip.title, ip.total_amount, ip.currency, ip.installments_count,
                ip.installment_amounts, ip.due_dates, ip.paid_dates, ip.paid_amounts, ip.notes, ip.created_at,
                COALESCE(c.title, b.title) AS course_title, s.id AS client_id, s.name, s.phone
           FROM installment_plans ip
           JOIN subscribers s ON s.id = ip.subscriber_id AND s.tenant_id = ip.tenant_id
           LEFT JOIN courses c ON c.id = ip.course_id AND c.tenant_id = ip.tenant_id
           LEFT JOIN bundles b ON b.id = ip.bundle_id AND b.tenant_id = ip.tenant_id
          WHERE ${live}`, scopeParams),
      pool.query(
        `SELECT s.id, s.name, s.email, s.phone, s.created_at FROM subscribers s
          WHERE ${live} AND s.created_at >= ? ORDER BY s.created_at DESC`, [...scopeParams, cairoDayStartUtc(since)]),
      pool.query(
        `SELECT COUNT(*) AS n FROM payments p JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
          WHERE ${live} AND p.deleted_at IS NULL AND p.date >= ?`, [...scopeParams, since]),
      pool.query(
        `SELECT s.name, p.amount, p.currency, p.payment_type, p.date FROM payments p
           JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
          WHERE ${live} AND p.deleted_at IS NULL AND p.date >= ? ORDER BY p.date DESC LIMIT 30`, [...scopeParams, since]),
    ]);
    const due = dueInstallments(
      planRows.map(row => ({ clientId: row.client_id, name: row.name, phone: row.phone, plan: mapInstallmentPlan(row) })),
      today, addDaysToDateOnly(today, 7));
    res.json({
      installments: { overdue: due.overdue.length, upcoming: due.upcoming.length, overdueRows: due.overdue.slice(0, 200), upcomingRows: due.upcoming.slice(0, 200) },
      newClients: {
        count: newClients.length,
        rows: newClients.slice(0, 200).map(row => ({ id: row.id, name: row.name, email: row.email, phone: row.phone, createdAt: safeIsoString(row.created_at) })),
      },
      newPayments: {
        count: Number(paymentCount.n) || 0,
        rows: newPayments.map(row => ({
          name: row.name, amount: Number(row.amount) || 0, currency: row.currency || 'EGP',
          paymentType: (row.payment_type || 'other').toLowerCase(), at: safeDateOnly(row.date),
        })),
      },
    });
  } catch (e) { logger.error('[/api/staff/online-manager-summary]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ────────────────────────────────────────────────────────────
// GET /api/staff/payments — «مدفوعاتي»: the payments of the person's own clients, a page at a time.
//
//   from, to   a Cairo day range (inclusive), either may be left out
//   status     paid | pending | failed | refunded   (paid also takes the rows with no status)
//   mine=1     only what this staff member recorded
//   q          client name, client code or transaction number
//   limit, offset
//   summary=1  also the headline figures, whatever the filters: confirmed money today / this week / this month
//              and how much is waiting for the manager
//
// The page built all of this in the browser from every client's payment history.
// ────────────────────────────────────────────────────────────
router.get('/api/staff/payments', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    const sc = staffSubscriberScope(req);
    if (sc.none) return res.json({ rows: [], total: 0 });
    if (sc.forbidden) return res.status(403).json({ error: 'Staff record required' });
    const dateOnly = value => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null);
    const from = dateOnly(req.query.from);
    const to = dateOnly(req.query.to);
    const limit = Math.min(300, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const base = `FROM payments p JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=p.tenant_id
       WHERE p.tenant_id=? AND p.deleted_at IS NULL AND s.deleted_at IS NULL AND (${sc.where})`;
    const baseParams = [req.tenantId, ...sc.params];
    const where = [];
    const params = [];
    if (from) { where.push('p.date >= ?'); params.push(cairoDayStartUtc(from)); }
    if (to) { where.push('p.date < ?'); params.push(cairoDayStartUtc(addDaysToDateOnly(to, 1))); }
    if (String(req.query.mine || '') === '1' && req.staffRecord?.id) { where.push('p.staff_id = ?'); params.push(req.staffRecord.id); }
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q) {
      where.push('(s.name LIKE ? OR s.client_code LIKE ? OR p.transaction_id LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    // The three groups the accounts desk sorts payments into: waiting, accepted (paid, or from before the column
    // had a status) and declined (failed or refunded); `declined` asks for the last two together.
    const GROUPS = {
      paid: "(p.status = 'paid' OR p.status IS NULL)",
      pending: "p.status = 'pending'",
      declined: "p.status IN ('failed', 'refunded')",
      failed: "p.status = 'failed'",
      refunded: "p.status = 'refunded'",
    };
    const status = String(req.query.status || '');
    const withoutStatus = `${base}${where.length ? ` AND ${where.join(' AND ')}` : ''}`;
    const filtered = GROUPS[status] ? `${withoutStatus} AND ${GROUPS[status]}` : withoutStatus;
    const [[[count]], [payRows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS n ${filtered}`, [...baseParams, ...params]),
      pool.query(
        `SELECT p.id, p.subscriber_id, p.course_id, p.bundle_id, p.amount, p.currency, p.payment_type, p.payment_method,
                p.transaction_id, p.is_installment, p.course_expected, p.\`date\`, p.note, p.status, p.staff_id, p.staff_name,
                p.from_account, p.source, p.item_title, p.cert_type, p.certificate_request_id, p.branch,
                s.name AS client_name, s.client_code, s.email AS client_email
           ${filtered} ORDER BY p.\`date\` DESC, p.created_at DESC LIMIT ? OFFSET ?`, [...baseParams, ...params, limit, offset]),
    ]);
    const executors = await resolvePaymentExecutors(pool, req.tenantId, payRows);
    const out = {
      total: Number(count.n) || 0,
      rows: payRows.map(p => ({
        id: p.id, clientId: p.subscriber_id, clientName: p.client_name, clientCode: p.client_code || '', clientEmail: p.client_email || '',
        amount: Number(p.amount) || 0, currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(), paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null, isInstallment: !!p.is_installment,
        courseId: p.course_id || null, bundleId: p.bundle_id || null,
        courseExpected: p.course_expected != null ? Number(p.course_expected) : undefined,
        note: p.note || null, at: safeDateOnly(p.date), status: p.status || 'paid', staffId: p.staff_id || null,
        staffName: executors.get(String(p.id)) ?? p.staff_name ?? null, fromAccountNumber: p.from_account || null,
        source: p.source || null, itemTitle: p.item_title || null, certType: p.cert_type || null,
        certId: p.certificate_request_id || null, branch: p.branch || null,
      })),
    };
    // tabs=1: how many payments each group holds under the other filters, the money (in pounds) of the group asked
    // for, and what the accepted ones brought in today and this month — the accounts desk's tabs and figures.
    if (String(req.query.tabs || '') === '1') {
      const today = cairoToday();
      const egp = "COALESCE(p.amount_egp, CASE WHEN p.currency='EGP' THEN p.amount ELSE 0 END)";
      const dayStart = cairoDayStartUtc(today);
      const tomorrowStart = cairoDayStartUtc(addDaysToDateOnly(today, 1));
      const monthStart = cairoDayStartUtc(`${today.slice(0, 7)}-01`);
      const [[row]] = await pool.query(
        `SELECT COALESCE(SUM(${GROUPS.pending}), 0) AS pending, COALESCE(SUM(${GROUPS.paid}), 0) AS accepted,
                COALESCE(SUM(${GROUPS.declined}), 0) AS declined,
                COALESCE(SUM(CASE WHEN ${GROUPS[status] || '1=1'} THEN ${egp} END), 0) AS groupSum,
                COALESCE(SUM(CASE WHEN ${GROUPS.paid} AND p.date >= ? AND p.date < ? THEN ${egp} END), 0) AS acceptedToday,
                COALESCE(SUM(CASE WHEN ${GROUPS.paid} AND p.date >= ? AND p.date < ? THEN ${egp} END), 0) AS acceptedMonth
           ${withoutStatus}`,
        [dayStart, tomorrowStart, monthStart, tomorrowStart, ...baseParams, ...params]);
      out.tabs = {
        pending: Number(row.pending) || 0, accepted: Number(row.accepted) || 0, declined: Number(row.declined) || 0,
        groupSumEgp: Number(row.groupSum) || 0, acceptedTodayEgp: Number(row.acceptedToday) || 0, acceptedMonthEgp: Number(row.acceptedMonth) || 0,
      };
    }
    if (String(req.query.summary || '') === '1') {
      const today = cairoToday();
      const weekStart = addDaysToDateOnly(today, -new Date(`${today}T00:00:00Z`).getUTCDay());
      const egp = "COALESCE(p.amount_egp, CASE WHEN p.currency='EGP' THEN p.amount ELSE 0 END)";
      const paid = "(p.status = 'paid' OR p.status IS NULL)";
      const [[row]] = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN ${paid} AND p.date >= ? AND p.date < ? THEN ${egp} END), 0) AS today,
                COALESCE(SUM(CASE WHEN ${paid} AND p.date >= ? AND p.date < ? THEN ${egp} END), 0) AS week,
                COALESCE(SUM(CASE WHEN ${paid} AND p.date >= ? AND p.date < ? THEN ${egp} END), 0) AS month,
                COUNT(DISTINCT CASE WHEN ${paid} AND p.date >= ? AND p.date < ? THEN p.subscriber_id END) AS paying,
                COALESCE(SUM(p.status = 'pending'), 0) AS pendingCount,
                COALESCE(SUM(CASE WHEN p.status = 'pending' THEN ${egp} END), 0) AS pendingSum
           ${base}`,
        [cairoDayStartUtc(today), cairoDayStartUtc(addDaysToDateOnly(today, 1)),
         cairoDayStartUtc(weekStart), cairoDayStartUtc(addDaysToDateOnly(today, 1)),
         cairoDayStartUtc(`${today.slice(0, 7)}-01`), cairoDayStartUtc(addDaysToDateOnly(today, 1)),
         cairoDayStartUtc(`${today.slice(0, 7)}-01`), cairoDayStartUtc(addDaysToDateOnly(today, 1)), ...baseParams]);
      out.summary = {
        today: Number(row.today) || 0, week: Number(row.week) || 0, month: Number(row.month) || 0, paying: Number(row.paying) || 0,
        pendingCount: Number(row.pendingCount) || 0, pendingSum: Number(row.pendingSum) || 0,
      };
    }
    res.json(out);
  } catch (e) { logger.error('[/api/staff/payments]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ────────────────────────────────────────────────────────────
// GET /api/staff/leads-kpis — the strip above «عملائي المحتملون» (calls today and this week, converted this month,
// open, overdue, conversion rate, money collected in pounds).
//
// The strip summed these over every lead and client of the rep, which the screen downloaded whole (37,000 leads and
// 5,000 clients with their payments on the production-scale lab) only to print seven numbers. The same figures
// from the database, over the same set: the person's own leads (leadScope) outside the imported archive, and their
// own clients' collected payments in EGP. Held 15 s and dropped by the next write like the other counters.
// ────────────────────────────────────────────────────────────
router.get('/api/staff/leads-kpis', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const staff = req.staffRecord;
    const may = permission => !!req.isSuperAdmin || (staff && hasPermission(staff, permission));
    const today = cairoToday();
    const key = `figures:staff-leads-kpis:${req.tenantId}:${staff?.id || req.user?.uid}:${today}`;
    const payload = await cached(key, 15 * 1000, async () => {
      const out = { totalLeads: 0, converted: 0, convertedThisMonth: 0, active: 0, overdue: 0, callsToday: 0, callsWeek: 0, collectedEgp: 0 };
      const scope = leadScope(req, 'l');
      if (!scope.none) {
        const monthStart = cairoDayStartUtc(`${today.slice(0, 7)}-01`);
        const dayStart = cairoDayStartUtc(today);
        const tomorrowStart = cairoDayStartUtc(addDaysToDateOnly(today, 1));
        const weekStart = cairoDayStartUtc(addDaysToDateOnly(today, -7));
        // The imported archive stays in its own tab, out of the rep's figures (leadSourceGroups.ts isArchiveSource).
        const live = `l.tenant_id=? AND l.hidden=0${scope.sql} AND NOT (${ARCHIVE_SOURCE_PREFIXES.map(() => "TRIM(COALESCE(l.source, '')) LIKE ?").join(' OR ')})`;
        const p = [req.tenantId, ...scope.params, ...ARCHIVE_SOURCE_PREFIXES.map(prefix => `${prefix}%`)];
        const open = `l.status NOT IN ${TERMINAL_SQL}`;
        const [[[totals]], [[calls]]] = await Promise.all([
          pool.query(
            `SELECT COUNT(*) AS total,
                    COALESCE(SUM(l.status IN ${CONVERTED_SQL}), 0) AS converted,
                    COALESCE(SUM(l.status IN ${CONVERTED_SQL} AND COALESCE(l.updated_at, l.created_at) >= ?), 0) AS convertedMonth,
                    COALESCE(SUM(${open}), 0) AS active,
                    COALESCE(SUM(${open} AND ${NEXT_FOLLOWUP} < ?), 0) AS overdue
               FROM leads l WHERE ${live}`, [monthStart, today, ...p]),
          pool.query(
            `SELECT COALESCE(SUM(c.date >= ? AND c.date < ?), 0) AS today, COUNT(*) AS week
               FROM communications c JOIN leads l ON l.id=c.lead_id AND l.tenant_id=c.tenant_id
              WHERE ${live} AND c.date >= ?`, [dayStart, tomorrowStart, ...p, weekStart]),
        ]);
        out.totalLeads = Number(totals.total) || 0;
        out.converted = Number(totals.converted) || 0;
        out.convertedThisMonth = Number(totals.convertedMonth) || 0;
        out.active = Number(totals.active) || 0;
        out.overdue = Number(totals.overdue) || 0;
        out.callsToday = Number(calls.today) || 0;
        out.callsWeek = Number(calls.week) || 0;
      }
      if (may('view_subscribers')) {
        const sc = staffSubscriberScope(req);
        if (!sc.none && !sc.forbidden) {
          const [[row]] = await pool.query(
            `SELECT COALESCE(SUM(p.amount), 0) AS collected
               FROM payments p JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=p.tenant_id
              WHERE p.tenant_id=? AND p.deleted_at IS NULL AND s.deleted_at IS NULL AND (${sc.where})
                AND (p.status = 'paid' OR p.status IS NULL OR p.status = '')
                AND COALESCE(NULLIF(p.currency, ''), 'EGP') = 'EGP'`,
            [req.tenantId, ...sc.params]);
          out.collectedEgp = Number(row.collected) || 0;
        }
      }
      return out;
    });
    res.json(payload);
  } catch (e) { logger.error('[/api/staff/leads-kpis]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
