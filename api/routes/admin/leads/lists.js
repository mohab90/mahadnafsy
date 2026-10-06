'use strict';
// The lead table, board, pool tabs and the full list — paged on the server.
// One part of routes/admin/leads.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  pool,
  parseLimit,
  parseOffset,
  sendRouteError,
  leadScope,
  communicationsByLead,
  requireAuth,
  requireAdminOrStaff,
  requirePermission,
  cairoToday,
  keyset,
  leadTableFilter,
  leadTableSearch,
  leadPoolFilter,
  poolBreakdown,
  POOL_REASON_COLUMN,
  identitySpellings,
  logger,
  mapLeadRow,
} = require('./_shared');

const router = Router();

// GET /api/admin/leads/table — one page of the CRM's main table, filtered and
// counted in the database (lib/leadTableFilter.js). The table used to download
// every lead to filter them in the browser, which stops working past the
// browser fetch's 50,000-row cap: the newest tenth was shown as the whole.
router.get('/api/admin/leads/table', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const accessScope = leadScope(req, 'l');
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 100, 1), 500);
    const page = Math.max(parseInt(req.query.page, 10) || 0, 0);
    if (accessScope.none) return res.json({ rows: [], total: 0, page, pageSize });
    // A rep's table is their own leads, whatever the desk filters say — the same
    // split the browser made on its role.
    const role = String(req.staffRecord?.role || '').toLowerCase();
    const salesOnly = !req.isSuperAdmin && ['sales', 'collection'].includes(role);
    const filter = leadTableFilter(req.query, { today: cairoToday(), salesOnly });
    const search = leadTableSearch(req.query.q);
    const hidden = req.query.hidden === '1' ? 1 : 0;
    const where = ` AND l.hidden = ?${accessScope.sql}${filter.sql}${search ? ` AND ${search.sql}` : ''}`;
    const whereParams = [hidden, ...accessScope.params, ...filter.params, ...(search?.params || [])];

    // The count reads every matching lead, so a page turn under the same
    // filters skips it (withTotal=0) — the client already holds the total.
    const counted = req.query.withTotal !== '0';
    const [[countRow], [rows]] = await Promise.all([
      counted
        ? pool.query(`SELECT COUNT(*) AS total FROM leads l WHERE l.tenant_id = ?${where}`, [req.tenantId, ...whereParams])
          .then(([result]) => result)
        : [null],
      // Deferred join, as in the list below: the OFFSET walks ids only.
      pool.query(
        `SELECT l.id, l.client_code, l.name, l.email, l.phone, l.source, l.status, l.lead_type, l.branch,
                l.interest_level, l.interested_course_ids_json, l.enrolled_course_id, l.deal_value,
                l.assigned_sales_id, COALESCE(ss.name, l.assigned_sales_name) AS assigned_sales_name,
                l.assigned_cs_id, COALESCE(cs.name, l.assigned_cs_name) AS assigned_cs_name,
                l.notes, l.last_follow_up, l.next_follow_up_date, l.crm_json, l.hidden, l.score, l.created_at, l.updated_at,
                (SELECT COUNT(*) FROM communications lc WHERE lc.tenant_id = l.tenant_id AND lc.lead_id = l.id) AS communication_count
           FROM (SELECT l.id FROM leads l WHERE l.tenant_id = ?${where}
                  ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?) pg
           JOIN leads l ON l.id = pg.id AND l.tenant_id = ?
           LEFT JOIN staff ss ON ss.id = l.assigned_sales_id AND ss.tenant_id = l.tenant_id
           LEFT JOIN staff cs ON cs.id = l.assigned_cs_id AND cs.tenant_id = l.tenant_id
          ORDER BY l.created_at DESC, l.id DESC`,
        [req.tenantId, ...whereParams, pageSize, page * pageSize, req.tenantId],
      ),
    ]);
    const commsByLead = await communicationsByLead({ tenantId: req.tenantId, leadIds: rows.map(row => row.id) });
    res.json({ rows: rows.map(r => mapLeadRow(r, commsByLead)), total: counted ? Number(countRow?.total || 0) : null, page, pageSize });
  } catch (e) { logger.error('[leads-table]', e.message); sendRouteError(res, e); }
});

