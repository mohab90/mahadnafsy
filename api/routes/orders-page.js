'use strict';

// GET /api/admin/orders/page — «الطلبات والمدفوعات», one page at a time, filtered and counted in the database (6 Nov 2026).
//
// The screen drew GET /api/admin/orders: the 500 newest orders and the 500 newest payments (plus every pending one) merged by the server into one array, which the
// browser then searched, filtered, counted and added up — so every figure on it was the figure of the newest thousand rows, and the page downloaded them whole.
// This is the same merged list (the orders table, then every payment no order already covers, marked source 'crm') as one SQL union, and the browser asks for:
//   rows     one page (pageSize <= 100) of the chosen tab
//   total    how many rows the tab holds under the filters, and totals its amounts per currency (the screen converts at its rates, as it always did)
//   counts   the three tabs' sizes under the same filters
//   stats    the whole book, no filters: the counts by status, the paid revenue per currency, the last seven days and the month, in Cairo's days
//   facets   the staff names and the payment methods in use, for the two drop-downs
//
// Same door as GET /api/admin/orders (view_orders, the financial scope: a branch's own, an assigned client's). Not copied from it: the page keeps the rule that a
// payment already covered by an order with the same transaction reference is not listed twice, except while it is pending.

const express = require('express');
const { pool, cached } = require('../lib/db');
const logger = require('../lib/logger');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { financialScopeClause, resolveFinancialScope } = require('../lib/financialScope');
const { resolvePaymentExecutors } = require('../lib/paymentExecutor');
const { addDaysToDateOnly, cairoDayStartUtc, cairoToday, dateOnlyInTimeZone, isValidDateOnly, safeIsoString } = require('../lib/dates');

const router = express.Router();

const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const escapeLike = value => String(value).replace(/[\\%_]/g, match => `\\${match}`);
const round2 = value => Math.round((Number(value) || 0) * 100) / 100;

// The two halves of the merged list, with the columns the screen reads. `at` is the instant the row is sorted and filtered by: an order's creation, a payment's date.
// `staff` is the name the staff filter matches: the staff row an id points at, else the name as stored (the rows themselves are named by resolvePaymentExecutors).
function halvesOf(scopeFor, tenantId) {
  const orderScope = scopeFor('o.branch_id');
  const paymentScope = scopeFor('p.branch_id');
  const orders = {
    closed: orderScope.sql === ' AND 1=0',
    params: [tenantId, ...orderScope.params],
    sql: `
    SELECT o.id AS id, 'order' AS src, LOWER(COALESCE(o.type, 'course')) AS type, LOWER(COALESCE(o.status, 'paid')) AS status, o.amount AS amount,
           COALESCE(o.currency, 'EGP') AS currency, o.payment_method AS payment_method, o.customer_name AS customer_name, o.customer_email AS customer_email,
           o.customer_phone AS customer_phone, o.transaction_id AS transaction_id, o.subscriber_id AS subscriber_id, o.course_id AS course_id,
           o.bundle_id AS bundle_id, o.item_id AS item_id, o.item_title AS item_title, o.staff_id AS staff_id, o.staff_name AS staff_name,
           COALESCE(NULLIF(o.staff_name, ''), '') AS staff, o.branch_id AS branch_id, o.created_at AS at, o.created_at AS created_at, o.paid_at AS paid_at,
           o.notes AS note, 0 AS is_installment, NULL AS from_account, NULL AS sender_name, NULL AS proof_url, o.linked_transfer_id AS linked_transfer_id
      FROM orders o
      LEFT JOIN subscribers s ON s.id = o.subscriber_id AND s.tenant_id = o.tenant_id
     WHERE o.tenant_id = ? AND o.deleted_at IS NULL${orderScope.sql}`,
  };
  const payments = {
    closed: paymentScope.sql === ' AND 1=0',
    params: [tenantId, ...paymentScope.params],
    sql: `
    SELECT p.id AS id, 'crm' AS src, LOWER(COALESCE(NULLIF(p.payment_type, ''), 'course')) AS type, LOWER(COALESCE(NULLIF(p.status, ''), 'paid')) AS status, p.amount AS amount,
           COALESCE(NULLIF(p.currency, ''), 'EGP') AS currency, COALESCE(NULLIF(p.payment_method, ''), 'MANUAL') AS payment_method, COALESCE(s.name, '') AS customer_name,
           COALESCE(s.email, '') AS customer_email, COALESCE(s.phone, '') AS customer_phone, p.transaction_id AS transaction_id, p.subscriber_id AS subscriber_id,
           p.course_id AS course_id, p.bundle_id AS bundle_id, COALESCE(p.course_id, p.bundle_id, '') AS item_id,
           CASE WHEN p.note IS NOT NULL AND p.note <> '' THEN LEFT(CONCAT(LOWER(COALESCE(p.payment_type, '')), ' — ', p.note), 80) ELSE COALESCE(NULLIF(p.payment_type, ''), 'دفعة يدوية') END AS item_title,
           p.staff_id AS staff_id, p.staff_name AS staff_name, COALESCE(st.name, NULLIF(p.staff_name, ''), '') AS staff, p.branch_id AS branch_id, p.date AS at, p.created_at AS created_at,
           NULL AS paid_at, p.note AS note, COALESCE(p.is_installment, 0) AS is_installment, p.from_account AS from_account, p.sender_name AS sender_name, p.proof_url AS proof_url,
           NULL AS linked_transfer_id
      FROM payments p
      LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
      LEFT JOIN staff st ON st.id = p.staff_id AND st.tenant_id = p.tenant_id
      LEFT JOIN (SELECT DISTINCT tenant_id, transaction_id FROM orders WHERE transaction_id IS NOT NULL AND transaction_id <> '' AND deleted_at IS NULL) ot
             ON ot.tenant_id = p.tenant_id AND ot.transaction_id = p.transaction_id
     WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND p.amount > 0${paymentScope.sql}
       AND (COALESCE(p.status, 'paid') = 'pending' OR ot.transaction_id IS NULL)`,
  };
  return { orders, payments };
}

