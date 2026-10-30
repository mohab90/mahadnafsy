'use strict';
// Rep performance, scored leads and CRM insights.
// One part of routes/admin/leads.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  pool,
  TERMINAL_LIST,
  TERMINAL_SQL,
  ymd,
  sendRouteError,
  leadScope,
  communicationsByLead,
  requireAuth,
  requireAdminOrStaff,
  requirePermission,
  requireAnyPermission,
  sqlCairoToday,
  sqlCairoDayStartUtc,
  logger,
  mapLeadRow,
} = require('./_shared');

const { FOLLOW_UP_DATE, FOLLOW_UP_OPEN, dueOn } = require('../../../lib/leadFollowUps');
const { addDaysToDateOnly, cairoToday, monthRange } = require('../../../lib/dates');
const { toEgp } = require('../../../lib/staffClientsView');
const { resolveDataScope } = require('../../../constants/permissions');
const { branchesFromScope } = require('../../../lib/leadAccess');

const router = Router();

// GET /api/admin/leads/staff-performance?from=YYYY-MM-DD
//
// Per-rep lead counts inside a date range. Its own endpoint rather than a
// parameter on /stats, because /stats.byOwner is read by the CRM performance
// panel with no range at all — adding one there would silently move numbers on
// a screen that never asked for it.
//
// `from` is computed by the caller and passed as a plain date. The range labels
// (week/month/quarter) live in the screen that offers them; the server only
// needs the boundary they resolve to, and duplicating the label arithmetic here
// would give two places to disagree about when a month starts.
//
// Three counts, two date columns. leads and converted are bounded by created_at;
// contacted is bounded by updated_at falling back to created_at, which is what
// the browser did — a lead contacted this month but created last year belongs in
// this month's contacted figure and not in this month's new-lead figure.
// view_hr as well as view_leads: this is «أداء الموظفين» in the HR section, and
// an HR manager without the CRM could not open the performance board of the
// people she manages. The rows are still narrowed by the caller's lead scope,
// so widening who may ask does not widen what any one of them sees.
router.get('/api/admin/leads/staff-performance', requireAuth, requireAdminOrStaff, requireAnyPermission('view_leads', 'view_hr'), async (req, res) => {
  try {
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) return res.json({ from: null, byStaff: {} });
    const scopeClause = accessScope.sql;
    const base = [req.tenantId, ...accessScope.params];

    // Anything that is not a bare calendar date is treated as no bound at all,
    // which is the 'all' range the screen also offers.
    const rawFrom = String(req.query.from || '').trim();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(rawFrom) ? rawFrom : null;

    const createdBound = from ? ' AND l.created_at >= ?' : '';
    const touchedBound = from ? ' AND COALESCE(l.updated_at, l.created_at) >= ?' : '';
    const fromParam = from ? [from] : [];

    const byStaff = {};
    const entryFor = (id) => {
      const key = String(id || '');
      if (!key) return null;
      // byStatus rather than a field per status: two screens want different
      // slices of the same grouping — one needs lost and active, the other only
      // converted — and adding a column each time they differ is how a response
      // grows fields nobody reads.
      if (!byStaff[key]) byStaff[key] = { leads: 0, converted: 0, contacted: 0, followUpsToday: 0, byStatus: {} };
      return byStaff[key];
    };

    // The three reads are independent (0.4 s, 0.3 s and 2 ms at 150,000 leads): issued together, the page takes the slowest.
    // leads and converted come from one pass, grouped by status so both are the same population — the reason /stats groups
    // this way too. The follow-ups due today are not bounded by the range: today is today. The sales hub counted them in the
    // browser out of the page of leads it had.
    const due = dueOn(cairoToday());
    const [[createdRows], [contactedRows], [dueRows]] = await Promise.all([
      pool.query(
        `SELECT l.assigned_sales_id AS staff_id, l.status AS status, COUNT(*) AS cnt
           FROM leads l
          WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
            AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''${createdBound}
          GROUP BY l.assigned_sales_id, l.status`,
        [...base, ...fromParam],
      ),
      pool.query(
        `SELECT l.assigned_sales_id AS staff_id, COUNT(*) AS cnt
           FROM leads l
          WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
            AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
            AND l.status IN ('contacted','interested','interested_booking','converted')${touchedBound}
          GROUP BY l.assigned_sales_id`,
        [...base, ...fromParam],
      ),
      pool.query(
        `SELECT l.assigned_sales_id AS staff_id, COUNT(*) AS cnt
           FROM leads l
          WHERE l.tenant_id = ?${scopeClause}${due.sql}
            AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
          GROUP BY l.assigned_sales_id`,
        [...base, ...due.params],
      ),
    ]);
    for (const r of createdRows) {
      const entry = entryFor(r.staff_id);
      if (!entry) continue;
      const count = Number(r.cnt);
      const status = String(r.status || '').toLowerCase();
      entry.leads += count;
      if (status) entry.byStatus[status] = (entry.byStatus[status] || 0) + count;
      if (status === 'converted') entry.converted += count;
    }
    for (const r of contactedRows) {
      const entry = entryFor(r.staff_id);
      if (entry) entry.contacted = Number(r.cnt);
    }
    for (const r of dueRows) {
      const entry = entryFor(r.staff_id);
      if (entry) entry.followUpsToday = Number(r.cnt);
    }

    res.json({ from, byStaff });
  } catch (e) { logger.error('[route]', e.message); sendRouteError(res, e); }
});