// GET /api/admin/leads/board — the pipeline board, filtered like the table
// (the same query string, lib/leadTableFilter.js), grouped by status: each
// column's true count and its first cards. The board used to load every lead and
// group them in the browser, the last CRM screen that did.
//   statuses=new,contacted,…  the columns asked for
//   limits=new:30,…           cards per column (default 15, at most 500)
const BOARD_STATUS = /^[a-z_]{1,40}$/;
router.get('/api/admin/leads/board', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const statuses = [...new Set(String(req.query.statuses || '').split(',').map(v => v.trim().toLowerCase()).filter(v => BOARD_STATUS.test(v)))].slice(0, 40);
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) return res.json({ counts: {}, rows: [] });
    const limits = {};
    for (const pair of String(req.query.limits || '').split(',')) {
      const [status, n] = pair.split(':');
      if (BOARD_STATUS.test(status || '')) limits[status] = Math.min(Math.max(parseInt(n, 10) || 15, 1), 500);
    }
    const role = String(req.staffRecord?.role || '').toLowerCase();
    const salesOnly = !req.isSuperAdmin && ['sales', 'collection'].includes(role);
    const filter = leadTableFilter(req.query, { today: cairoToday(), salesOnly });
    const search = leadTableSearch(req.query.q);
    const hidden = req.query.hidden === '1' ? 1 : 0;
    const where = ` AND l.hidden = ?${accessScope.sql}${filter.sql}${search ? ` AND ${search.sql}` : ''}`;
    const whereParams = [hidden, ...accessScope.params, ...filter.params, ...(search?.params || [])];

    // Every status's count, so a column the board does not show yet but that
    // holds leads can still be offered (the browser showed a column once any
    // visible lead was in it).
    const [countRows] = await pool.query(
      `SELECT l.status, COUNT(*) AS n FROM leads l WHERE l.tenant_id = ?${where} GROUP BY l.status`,
      [req.tenantId, ...whereParams]);
    // The collation already groups 'NEW' with 'new'; the key is lowercased here,
    // as mapLeadRow lowercases the status the cards carry.
    const counts = {};
    for (const r of countRows) {
      const key = String(r.status || 'new').toLowerCase();
      counts[key] = (counts[key] || 0) + Number(r.n);
    }
    // One small query per column, each riding idx_leads_tenant_status_created.
    const pages = await Promise.all(statuses.filter(status => counts[status]).map(status => pool.query(
      `SELECT l.id, l.client_code, l.name, l.email, l.phone, l.source, l.status, l.lead_type, l.branch,
              l.interest_level, l.interested_course_ids_json, l.enrolled_course_id, l.deal_value,
              l.assigned_sales_id, COALESCE(ss.name, l.assigned_sales_name) AS assigned_sales_name,
              l.assigned_cs_id, COALESCE(cs.name, l.assigned_cs_name) AS assigned_cs_name,
              l.notes, l.last_follow_up, l.next_follow_up_date, l.crm_json, l.hidden, l.score, l.created_at, l.updated_at,
              (SELECT COUNT(*) FROM communications lc WHERE lc.tenant_id = l.tenant_id AND lc.lead_id = l.id) AS communication_count
         FROM leads l
         LEFT JOIN staff ss ON ss.id = l.assigned_sales_id AND ss.tenant_id = l.tenant_id
         LEFT JOIN staff cs ON cs.id = l.assigned_cs_id AND cs.tenant_id = l.tenant_id
        WHERE l.tenant_id = ?${where} AND l.status = ?
        ORDER BY l.created_at DESC, l.id DESC LIMIT ?`,
      [req.tenantId, ...whereParams, status, limits[status] || 15]).then(([rows]) => rows)));
    const rows = pages.flat();
    const commsByLead = await communicationsByLead({ tenantId: req.tenantId, leadIds: rows.map(row => row.id) });
    res.json({ counts, rows: rows.map(r => mapLeadRow(r, commsByLead)) });
  } catch (e) { logger.error('[leads-board]', e.message); sendRouteError(res, e); }
});