const TABS = {
  review: "status = 'pending' AND type <> 'transfer'",
  accepted: "status = 'paid' AND type <> 'transfer'",
  failed: "status IN ('failed', 'refunded') AND type <> 'transfer'",
};
const TAB_CASE = `CASE WHEN type = 'transfer' THEN NULL WHEN status = 'pending' THEN 'review' WHEN status = 'paid' THEN 'accepted' WHEN status IN ('failed', 'refunded') THEN 'failed' END`;

router.get('/api/admin/orders/page', requireAuth, requireAdminOrStaff, requirePermission('view_orders'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null, allowAssigned: true });
    const scopeFor = column => financialScopeClause(scope, { branchColumn: column, subscriberAlias: 's' });
    const halves = halvesOf(scopeFor, req.tenantId);
    if (halves.orders.closed) return res.json(emptyAnswer());

    const tab = Object.prototype.hasOwnProperty.call(TABS, req.query.tab) ? req.query.tab : 'review';
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 0, 0);

    // The filters the three tab counts share.
    let filters = '';
    const filterParams = [];
    const search = String(req.query.q || '').trim().slice(0, 100);
    if (search) {
      const like = `%${escapeLike(search)}%`;
      filters += ' AND (id LIKE ? OR item_title LIKE ? OR customer_name LIKE ? OR staff LIKE ?)';
      filterParams.push(like, like, like, like);
    }
    if (req.query.type && req.query.type !== 'all') { filters += ' AND type = ?'; filterParams.push(String(req.query.type).toLowerCase()); }
    // The amount a transfer arrived with: the pending rows it can be linked to (the «ربط» dialog).
    if (req.query.amount !== undefined && req.query.amount !== '' && Number.isFinite(Number(req.query.amount))) { filters += ' AND amount = ?'; filterParams.push(Number(req.query.amount)); }
    if (req.query.staff && req.query.staff !== 'all') { filters += ' AND staff = ?'; filterParams.push(String(req.query.staff)); }
    // The stored spellings the screen worked out for the method it was asked for (it holds the vocabulary: shared/paymentMethods.ts).
    if (typeof req.query.methods === 'string') {
      const spellings = req.query.methods.split('\u001f').filter(Boolean).slice(0, 60);
      filters += spellings.length ? ` AND payment_method IN (${spellings.map(() => '?').join(',')})` : ' AND 1=0';
      filterParams.push(...spellings);
    }
    if (isDate(req.query.from) && isValidDateOnly(req.query.from)) { filters += ' AND at >= ?'; filterParams.push(cairoDayStartUtc(req.query.from)); }
    if (isDate(req.query.to) && isValidDateOnly(req.query.to)) { filters += ' AND at < ?'; filterParams.push(cairoDayStartUtc(addDaysToDateOnly(req.query.to, 1))); }

    // Cairo's days for the head of the screen: today and the six before it, and the month so far.
    const today = cairoToday();
    const days = Array.from({ length: 7 }, (_, i) => addDaysToDateOnly(today, i - 6));
    // One cell per day and one for the month, summed per currency (GROUP BY currency below).
    const monthStart = cairoDayStartUtc(`${today.slice(0, 7)}-01`);
    const ranges = [...days.map(day => [cairoDayStartUtc(day), cairoDayStartUtc(addDaysToDate(day))]), [monthStart, cairoDayStartUtc(addDaysToDate(today))]];
    const rangeSelects = ranges.map(() => "COALESCE(SUM(CASE WHEN status = 'paid' AND type <> 'transfer' AND at >= ? AND at < ? THEN amount END), 0)");
    const rangeParams = ranges.flat();

    // Each half of the list is asked on its own, from its own table's indexes, and the two answers are put together here: the union as one derived table was
    // materialised in full (100,000 rows on the lab) for every query, 0.7 s a page.
    const both = (select, tail, params) => Promise.all([halves.orders, halves.payments].map(half => pool.query(`${select} FROM (${half.sql}) d ${tail}`, [...half.params, ...params]).then(([result]) => result)));
    // «figures:» — kept 15 s and dropped by the first write after them (lib/db.js cached): the whole book's figures and the two drop-downs do not depend on the
    // filters, so a change of filter or page asks the database for the page and its counts only.
    const bookKey = `figures:orders-desk:${req.tenantId}:${JSON.stringify([scope.kind, scope.branchId || '', scope.staffId || '', today])}`;
    const book = cached(bookKey, 15_000, async () => {
      const [statuses, rangeRows, staffs, methods] = await Promise.all([
        both('SELECT status, type, currency, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount', 'GROUP BY status, type, currency', []),
        both(`SELECT currency, ${rangeSelects.join(', ')}`, 'GROUP BY currency', rangeParams),
        both('SELECT DISTINCT staff AS name', "WHERE staff <> '' LIMIT 200", []),
        both('SELECT DISTINCT payment_method AS method', "WHERE payment_method IS NOT NULL AND payment_method <> '' LIMIT 200", []),
      ]);
      // currency → the day cells and the month cell, the two halves added
      const cellsOf = {};
      for (const row of rangeRows.flat()) {
        const [currency, ...values] = Object.values(row);
        cellsOf[currency] = (cellsOf[currency] || values.map(() => 0)).map((total, i) => total + Number(values[i]));
      }
      return {
        statusRows: statuses.flat(),
        cellsOf,
        staffNames: [...new Set(staffs.flat().map(row => row.name))].sort(),
        methodNames: [...new Set(methods.flat().map(row => row.method))],
      };
    });
    const wanted = (page + 1) * pageSize;
    const [tabHalves, totalHalves, { statusRows, cellsOf, staffNames, methodNames }] = await Promise.all([
      both('SELECT *', `WHERE ${TABS[tab]}${filters} ORDER BY at DESC, id LIMIT ?`, [...filterParams, wanted]),
      both(`SELECT ${TAB_CASE} AS tab, currency, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount`, `WHERE 1=1${filters} GROUP BY tab, currency`, filterParams),
      book,
    ]);
    // «قيد المراجعة» shows the payments the desk recorded first, then the website's unpaid orders; every tab is newest first.
    const merged = [...tabHalves[0], ...tabHalves[1]].sort((a, b) =>
      (tab === 'review' ? Number(b.src === 'crm') - Number(a.src === 'crm') : 0)
      || new Date(b.at).getTime() - new Date(a.at).getTime() || String(a.id).localeCompare(String(b.id)));
    const tabRows = merged.slice(page * pageSize, wanted);
    const totalRows = totalHalves.flat();

    const counts = { review: 0, accepted: 0, failed: 0 };
    const totals = { EGP: 0, SAR: 0, USD: 0 };
    for (const row of totalRows) {
      if (!row.tab) continue;
      counts[row.tab] += Number(row.n);
      if (row.tab === tab && row.currency in totals) totals[row.currency] = round2(totals[row.currency] + Number(row.amount));
    }
    const stats = { total: 0, paid: 0, pending: 0, failed: 0, refunded: 0, revenue: { EGP: 0, SAR: 0, USD: 0 } };
    for (const row of statusRows) {
      const n = Number(row.n);
      stats.total += n;
      if (row.status === 'paid') {
        stats.paid += n;
        if (row.type !== 'transfer' && row.currency in stats.revenue) stats.revenue[row.currency] = round2(stats.revenue[row.currency] + Number(row.amount));
      } else if (row.status === 'pending') stats.pending += n;
      else if (row.status === 'failed') stats.failed += n;
      else if (row.status === 'refunded') stats.refunded += n;
    }
    const cell = (currency, at) => round2((cellsOf[currency] || [])[at] || 0);
    const daily = days.map((day, i) => ({ day, EGP: cell('EGP', i), SAR: cell('SAR', i), USD: cell('USD', i) }));
    const month = { EGP: cell('EGP', 7), SAR: cell('SAR', 7), USD: cell('USD', 7) };

    // The page's rows, shaped as GET /api/admin/orders shapes them: who recorded a payment, a payment's moment, an order's transfer screenshot.
    const paymentRows = tabRows.filter(row => row.src === 'crm');
    const orderIds = tabRows.filter(row => row.src === 'order').map(row => row.id);
    const [executors, proofs] = await Promise.all([
      resolvePaymentExecutors(pool, req.tenantId, paymentRows),
      orderIds.length
        ? pool.query(`SELECT pp.order_id, pp.proof_url FROM payment_proofs pp
                       WHERE pp.tenant_id = ? AND pp.order_id IN (${orderIds.map(() => '?').join(',')}) AND pp.proof_url IS NOT NULL ORDER BY pp.submitted_at ASC`, [req.tenantId, ...orderIds]).then(([result]) => result)
        : [],
    ]);
    const proofOf = new Map(proofs.map(row => [row.order_id, row.proof_url]));
    // «جمب كورس نكتب هو عميل جديد ولا قديم» (12 Nov 2026): a client is old on a row when they had paid for something before that row's day. One query for the
    // page's clients, not one per row and not inside the union (it is counted over the whole book).
    const clientIds = [...new Set(tabRows.map(row => row.subscriber_id).filter(Boolean))];
    const [firstPaid] = clientIds.length
      ? await pool.query(
        `SELECT subscriber_id, MIN(date) AS first_day FROM payments
          WHERE tenant_id = ? AND subscriber_id IN (${clientIds.map(() => '?').join(',')}) AND deleted_at IS NULL AND COALESCE(NULLIF(status, ''), 'paid') = 'paid' AND amount > 0
          GROUP BY subscriber_id`, [req.tenantId, ...clientIds])
      : [[]];
    const firstDayOf = new Map(firstPaid.map(row => [String(row.subscriber_id), safeIsoString(row.first_day).slice(0, 10)]));
    const clientIsNew = row => {
      if (!row.subscriber_id) return null;
      const first = firstDayOf.get(String(row.subscriber_id));
      return !first || first >= safeIsoString(row.at).slice(0, 10);
    };
    // Every transfer that confirmed a row's payment (a payment may have several, migration 387) — one indexed query for the page, an order through the payment it produced.
    const paymentKeys = [...new Set(tabRows.flatMap(row => (row.src === 'crm' ? [row.id] : [row.id, row.transaction_id])).filter(Boolean).map(String))];
    const [tiedRows] = paymentKeys.length
      ? await pool.query(
        `SELECT payment_id, id, amount, currency, reference FROM incoming_transfers
          WHERE tenant_id = ? AND payment_id IN (${paymentKeys.map(() => '?').join(',')}) ORDER BY linked_at, created_at, id`, [req.tenantId, ...paymentKeys])
      : [[]];
    const tiedBy = new Map();
    for (const tied of tiedRows) tiedBy.set(String(tied.payment_id), [...(tiedBy.get(String(tied.payment_id)) || []), { id: tied.id, amount: Number(tied.amount) || 0, currency: tied.currency, reference: tied.reference || null }]);
    const rows = tabRows.map(row => {
      const crm = row.src === 'crm';
      return {
        linked_transfers: tiedBy.get(String(row.id)) || (row.transaction_id ? tiedBy.get(String(row.transaction_id)) : null) || [],
        client_is_new: clientIsNew(row),
        id: row.id, type: row.type, status: row.status, amount: Number(row.amount) || 0, currency: row.currency,
        payment_method: row.payment_method, customer_name: row.customer_name || '', customer_email: row.customer_email || '', customer_phone: row.customer_phone || '',
        transaction_id: row.transaction_id || null, subscriber_id: row.subscriber_id, course_id: row.course_id || null, bundle_id: row.bundle_id || null,
        item_id: row.item_id || '', item_title: row.item_title || '', staff_id: row.staff_id || null,
        staff_name: crm ? (executors.get(row.id) ?? null) : (row.staff_name || null), branch_id: row.branch_id || null,
        notes: row.note || null, is_installment: Boolean(Number(row.is_installment)),
        created_at: crm ? paymentMoment(row) : safeIsoString(row.created_at), paid_at: row.paid_at ? safeIsoString(row.paid_at) : null,
        from_account: row.from_account || null, sender_name: row.sender_name || null, proof_url: crm ? (row.proof_url || null) : (proofOf.get(row.id) || null),
        linked_transfer_id: row.linked_transfer_id || null, source: crm ? 'crm' : undefined,
      };
    });

    res.set('Cache-Control', 'private, no-store');
    res.json({
      tab, page, pageSize, rows, total: counts[tab], totals, counts,
      stats: { total: stats.total, paid: stats.paid, pending: stats.pending, failed: stats.failed, refunded: stats.refunded, revenue: stats.revenue, today: daily[daily.length - 1], daily, month },
      facets: { staff: staffNames, methods: methodNames },
    });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ error: error.message, code: error.code });
    logger.error('[orders-page]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const addDaysToDate = day => addDaysToDateOnly(day, 1);

// A payment's date names a day; recorded on that same Cairo day, the moment it was recorded is the honest time to show; a backdated one stays the day alone
// (the rule GET /api/admin/orders applies to the same rows).
function paymentMoment(row) {
  const day = safeIsoString(row.at);
  const recorded = safeIsoString(row.created_at);
  const dayOnly = /T(00|12):00:00\.000Z$/.test(day) ? day.slice(0, 10) : day;
  return (recorded && day && dateOnlyInTimeZone(new Date(recorded)) === day.slice(0, 10) ? recorded : dayOnly) || new Date().toISOString();
}

function emptyAnswer() {
  const zero = { EGP: 0, SAR: 0, USD: 0 };
  return {
    tab: 'review', page: 0, pageSize: 50, rows: [], total: 0, totals: zero, counts: { review: 0, accepted: 0, failed: 0 },
    stats: { total: 0, paid: 0, pending: 0, failed: 0, refunded: 0, revenue: zero, today: { day: cairoToday(), ...zero }, daily: [], month: zero },
    facets: { staff: [], methods: [] },
  };
}

module.exports = router;