// GET /api/admin/leads/rep-revenue?month=YYYY-MM — what each rep's clients paid in a month, in EGP.
//
// «أداء المبيعات» showed each rep's month revenue summed in the browser from the clients' payments, so the leads
// screen asked for the 500 newest clients with their payment history (700 KB on the lab) and still counted only
// those 500. The same rule over every client: a payment that is collected (status paid, or none — admin/lib/money.ts
// isCollected) dated in the month, on a client whose assigned_sales_id is the rep, converted at the browser's own
// fallback rates (lib/staffClientsView.js toEgp), so the figure is the one the screen used to show over the whole table.
//
// Scoped like the clients themselves: everyone for an «all» scope, a branch's clients for a branch scope, and a rep or
// a collection officer is told their own figure only.
router.get('/api/admin/leads/rep-revenue', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const range = monthRange(String(req.query.month || '') || cairoToday().slice(0, 7));
    if (!range) return res.status(400).json({ error: 'month must be YYYY-MM' });
    const scope = resolveDataScope(req.staffRecord, { isSuperAdmin: Boolean(req.isSuperAdmin), fallback: 'assigned_sales' });
    if (scope === 'none') return res.json({ month: range.startDate.slice(0, 7), byStaff: {} });
    let scopeSql = '';
    const scopeParams = [];
    if (scope.startsWith('branch:')) {
      const branches = branchesFromScope(scope);
      scopeSql = branches.length ? ` AND s.branch IN (${branches.map(() => '?').join(',')})` : ' AND 1=0';
      scopeParams.push(...branches);
    } else if (scope !== 'all') {
      scopeSql = ' AND s.assigned_sales_id = ?';
      scopeParams.push(String(req.staffRecord?.id || ''));
    }
    const [rows] = await pool.query(
      `SELECT s.assigned_sales_id AS staff_id, p.currency, SUM(p.amount) AS amount
         FROM payments p
         JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND s.deleted_at IS NULL
          AND s.assigned_sales_id IS NOT NULL AND s.assigned_sales_id <> ''
          AND (p.status IS NULL OR p.status = 'paid')
          AND p.\`date\` >= ? AND p.\`date\` < ?${scopeSql}
        GROUP BY s.assigned_sales_id, p.currency`,
      [req.tenantId, range.startDate, range.endDate, ...scopeParams],
    );
    const byStaff = {};
    for (const row of rows) {
      const id = String(row.staff_id);
      byStaff[id] = (byStaff[id] || 0) + toEgp(row.amount, row.currency);
    }
    res.json({ month: range.startDate.slice(0, 7), byStaff });
  } catch (e) { logger.error('[leads-rep-revenue]', e.message); sendRouteError(res, e); }
});