// GET /api/admin/leads/pool?view=localNew|dawli|archive[&reason=waiting|closed|archived|hidden]
// One pool tab's leads (lib/leadPoolFilter.js) instead of every lead for the
// browser to filter. «محلي جديد» holds every lead nobody is working — waiting,
// closed without a rep, archived, hidden — and `reason` narrows it to one of
// those, which `breakdown` counts. Capped: an imported archive can run to six figures, and a
// tab that holds 20,000 rows has stopped being read row by row — `total` says
// how many there really are, so the screen can say so.
const POOL_LIMIT = 20000;
router.get('/api/admin/leads/pool', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const view = String(req.query.view || '');
    const filter = leadPoolFilter(view, { reason: req.query.reason });
    if (!filter) return res.status(400).json({ error: 'view must be localNew, dawli or archive' });
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) return res.json({ rows: [], total: 0, truncated: false, breakdown: null });
    // The pools are the desk's. A rep's own hidden and archived leads would
    // otherwise come back to them through «محلي جديد».
    const role = String(req.staffRecord?.role || '').toLowerCase();
    if (!req.isSuperAdmin && ['sales', 'collection'].includes(role) && view === 'localNew') {
      return res.json({ rows: [], total: 0, truncated: false, breakdown: null });
    }
    const where = `${accessScope.sql}${filter.sql}`;
    const whereParams = [...accessScope.params, ...filter.params];
    // countOnly: the «محلي جديد» badge, shown on every CRM tab, needs the number alone.
    const countOnly = req.query.countOnly === '1';
    const [[[countRow]], [rows], breakdown] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM leads l WHERE l.tenant_id = ?${where}`, [req.tenantId, ...whereParams]),
      countOnly ? [[]] : pool.query(
        `SELECT l.id, l.client_code, l.name, l.email, l.phone, l.source, l.status, l.lead_type, l.branch,
                l.interest_level, l.interested_course_ids_json, l.enrolled_course_id, l.deal_value,
                l.assigned_sales_id, COALESCE(ss.name, l.assigned_sales_name) AS assigned_sales_name,
                l.assigned_cs_id, COALESCE(cs.name, l.assigned_cs_name) AS assigned_cs_name,
                l.notes, l.last_follow_up, l.next_follow_up_date, l.crm_json, l.hidden, l.score, l.created_at, l.updated_at,
                ${POOL_REASON_COLUMN.sql},
                (SELECT COUNT(*) FROM communications lc WHERE lc.tenant_id = l.tenant_id AND lc.lead_id = l.id) AS communication_count
           FROM leads l
           LEFT JOIN staff ss ON ss.id = l.assigned_sales_id AND ss.tenant_id = l.tenant_id
           LEFT JOIN staff cs ON cs.id = l.assigned_cs_id AND cs.tenant_id = l.tenant_id
          WHERE l.tenant_id = ?${where}
          ORDER BY l.created_at DESC, l.id DESC LIMIT ${POOL_LIMIT}`, [...POOL_REASON_COLUMN.params, req.tenantId, ...whereParams]),
      view !== 'archive' && !countOnly ? poolBreakdown(pool, req.tenantId, accessScope, view) : null,
    ]);
    const total = Number(countRow?.total || 0);
    // The rows' own communication_count carries the number the tables show; the
    // full message history is the lead page's to load.
    if (countOnly) return res.json({ total });
    res.json({
      rows: rows.map(r => ({ ...mapLeadRow(r, new Map()), ...(r.pool_reason ? { poolReason: r.pool_reason } : {}) })),
      total, truncated: total > rows.length, breakdown,
    });
  } catch (e) { logger.error('[leads-pool]', e.message); sendRouteError(res, e); }
});

// The indexed form of a free-text lead search, or null when there is none.
//   phone — eight or more digits: every stored spelling of the number (with and
//     without the leading 0, +20, 0020) exactly, or the digits as a prefix.
//   words — every word at least three letters (InnoDB's smallest indexed token):
//     each must begin a word of the name or email. Shorter words cannot be
//     looked up in the index, so they leave the search to the scan.
const FT_OPERATORS = /[+\-<>()~*"@]/g;
function indexedLeadSearch(q) {
  const digits = q.replace(/[\s\-()]/g, '').replace(/^\+/, '');
  if (/^\d{8,}$/.test(digits)) {
    const spellings = [...new Set([digits, ...identitySpellings(digits)])];
    return { sql: '(l.phone IN (?) OR l.phone LIKE ?)', params: [spellings, `${digits}%`] };
  }
  const words = q.replace(FT_OPERATORS, ' ').split(/\s+/).filter(Boolean);
  if (!words.length || words.some(word => [...word].length < 3)) return null;
  return {
    sql: 'MATCH(l.name, l.email) AGAINST (? IN BOOLEAN MODE)',
    params: [words.map(word => `+${word}*`).join(' ')],
  };
}

router.get('/api/admin/leads', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const limit  = parseLimit(req.query.limit, 500, 5000);
    const offset = parseOffset(req.query.offset);
    // Role-based visibility:
    //   SALES     → only their assigned leads (assigned_sales_id)
    //   COLLECTION → only leads where their subscriber is linked (assigned_cs_id on leads, via subscriber join)
    //   Others (MANAGER, ADMIN, DAQQI_MANAGER, ACCOUNTANT) → all leads
    const columns = `SELECT l.id, l.client_code, l.name, l.email, l.phone, l.source, l.status, l.lead_type, l.branch,
      l.interest_level, l.interested_course_ids_json, l.enrolled_course_id, l.deal_value,
      l.assigned_sales_id, COALESCE(ss.name, l.assigned_sales_name) AS assigned_sales_name,
      l.assigned_cs_id, COALESCE(cs.name, l.assigned_cs_name) AS assigned_cs_name,
      l.notes, l.last_follow_up, l.next_follow_up_date, l.crm_json, l.hidden, l.score, l.created_at, l.updated_at,
      (SELECT COUNT(*) FROM communications lc
        WHERE lc.tenant_id=l.tenant_id AND lc.lead_id=l.id) AS communication_count`;
    const staffJoins = `
      LEFT JOIN staff ss ON ss.id = l.assigned_sales_id AND ss.tenant_id = l.tenant_id
      LEFT JOIN staff cs ON cs.id = l.assigned_cs_id AND cs.tenant_id = l.tenant_id`;
    // The conditions after the tenant's, which each query below writes out.
    let sql = ' AND l.hidden = 0';
    const params = [req.tenantId];
    // Was only scoping SALES/COLLECTION — every other role (RECEPTION_DAQQI, HR,
    // SUPPORT, CONSULTANT, TRAINER, INSTRUCTOR, and DAQQI_MANAGER despite this file's
    // own comment claiming otherwise) fell through to "no additional filter" = every
    // branch's leads. Route through the same DATA_SCOPE table the sibling
    // /api/staff/subscribers already uses, so RECEPTION_DAQQI/DAQQI_MANAGER only see
    // DAQQI-branch leads like they're supposed to.
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) return res.json([]);
    sql += accessScope.sql;
    params.push(...accessScope.params);

    // Optional server-side search/filter — additive, backward-compatible: callers that
    // don't pass q/status get identical results to before.
    const q = (req.query.q || '').trim();
    if (q) {
      // Route by the shape of what was typed. A leading-wildcard LIKE can never
      // use an index, so searching all four columns with '%q%' meant a full scan
      // of leads on every keystroke-driven search — the single most expensive
      // query in the CRM as the table grows.
      //
      // A client code and a complete email address are identifiers: people type
      // them in full, so an equality match returns the same row while riding
      // idx_leads_client_code / idx_leads_email. Only genuinely open-ended text
      // (a partial name, part of a phone number) still needs the scan.
      // Full substring search across every field at scale needs a real search
      // engine — MariaDB has no ngram FULLTEXT parser, so it can't serve it.
      if (/^C\d+$/i.test(q)) {
        sql += ' AND l.client_code = ?';
        params.push(q.toUpperCase());
      } else if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q)) {
        sql += ' AND l.email = ?';
        params.push(q);
      } else {
        // A phone number or whole words are tried first against an index — the
        // phone's stored spellings and its prefix on uq_leads_tenant_phone, or the
        // words as prefixes on ft_leads_name_email — and the substring scan runs
        // only when that finds nothing, so a fragment from the middle of a name
        // or a number still turns up. At 500k leads the scan is 2–3 seconds; the
        // indexed forms are a few milliseconds.
        const fast = indexedLeadSearch(q);
        let matched = false;
        if (fast) {
          try {
            const [[hit]] = await pool.query(
              `SELECT 1 AS hit FROM leads l WHERE l.tenant_id = ?${sql} AND ${fast.sql} LIMIT 1`, [...params, ...fast.params]);
            matched = Boolean(hit);
          } catch (error) {
            // Before migration 235 there is no FULLTEXT index to MATCH against.
            if (error?.code !== 'ER_FT_MATCHING_KEY_NOT_FOUND') throw error;
          }
        }
        if (matched) {
          sql += ` AND ${fast.sql}`;
          params.push(...fast.params);
        } else {
          sql += ' AND (l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ? OR l.client_code LIKE ?)';
          const like = `%${q}%`;
          params.push(like, like, like, like);
        }
      }
    }
    const statusFilter = (req.query.status || '').trim().toLowerCase();
    if (statusFilter && statusFilter !== 'all') {
      // leads.status uses the default utf8mb4 case-insensitive collation (like every
      // other varchar column in this schema), so wrapping the column in LOWER() was
      // redundant — and it defeated the status index (idx_status_created), forcing a full scan on every
      // status-filtered list request (PERF-08). A plain equality comparison matches
      // the same rows and lets the existing index be used.
      sql += ' AND l.status = ?';
      params.push(statusFilter);
    }

    // Cursor (keyset) pagination — opt-in via ?cursor=, falls back to offset.
    let nextCursorFn = null;
    if (req.query.cursor) {
      const ks = keyset(req.query, { col: 'l.created_at', idCol: 'l.id', limit, maxLimit: 5000 });
      sql = `${columns} FROM leads l ${staffJoins} WHERE l.tenant_id = ?${sql} AND ${ks.where} ORDER BY l.created_at DESC, l.id DESC LIMIT ?`;
      params.push(...ks.params, ks.limit);
      nextCursorFn = ks.nextCursor;
    } else {
      // Deferred join: the OFFSET walks the index for ids only, and whole rows
      // (crm_json, notes, the staff names, the communication count) are read for
      // the page alone. A plain OFFSET read and threw away every skipped row in
      // full — 4 seconds for the page at 400,000, 0.7 this way.
      sql = `${columns}
        FROM (SELECT l.id FROM leads l WHERE l.tenant_id = ?${sql}
               ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?) page
        JOIN leads l ON l.id = page.id AND l.tenant_id = ? ${staffJoins}
       ORDER BY l.created_at DESC, l.id DESC`;
      params.push(limit, offset, req.tenantId);
      // The first page hands out a cursor too, so a client can walk the rest by
      // key instead of by ever-deeper OFFSET.
      if (offset === 0) nextCursorFn = keyset({}, { col: 'l.created_at', idCol: 'l.id', limit, maxLimit: 5000 }).nextCursor;
    }
    const [rows] = await pool.query(sql, params);
    if (nextCursorFn) { const nc = nextCursorFn(rows); if (nc) res.set('X-Next-Cursor', nc); }
    const commsByLead = await communicationsByLead({
      tenantId: req.tenantId,
      leadIds: rows.map(row => row.id),
    });
    res.json(rows.map(r => mapLeadRow(r, commsByLead)));
  } catch (e) { logger.error('[route]', e.message); sendRouteError(res, e); }
});

module.exports = router;
module.exports.indexedLeadSearch = indexedLeadSearch;