// GET /api/admin/leads/scored?minScore=&status=&source=&q=&sortBy=&limit=
//
// The lead-scoring screen renders filtered.slice(0, 50) — fifty rows — and was
// downloading all 26,878 leads to pick them, because the score it sorts by is
// computed per lead in the browser. LEAD_SCORE_SQL computes the same number in
// the database, so the sort, the filters and the histogram are all queries.
//
// Three things come back unfiltered on purpose: the distribution, the mean, and
// the source/status lists that populate the filter dropdowns. All three describe
// the whole table in the browser's version too — narrowing them to the current
// filter would make the histogram change shape every time someone moved the
// score slider, and would drop the options needed to undo a filter.
router.get('/api/admin/leads/scored', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) {
      return res.json({ rows: [], total: 0, distribution: { hot: 0, warm: 0, medium: 0, cold: 0 }, avgScore: 0, sources: [], statuses: [] });
    }
    const scopeClause = accessScope.sql;
    const base = [req.tenantId, ...accessScope.params];

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const minScore = Math.min(Math.max(parseInt(req.query.minScore, 10) || 0, 0), 100);
    const status = String(req.query.status || '').trim();
    const source = String(req.query.source || '').trim();
    const q = String(req.query.q || '').trim();
    const sortBy = req.query.sortBy === 'date' ? 'date' : 'score';

    let filterClause = '';
    const filterParams = [];
    if (status && status !== 'all') { filterClause += ' AND l.status = ?'; filterParams.push(status); }
    if (source && source !== 'all') {
      // The browser compares (source || '').toLowerCase() against the dropdown
      // value; the column collates case-insensitively, so a direct comparison is
      // the same test without putting LOWER() around an indexed column.
      filterClause += ' AND l.source = ?';
      filterParams.push(source);
    }
    if (q) {
      filterClause += ' AND (l.name LIKE ? OR l.phone LIKE ?)';
      filterParams.push(`%${q}%`, `%${q}%`);
    }

    // leads.score is kept equal to LEAD_SCORE_SQL by lib/leadScoreRefresh.js
    // (hourly, every visible lead), so the filter, the sort and the histogram
    // are plain reads of an indexed column. Computing the formula here instead
    // took over a minute at 500k leads: it had to score every lead to find the
    // top fifty.
    // The page, its total, the histogram and the filter lists are independent reads of the same set: issued together they
    // take the slowest one's time (the lists and the histogram scan the whole scoped table, 0.15-0.3 s each at 150,000 leads).
    const [[rows], [[totalRow]], [[distRow]], [facetRows]] = await Promise.all([
      pool.query(
      `SELECT l.id, l.client_code, l.name, l.email, l.phone, l.source, l.utm_source, l.utm_medium, l.utm_campaign, l.fbclid, l.gclid, l.status, l.lead_type, l.branch,
              l.interest_level, l.interested_course_ids_json, l.enrolled_course_id, l.deal_value,
              l.assigned_sales_id, COALESCE(ss.name, l.assigned_sales_name) AS assigned_sales_name,
              l.assigned_cs_id, COALESCE(cs.name, l.assigned_cs_name) AS assigned_cs_name,
              l.notes, l.last_follow_up, l.next_follow_up_date, l.crm_json, l.hidden, l.score,
              l.created_at, l.updated_at
         FROM leads l
         LEFT JOIN staff ss ON ss.id = l.assigned_sales_id AND ss.tenant_id = l.tenant_id
         LEFT JOIN staff cs ON cs.id = l.assigned_cs_id AND cs.tenant_id = l.tenant_id
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}${filterClause} AND l.score >= ?
        ORDER BY ${sortBy === 'date' ? 'l.created_at DESC, l.id DESC' : 'l.score DESC, l.id DESC'}
        LIMIT ?`,
      [...base, ...filterParams, minScore, limit],
      ),
      // How many match the filter in total, so the screen can say "showing 50 of N"
      // rather than implying the fifty rows are everything.
      pool.query(
      `SELECT COUNT(*) AS cnt FROM leads l
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}${filterClause} AND l.score >= ?`,
      [...base, ...filterParams, minScore],
      ),
      // Histogram and mean over the whole scoped table, matching the browser.
      pool.query(
      `SELECT
         COALESCE(SUM(l.score >= 80), 0) AS hot,
         COALESCE(SUM(l.score >= 60 AND l.score < 80), 0) AS warm,
         COALESCE(SUM(l.score >= 40 AND l.score < 60), 0) AS medium,
         COALESCE(SUM(l.score < 40), 0) AS cold,
         COALESCE(AVG(l.score), 0) AS avg_score
       FROM leads l
      WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}`,
      base,
      ),
      pool.query(
      `SELECT DISTINCT COALESCE(NULLIF(l.source, ''), '') AS source, l.status AS status
         FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}`,
      base,
      ),
    ]);

    // Communication counts for the page only, not for the table.
    const commCounts = new Map();
    if (rows.length) {
      const [countRows] = await pool.query(
        `SELECT lead_id, COUNT(*) AS cnt FROM communications
          WHERE tenant_id = ? AND lead_id IN (?) GROUP BY lead_id`,
        [req.tenantId, rows.map(r => r.id)],
      );
      for (const r of countRows) commCounts.set(r.lead_id, Number(r.cnt));
    }

    const sources = [...new Set(facetRows.map(r => String(r.source || '').toLowerCase()).filter(Boolean))].sort();
    const statuses = [...new Set(facetRows.map(r => String(r.status || '').toLowerCase()).filter(Boolean))].sort();

    // Deliberately empty: this list is scored leads, and the client draws it
    // without the conversation history. Named for what it is rather than
    // shadowing the repository helper of the same name.
    const noCommunications = new Map();
    const mapped = rows.map(r => ({
      ...mapLeadRow({ ...r, communication_count: commCounts.get(r.id) || 0 }, noCommunications),
      score: Number(r.score),
    }));

    res.json({
      rows: mapped,
      total: Number(totalRow?.cnt || 0),
      distribution: {
        hot: Number(distRow?.hot || 0),
        warm: Number(distRow?.warm || 0),
        medium: Number(distRow?.medium || 0),
        cold: Number(distRow?.cold || 0),
      },
      avgScore: Math.round(Number(distRow?.avg_score || 0)),
      sources,
      statuses,
    });
  } catch (e) { logger.error('[route]', e.message); sendRouteError(res, e); }
});

// GET /api/admin/leads/crm-insights?idleDays=N
//
// The three CRM workspace panels — reminders, the weekly scorecard, and the
// redistribution suggestions — each used to read the entire leads array. That is
// why opening the CRM downloaded all 26,887 rows: not to list them (the table has
// been paginated since), but so three hooks could filter them in the browser.
//
// Every one of those filters is a query. The reminders panel is the clearest
// case: 14 leads on this database carry a follow-up date at all, and the panel
// shows the 2 inside its window — 26,887 rows fetched to render two.
//
// Same role scoping as the list and stats routes, so a SALES rep's insights
// cover their own leads and nothing else.
router.get('/api/admin/leads/crm-insights', requireAuth, requireAdminOrStaff, requirePermission('view_leads'), async (req, res) => {
  try {
    const accessScope = leadScope(req, 'l');
    if (accessScope.none) {
      return res.json({ reminders: [], untouched: [], promised: [], scorecard: [], redistCandidates: [], idleDays: 0 });
    }
    const scopeClause = accessScope.sql;
    const scopeParams = accessScope.params;

    // Clamped rather than trusted: this value goes into a comparison, and an
    // absurd one would either return the whole table or nothing at all.
    const idleDays = Math.min(Math.max(parseInt(req.query.idleDays, 10) || 14, 1), 3650);

    // Closed leads are excluded below in the same spellings the browser used, so
    // the two paths cannot disagree about what "open" means.
    const CLOSED = TERMINAL_LIST;
    const REDIST_EXCLUDED = TERMINAL_LIST;
    const closedSql = CLOSED.map(() => '?').join(',');
    const redistSql = REDIST_EXCLUDED.map(() => '?').join(',');

    // ── 1. Reminders ────────────────────────────────────────────────────────
    // Open and dated as every screen counts them (lib/leadFollowUps.js): the
    // column alone missed a date kept only in crm_json, which the bell counted.
    // Whole rows, because the panel lists them by name and acts on them. Bounded
    // by the same window the browser applied: anything overdue, plus the next
    // seven days. LIMIT is a backstop, not a filter — a database holding more
    // than 500 open follow-ups was never going to render them all anyway.
    const [reminderRows] = await pool.query(
      `SELECT l.id, l.client_code, l.name, l.email, l.phone, l.source, l.utm_source, l.utm_medium, l.utm_campaign, l.fbclid, l.gclid, l.status, l.lead_type, l.branch,
              l.interest_level, l.interested_course_ids_json, l.enrolled_course_id, l.deal_value,
              l.assigned_sales_id, COALESCE(ss.name, l.assigned_sales_name) AS assigned_sales_name,
              l.assigned_cs_id, COALESCE(cs.name, l.assigned_cs_name) AS assigned_cs_name,
              l.notes, l.last_follow_up, l.next_follow_up_date, l.crm_json, l.hidden, l.score,
              l.created_at, l.updated_at,
              (SELECT COUNT(*) FROM communications lc
                WHERE lc.tenant_id=l.tenant_id AND lc.lead_id=l.id) AS communication_count
         FROM leads l
         LEFT JOIN staff ss ON ss.id = l.assigned_sales_id AND ss.tenant_id = l.tenant_id
         LEFT JOIN staff cs ON cs.id = l.assigned_cs_id AND cs.tenant_id = l.tenant_id
        WHERE l.tenant_id = ?${scopeClause} AND ${FOLLOW_UP_OPEN}
          AND l.next_follow_up_date < ?
        ORDER BY ${FOLLOW_UP_DATE} ASC, l.id ASC
        LIMIT 500`,
      // Up to the end of the seventh day: a range on the DATETIME column, which the follow-up index serves.
      [req.tenantId, ...scopeParams, addDaysToDateOnly(cairoToday(), 8)],
    );

    // ── 1b. The two undated queues beside them ──────────────────────────────
    // «محدش كلمهم»: new leads with no follow-up date and no contact at all,
    // oldest first, the fifty the panel shows. «وعدوا بالدفع»: every lead at
    // interested_booking, dated promises first. Both used to scan every lead in
    // the browser, which held the whole table for one tab.
    // The follow-up day (lib/leadFollowUps.js): the column, which every writer sets.
    const followUpSql = FOLLOW_UP_DATE;
    const queueColumns = `SELECT l.id, l.client_code, l.name, l.email, l.phone, l.source, l.utm_source, l.utm_medium, l.utm_campaign, l.fbclid, l.gclid, l.status, l.lead_type, l.branch,
              l.interest_level, l.interested_course_ids_json, l.enrolled_course_id, l.deal_value,
              l.assigned_sales_id, COALESCE(ss.name, l.assigned_sales_name) AS assigned_sales_name,
              l.assigned_cs_id, COALESCE(cs.name, l.assigned_cs_name) AS assigned_cs_name,
              l.notes, l.last_follow_up, l.next_follow_up_date, l.crm_json, l.hidden, l.score,
              l.created_at, l.updated_at,
              (SELECT COUNT(*) FROM communications lc
                WHERE lc.tenant_id=l.tenant_id AND lc.lead_id=l.id) AS communication_count
         FROM leads l
         LEFT JOIN staff ss ON ss.id = l.assigned_sales_id AND ss.tenant_id = l.tenant_id
         LEFT JOIN staff cs ON cs.id = l.assigned_cs_id AND cs.tenant_id = l.tenant_id`;
    const [[untouchedRows], [promisedRows]] = await Promise.all([
      pool.query(
        `${queueColumns}
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.status = 'new' AND ${followUpSql} IS NULL
          AND NOT EXISTS (SELECT 1 FROM communications c WHERE c.tenant_id = l.tenant_id AND c.lead_id = l.id)
        ORDER BY l.created_at ASC, l.id ASC
        LIMIT 50`, [req.tenantId, ...scopeParams]),
      pool.query(
        `${queueColumns}
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause} AND l.status = 'interested_booking'
        ORDER BY ${followUpSql} IS NULL, ${followUpSql}, l.created_at ASC, l.id ASC
        LIMIT 500`, [req.tenantId, ...scopeParams]),
    ]);

    const commsByLead = await communicationsByLead({
      tenantId: req.tenantId,
      leadIds: [...reminderRows, ...untouchedRows, ...promisedRows].map(row => row.id),
    });
    const reminders = reminderRows.map(r => mapLeadRow(r, commsByLead));
    const untouched = untouchedRows.map(r => mapLeadRow(r, commsByLead));
    const promised = promisedRows.map(r => mapLeadRow(r, commsByLead));

    // The independent reads below (the completion rate, the four scorecard aggregates, the never-contacted leads and the open
    // load per rep) start together: one after another they were the 1.4 s of this route; side by side they take the slowest's time.
    // completionRate counts leads whose follow-up date has already passed —
    // including closed ones the list above excludes, matching what the browser
    // counted — and whether a communication landed on or after that date. Only
    // the percentage is displayed, so only the two totals are computed.
    const idleWhere = `l.hidden = 0${scopeClause}
          AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
          AND l.status NOT IN (${redistSql})`;
    const idleParams = [...scopeParams, ...REDIST_EXCLUDED];
    const [[[dueRow]], [weekCommRows], [followupRows], [newLeadRows], [overdueRows], [neverContacted], [loadRows]] = await Promise.all([
      pool.query(
      `SELECT COUNT(*) AS due,
              COALESCE(SUM(EXISTS (
                SELECT 1 FROM communications c
                 WHERE c.tenant_id = l.tenant_id AND c.lead_id = l.id
                   AND c.date >= l.next_follow_up_date
              )), 0) AS completed
         FROM leads l
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.next_follow_up_date IS NOT NULL
          AND l.next_follow_up_date <= ${sqlCairoToday()}`,
      [req.tenantId, ...scopeParams],
    ),
      pool.query(
      `SELECT l.assigned_sales_id AS staff_id, c.type AS type, COUNT(*) AS cnt
         FROM communications c
         JOIN leads l ON l.id = c.lead_id AND l.tenant_id = c.tenant_id
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
          AND c.date >= ${sqlCairoDayStartUtc()} - INTERVAL 7 DAY
        GROUP BY l.assigned_sales_id, c.type`,
      [req.tenantId, ...scopeParams],
    ),
      pool.query(
      `SELECT l.assigned_sales_id AS staff_id, COUNT(*) AS cnt
         FROM leads l
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
          AND l.next_follow_up_date >= ${sqlCairoToday()} - INTERVAL 7 DAY
          AND l.next_follow_up_date <= ${sqlCairoToday()}
          AND EXISTS (
            SELECT 1 FROM communications c
             WHERE c.tenant_id = l.tenant_id AND c.lead_id = l.id
               AND c.date >= l.next_follow_up_date
          )
        GROUP BY l.assigned_sales_id`,
      [req.tenantId, ...scopeParams],
    ),
      pool.query(
      `SELECT l.assigned_sales_id AS staff_id, COUNT(*) AS cnt
         FROM leads l
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
          AND l.created_at >= ${sqlCairoDayStartUtc()} - INTERVAL 7 DAY
        GROUP BY l.assigned_sales_id`,
      [req.tenantId, ...scopeParams],
    ),
      pool.query(
      `SELECT l.assigned_sales_id AS staff_id, COUNT(*) AS cnt
         FROM leads l
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
          AND l.next_follow_up_date IS NOT NULL
          AND l.next_follow_up_date < ${sqlCairoToday()}
          AND l.status NOT IN ${TERMINAL_SQL}
        GROUP BY l.assigned_sales_id`,
      [req.tenantId, ...scopeParams],
    ),
      pool.query(
      `SELECT l.id, l.created_at AS last_activity
         FROM leads l
        WHERE l.tenant_id = ? AND ${idleWhere}
          AND l.created_at < ${sqlCairoToday()} - INTERVAL ? DAY + INTERVAL 1 DAY
          AND NOT EXISTS (SELECT 1 FROM communications c WHERE c.tenant_id = l.tenant_id AND c.lead_id = l.id)
        ORDER BY l.created_at ASC, l.id ASC
        LIMIT 50`,
      [req.tenantId, ...idleParams, idleDays],
    ),
      pool.query(
      `SELECT l.assigned_sales_id AS staff_id, COUNT(*) AS cnt
         FROM leads l
        WHERE l.tenant_id = ? AND l.hidden = 0${scopeClause}
          AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
          AND l.status NOT IN (${closedSql})
        GROUP BY l.assigned_sales_id`,
      [req.tenantId, ...scopeParams, ...CLOSED],
    ),
    ]);
    const totalDue = Number(dueRow?.due || 0);
    const completedDue = Number(dueRow?.completed || 0);

    // ── 2. Weekly scorecard ─────────────────────────────────────────────────
    // Four aggregates keyed by rep, merged into one row each. Deliberately four
    // queries and not one wide join: joining communications to leads multiplies
    // the lead rows by their communications, and every count after the first
    // would come back inflated.
    const scorecardById = new Map();
    const scoreEntry = (id) => {
      const key = String(id || '');
      if (!key) return null;
      if (!scorecardById.has(key)) {
        scorecardById.set(key, {
          staffId: key, calls: 0, wa: 0, meetings: 0, totalComms: 0,
          followupsDone: 0, newLeadsThisWeek: 0, overdueOwn: 0,
        });
      }
      return scorecardById.get(key);
    };

    for (const r of weekCommRows) {
      const entry = scoreEntry(r.staff_id);
      if (!entry) continue;
      const count = Number(r.cnt);
      const type = String(r.type || '').trim().toLowerCase();
      entry.totalComms += count;
      if (type === 'call') entry.calls += count;
      else if (type === 'whatsapp') entry.wa += count;
      else if (type === 'meeting') entry.meetings += count;
    }

    for (const r of followupRows) {
      const entry = scoreEntry(r.staff_id);
      if (entry) entry.followupsDone = Number(r.cnt);
    }

    // Bare column, no DATE() wrapper — same reason /stats uses a half-open
    // range: wrapping created_at puts idx_leads_tenant_status_created out of
    // reach and turns this into a full scan.
    for (const r of newLeadRows) {
      const entry = scoreEntry(r.staff_id);
      if (entry) entry.newLeadsThisWeek = Number(r.cnt);
    }

    // overdueOwn excludes converted and lost only — not not_interested_hidden.
    // That is what the browser counted, and quietly widening it here would move
    // a number the user reads without anyone having decided to.
    for (const r of overdueRows) {
      const entry = scoreEntry(r.staff_id);
      if (entry) entry.overdueOwn = Number(r.cnt);
    }

    // ── 3. Redistribution candidates ────────────────────────────────────────
    // "Silent" is measured from the most recent communication, falling back to
    // creation for a lead never contacted — the browser's rule, written as a
    // COALESCE over a correlated MAX.
    //
    // DATE(last_activity), not the bare timestamp: the browser floors the last
    // activity to its calendar day before subtracting, so a lead last touched at
    // 09:00 seven days ago counts as seven days silent there. Comparing the raw
    // DATETIME excluded thirteen leads on production that the panel had always
    // listed.
    //
    // Only the 50 quietest come back because only 50 are ever shown, and the
    // per-rep open load the panel needs to suggest a new owner is the aggregate
    // below rather than a count over the array.
    // The full column set, not a slim projection: the panel's "تحويل" button
    // saves with updateLead({ ...lead, assignedSalesId }), which PUTs the whole
    // lead back. A partial object there would blank every field it omitted, and
    // the "عرض" link needs client_code to resolve. Fifty rows is cheap; losing a
    // lead's notes to a reassignment is not.
    // The quietest leads, found in two cheap halves instead of one expensive
    // whole. last_activity is COALESCE(last communication, created_at), so a lead
    // is quiet either because it was never contacted (ordered by created_at, an
    // index walk that stops at fifty) or because its last contact is old (the
    // communications rollup, ordered by that date). The fifty quietest overall
    // are the fifty quietest of the two lists merged. Asking for
    // MAX(communications.date) per open lead in one statement made the database
    // look up every open lead's communications to sort them — 19 seconds at
    // 500k leads, for a panel of fifty rows.
    // Communicated leads, quietest first, a page at a time: most of a page
    // passes the lead filter, so one page is the usual cost.
    const contacted = [];
    for (let offset = 0, page = 2000; contacted.length < 50; offset += page) {
      const [lastRows] = await pool.query(
        `SELECT lead_id, MAX(date) AS last_activity
           FROM communications
          WHERE tenant_id = ? AND lead_id IS NOT NULL
          GROUP BY lead_id
         HAVING DATE(MAX(date)) <= ${sqlCairoToday()} - INTERVAL ? DAY
          ORDER BY last_activity ASC, lead_id ASC
          LIMIT ? OFFSET ?`,
        [req.tenantId, idleDays, page, offset],
      );
      if (!lastRows.length) break;
      const [eligible] = await pool.query(
        `SELECT l.id FROM leads l WHERE l.tenant_id = ? AND ${idleWhere} AND l.id IN (?)`,
        [req.tenantId, ...idleParams, lastRows.map(r => r.lead_id)],
      );
      const keep = new Set(eligible.map(r => r.id));
      for (const r of lastRows) if (keep.has(r.lead_id)) contacted.push({ id: r.lead_id, last_activity: r.last_activity });
      if (lastRows.length < page) break;
    }
    const quietest = [...neverContacted, ...contacted]
      .sort((x, y) => (new Date(x.last_activity) - new Date(y.last_activity)) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
      .slice(0, 50)
      .map(r => r.id);
    let idleRows = [];
    if (quietest.length) {
      [idleRows] = await pool.query(
        `SELECT l.id, l.client_code, l.name, l.email, l.phone, l.source, l.utm_source, l.utm_medium, l.utm_campaign, l.fbclid, l.gclid, l.status, l.lead_type, l.branch,
                l.interest_level, l.interested_course_ids_json, l.enrolled_course_id, l.deal_value,
                l.assigned_sales_id, COALESCE(ss.name, l.assigned_sales_name) AS assigned_sales_name,
                l.assigned_cs_id, COALESCE(cs.name, l.assigned_cs_name) AS assigned_cs_name,
                l.notes, l.last_follow_up, l.next_follow_up_date, l.crm_json, l.hidden, l.score,
                l.created_at, l.updated_at,
                (SELECT COUNT(*) FROM communications lc
                  WHERE lc.tenant_id=l.tenant_id AND lc.lead_id=l.id) AS communication_count,
                COALESCE(
                  (SELECT MAX(c.date) FROM communications c
                    WHERE c.tenant_id = l.tenant_id AND c.lead_id = l.id),
                  l.created_at
                ) AS last_activity
           FROM leads l
           LEFT JOIN staff ss ON ss.id = l.assigned_sales_id AND ss.tenant_id = l.tenant_id
           LEFT JOIN staff cs ON cs.id = l.assigned_cs_id AND cs.tenant_id = l.tenant_id
          WHERE l.tenant_id = ? AND l.id IN (?)`,
        [req.tenantId, quietest],
      );
      const rank = new Map(quietest.map((id, i) => [id, i]));
      idleRows.sort((x, y) => rank.get(x.id) - rank.get(y.id));
    }

    const openLoadByRep = {};
    for (const r of loadRows) openLoadByRep[String(r.staff_id)] = Number(r.cnt);

    const idleCommsByLead = await communicationsByLead({
      tenantId: req.tenantId,
      leadIds: idleRows.map(row => row.id),
    });

    const nowMs = Date.now();
    const redistCandidates = idleRows.map(r => {
      // ymd(), not String().slice(): last_activity is a COALESCE over two
      // DATETIME columns, so it arrives as a Date and slicing it would produce
      // "Wed Aug 05" — which then parses back as Invalid Date and makes every
      // daysSilent NaN.
      const lastDate = ymd(r.last_activity);
      return {
        lead: mapLeadRow(r, idleCommsByLead),
        lastDate,
        daysSilent: lastDate
          ? Math.floor((nowMs - new Date(lastDate).getTime()) / 86400000)
          : 999,
      };
    });

    res.json({
      idleDays,
      reminders,
      untouched,
      promised,
      remindersCompletionRate: totalDue > 0 ? Math.round((completedDue / totalDue) * 100) : 0,
      scorecard: [...scorecardById.values()],
      redistCandidates,
      openLoadByRep,
    });
  } catch (e) { logger.error('[route]', e.message); sendRouteError(res, e); }
});

module.exports = router;
