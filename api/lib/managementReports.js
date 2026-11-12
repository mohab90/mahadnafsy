'use strict';

// «تقارير الإدارة» (the owner, 11 Nov 2026): «كل واحدة عملت كام مكالمة وكام واتس اب وجالها كام ليد وعملت كام حجز لكام عميل وحصلت فلوس اد ايه …
// تقرير شهري وأسبوعي تفصيلي، الأونلاين والدقي عمل دخل اد ايه ومصاريف اد ايه، وكام عميل جديد للشهر وكام عميل قديم حجز كورسات جديدة».
//
// Two reports, each ONE read per figure over a bounded range of Cairo days, aggregated in SQL:
//   buildEmployeeReport  one row per sales / collection / support employee
//   buildBranchReport    Online, الدقي, التجمع and the total, with the previous equal period beside every figure, plus weekly and monthly series
//
// Column rules follow lib/teamDailyReport.js: payments.date, expenses.date and installment due dates hold a picked calendar day (compared as
// days); communications.date, leads.assigned_at and subscribers.assigned_cs_at hold UTC instants (compared with the UTC instants of Cairo's
// midnights). How a payment is read (paid, EGP, its kind) is lib/managementReportsMoney.js.

const { pool } = require('./db');
const { addDaysToDateOnly, cairoDayStartUtc, cairoToday } = require('./dates');
const { branchForId, branchIdForBranch } = require('./branches');
const { PAYMENT_REP_SQL } = require('./teamDailyReport');
const { isOpenLeadStatus, LEAD_STATUSES } = require('./leadStatuses');
const { salesPaymentSql } = require('./salesMoney');
const { weekStartOf } = require('./weeklyBranchReport');
const { compare, resolvePeriod } = require('./managementReportsPeriod');
const {
  BOOKING_SQL, BRANCH_GROUPS, KIND_LABELS, KIND_SQL, MONEY_EGP, NEW_CLIENT_SQL, OTHER_KINDS, PAID_SQL, UNCONVERTED_AMOUNT,
  groupOfBranch, kindLabel, num, round2,
} = require('./managementReportsMoney');

const EMPLOYEE_ROLES = Object.freeze(['SALES', 'COLLECTION', 'SUPPORT']);
const GROUP_ORDER = Object.freeze(['ONLINE', 'DAQQI', 'TAGAMOA', 'OTHER']);
const CATEGORY_LABELS = Object.freeze({
  SALARIES: 'مرتبات', RENT: 'إيجار', UTILITIES: 'مرافق', SOFTWARE: 'برامج', MARKETING: 'تسويق',
  EQUIPMENT: 'معدات', MAINTENANCE: 'صيانة', TRAVEL: 'سفر', OTHER: 'أخرى',
});

const inList = values => values.map(() => '?').join(',');
const bounds = ({ from, to }) => ({ from, dayAfter: addDaysToDateOnly(to, 1), startUtc: cairoDayStartUtc(from), endUtc: cairoDayStartUtc(addDaysToDateOnly(to, 1)) });

/**
 * Who may read, from the caller's financial scope (lib/financialScope.js): { fine: null } for every branch, { fine: ['DAQQI'] } for a
 * branch-scoped manager. Anyone else is refused by the route before this is called.
 */
const allowedFineOf = scope => (scope?.kind === 'branch' && scope.branch ? [scope.branch] : null);
const branchSql = (allowed, column) => (allowed ? { sql: ` AND ${column} IN (${inList(allowed)})`, params: allowed } : { sql: '', params: [] });

// ── The employee report ─────────────────────────────────────────────────────

const emptyMoney = () => ({ bookings: 0, bookingClients: 0, BOOKING: 0, INSTALMENT: 0, CERTIFICATE: 0, OTHER: 0, other: {}, total: 0 });

/** Money by employee over a range. A payment has ONE owner: a booking is its client's sales rep's (else the collection officer's); every other payment is the collection officer's (else the rep's). */
async function moneyByEmployee(db, tenantId, range, allowedFine) {
  const b = bounds(range);
  const scope = branchSql(allowedFine, 'COALESCE(p.branch, sub.branch)');
  const [rows] = await db.query(
    `SELECT ${PAYMENT_REP_SQL} AS rep, NULLIF(sub.assigned_cs_id, '') AS cs, ${KIND_SQL} AS kind,
            COUNT(*) AS n, COUNT(DISTINCT p.subscriber_id) AS clients, SUM(${MONEY_EGP}) AS egp
       FROM payments p
       LEFT JOIN subscribers sub ON sub.id = p.subscriber_id AND sub.tenant_id = p.tenant_id
       LEFT JOIN leads l ON l.id = sub.lead_id AND l.tenant_id = sub.tenant_id
      WHERE p.tenant_id = ? AND ${PAID_SQL} AND p.date >= ? AND p.date < ?${scope.sql}
      GROUP BY rep, cs, kind`,
    [tenantId, b.from, b.dayAfter, ...scope.params]);
  const byEmployee = new Map();
  for (const row of rows) {
    const rep = row.rep ? String(row.rep) : null;
    const cs = row.cs ? String(row.cs) : null;
    const owner = row.kind === 'BOOKING' ? (rep || cs) : (cs || rep);
    const key = owner || '';
    const entry = byEmployee.get(key) || emptyMoney();
    byEmployee.set(key, entry);
    const egp = num(row.egp);
    entry.total += egp;
    if (row.kind === 'BOOKING') { entry.bookings += num(row.n); entry.bookingClients += num(row.clients); entry.BOOKING += egp; }
    else if (row.kind === 'INSTALMENT' || row.kind === 'CERTIFICATE') entry[row.kind] += egp;
    else { entry.OTHER += egp; entry.other[row.kind] = num(entry.other[row.kind]) + egp; }
  }
  return byEmployee;
}

async function buildEmployeeReport({ tenantId, period = {}, scope = null, today = cairoToday() }, db = pool) {
  const range = resolvePeriod(period, today);
  const allowedFine = allowedFineOf(scope);
  const b = bounds(range);
  const staffBranch = allowedFine ? ` AND branch_id IN (${inList(allowedFine)})` : '';
  const [staff] = await db.query(
    `SELECT id, name, UPPER(role) AS role FROM staff
      WHERE tenant_id = ? AND is_active = 1 AND deleted_at IS NULL AND UPPER(role) IN (${inList(EMPLOYEE_ROLES)})${staffBranch}
      ORDER BY name`,
    [tenantId, ...EMPLOYEE_ROLES, ...(allowedFine ? allowedFine.map(branchIdForBranch) : [])]);

  // Calls and WhatsApp: the rows an employee logged in `communications`. The team inbox writes every message a person sends there too
  // (routes/team-inbox.js, with the sender's staff_id), and the bot's replies carry no staff_id, so one table is the whole record and a
  // message is counted once. WhatsApp = type WHATSAPP sent by the employee (direction OUT); a call is type CALL.
  const [comms] = await db.query(
    `SELECT staff_id AS id, SUM(type = 'CALL') AS calls, SUM(type = 'WHATSAPP' AND direction = 'OUT') AS whatsapp
       FROM communications
      WHERE tenant_id = ? AND date >= ? AND date < ? AND type IN ('CALL', 'WHATSAPP') AND staff_id IS NOT NULL
      GROUP BY staff_id`,
    [tenantId, b.startUtc, b.endUtc]);
  // Asked for the listed employees only: leads has (tenant_id, assigned_sales_id, assigned_at), and a range on assigned_at alone read the whole
  // table — six seconds on 600,000 leads (lab, 12 Nov 2026).
  const staffIds = staff.map(person => person.id);
  const [leads] = staffIds.length ? await db.query(
    `SELECT assigned_sales_id AS id, COUNT(*) AS n FROM leads
      WHERE tenant_id = ? AND assigned_sales_id IN (${inList(staffIds)}) AND assigned_at >= ? AND assigned_at < ? AND hidden = 0
      GROUP BY assigned_sales_id`,
    [tenantId, ...staffIds, b.startUtc, b.endUtc]) : [[]];
  const [clientsHanded] = await db.query(
    `SELECT assigned_cs_id AS id, COUNT(*) AS n FROM subscribers
      WHERE tenant_id = ? AND deleted_at IS NULL AND assigned_cs_at >= ? AND assigned_cs_at < ? AND assigned_cs_id IS NOT NULL AND assigned_cs_id <> ''
      GROUP BY assigned_cs_id`,
    [tenantId, b.startUtc, b.endUtc]);
  const open = [...LEAD_STATUSES].filter(isOpenLeadStatus);
  // The follow-ups are the leads' CURRENT dates: a date is overwritten when the follow-up is done, so for a past period this says what is
  // still on the calendar in it, not what was once due.
  const [followUps] = await db.query(
    `SELECT assigned_sales_id AS id, SUM(next_follow_up_date >= ? AND next_follow_up_date < ?) AS due, SUM(next_follow_up_date < ?) AS overdue
       FROM leads
      WHERE tenant_id = ? AND hidden = 0 AND next_follow_up_date IS NOT NULL AND assigned_sales_id IS NOT NULL AND status IN (${inList(open)})
      GROUP BY assigned_sales_id`,
    [b.from, b.dayAfter, today, tenantId, ...open]);

  const [money, before] = await Promise.all([
    moneyByEmployee(db, tenantId, range, allowedFine),
    moneyByEmployee(db, tenantId, range.previous, allowedFine),
  ]);
  const by = rows => new Map(rows.map(row => [String(row.id), row]));
  const commsBy = by(comms); const leadsBy = by(leads); const handedBy = by(clientsHanded); const followBy = by(followUps);

  const rows = staff.map(person => {
    const id = String(person.id);
    const m = money.get(id) || emptyMoney();
    const was = before.get(id) || emptyMoney();
    const received = num(leadsBy.get(id)?.n);
    const other = Object.fromEntries(Object.entries(m.other).map(([kind, egp]) => [kind, round2(egp)]));
    return {
      id, name: person.name, role: person.role,
      calls: num(commsBy.get(id)?.calls), whatsapp: num(commsBy.get(id)?.whatsapp),
      leads: received, clientsHanded: num(handedBy.get(id)?.n),
      bookings: m.bookings, bookingClients: m.bookingClients,
      bookingsEgp: round2(m.BOOKING), installmentsEgp: round2(m.INSTALMENT), certificatesEgp: round2(m.CERTIFICATE), otherEgp: round2(m.OTHER), other,
      collectedEgp: round2(m.total),
      conversionPct: received ? Math.round((m.bookings / received) * 1000) / 10 : null,
      avgTicketEgp: m.bookings ? round2(m.BOOKING / m.bookings) : null,
      followUpsDue: num(followBy.get(id)?.due), followUpsOverdue: num(followBy.get(id)?.overdue),
      vsBookings: compare(m.bookings, was.bookings), vsCollected: compare(m.total, was.total),
    };
  });

  const sum = key => rows.reduce((total, row) => total + num(row[key]), 0);
  const totals = {
    calls: sum('calls'), whatsapp: sum('whatsapp'), leads: sum('leads'), clientsHanded: sum('clientsHanded'),
    bookings: sum('bookings'), bookingClients: sum('bookingClients'),
    bookingsEgp: round2(sum('bookingsEgp')), installmentsEgp: round2(sum('installmentsEgp')), certificatesEgp: round2(sum('certificatesEgp')),
    otherEgp: round2(sum('otherEgp')), collectedEgp: round2(sum('collectedEgp')),
    followUpsDue: sum('followUpsDue'), followUpsOverdue: sum('followUpsOverdue'),
  };
  totals.conversionPct = totals.leads ? Math.round((totals.bookings / totals.leads) * 1000) / 10 : null;
  totals.avgTicketEgp = totals.bookings ? round2(totals.bookingsEgp / totals.bookings) : null;
  totals.vsBookings = compare(totals.bookings, rows.reduce((total, row) => total + row.vsBookings.before, 0));
  totals.vsCollected = compare(totals.collectedEgp, rows.reduce((total, row) => total + row.vsCollected.before, 0));

  // Money no listed employee owns (a client with nobody assigned, or an employee who left): said, not dropped.
  const listed = new Set(rows.map(row => row.id));
  const unattributed = { bookings: 0, collectedEgp: 0 };
  for (const [id, m] of money) if (!listed.has(id)) { unattributed.bookings += m.bookings; unattributed.collectedEgp += m.total; }
  unattributed.collectedEgp = round2(unattributed.collectedEgp);

  return { period: range, rows, totals, unattributed, scope: allowedFine ? 'branch' : 'all' };
}

// ── The branch report ───────────────────────────────────────────────────────

const emptyGroup = () => ({
  incomeEgp: 0, bookingsEgp: 0, installmentsEgp: 0, certificatesEgp: 0, otherEgp: 0, other: {},
  refundsEgp: 0, expensesEgp: 0, expensesByCategory: {}, netEgp: 0,
  bookings: 0, bookingClients: 0, newClients: 0, returningClients: 0, returningBookings: 0, avgTicketEgp: null,
  instalmentsDue: 0, instalmentsDueEgp: 0, instalmentsPaid: 0, instalmentsPaidEgp: 0, collectionRatePct: null,
  unconverted: { payments: 0, byCurrency: {} }, topCourses: [],
});

const fineClause = (allowed, column) => branchSql(allowed, column);

/** Every figure of every branch column over one range. */
async function branchFigures(db, tenantId, range, allowedFine) {
  const b = bounds(range);
  const groups = new Map(GROUP_ORDER.map(key => [key, emptyGroup()]));
  const pay = fineClause(allowedFine, 'COALESCE(p.branch, sub.branch)');

  const [money] = await db.query(
    `SELECT COALESCE(p.branch, sub.branch) AS branch, ${KIND_SQL} AS kind, p.currency AS currency,
            COUNT(*) AS n, SUM(${MONEY_EGP}) AS egp, SUM(${UNCONVERTED_AMOUNT}) AS unconverted,
            SUM(p.amount_egp IS NULL AND p.currency <> 'EGP') AS unconvertedCount
       FROM payments p
       LEFT JOIN subscribers sub ON sub.id = p.subscriber_id AND sub.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status = 'paid') AND p.date >= ? AND p.date < ?${pay.sql}
      GROUP BY branch, kind, currency`,
    [tenantId, b.from, b.dayAfter, ...pay.params]);
  for (const row of money) {
    const group = groups.get(groupOfBranch(row.branch));
    const egp = num(row.egp);
    group.incomeEgp += egp;
    if (row.kind === 'BOOKING') group.bookingsEgp += egp;
    else if (row.kind === 'INSTALMENT') group.installmentsEgp += egp;
    else if (row.kind === 'CERTIFICATE') group.certificatesEgp += egp;
    else { group.otherEgp += egp; group.other[row.kind] = num(group.other[row.kind]) + egp; }
    if (num(row.unconvertedCount)) {
      group.unconverted.payments += num(row.unconvertedCount);
      group.unconverted.byCurrency[row.currency] = num(group.unconverted.byCurrency[row.currency]) + num(row.unconverted);
    }
  }

  // Refunds are payments whose status became 'refunded': they are not in the income above (it counts paid money only), so net = income - expenses.
  const [refunds] = await db.query(
    `SELECT COALESCE(p.branch, sub.branch) AS branch, SUM(${MONEY_EGP}) AS egp
       FROM payments p
       LEFT JOIN subscribers sub ON sub.id = p.subscriber_id AND sub.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND p.status = 'refunded' AND p.date >= ? AND p.date < ?${pay.sql}
      GROUP BY branch`,
    [tenantId, b.from, b.dayAfter, ...pay.params]);
  for (const row of refunds) groups.get(groupOfBranch(row.branch)).refundsEgp += num(row.egp);

  // Expenses are filed under the branch of their branch_id, the way weeklyBranchReport.js reads them; one with none is general (من غير فرع).
  const exp = allowedFine ? { sql: ` AND e.branch_id IN (${inList(allowedFine)})`, params: allowedFine.map(branchIdForBranch) } : { sql: '', params: [] };
  const [expenses] = await db.query(
    `SELECT e.branch_id, e.category, SUM(COALESCE(e.amount_egp, CASE WHEN e.currency = 'EGP' THEN e.amount ELSE 0 END)) AS egp
       FROM expenses e
      WHERE e.tenant_id = ? AND e.deleted_at IS NULL AND e.date >= ? AND e.date < ?${exp.sql}
      GROUP BY e.branch_id, e.category`,
    [tenantId, b.from, b.dayAfter, ...exp.params]);
  for (const row of expenses) {
    const group = groups.get(groupOfBranch(branchForId(row.branch_id, 'OTHER')));
    group.expensesEgp += num(row.egp);
    group.expensesByCategory[row.category] = num(group.expensesByCategory[row.category]) + num(row.egp);
  }

  // Clients: per (branch, client) so a client is counted once per column and the columns add up to the total.
  const [bookingRows] = await db.query(
    `SELECT COALESCE(p.branch, sub.branch) AS branch, p.subscriber_id AS client, ${NEW_CLIENT_SQL} AS isNew,
            COUNT(*) AS bookings, SUM(${MONEY_EGP}) AS egp
       FROM payments p
       LEFT JOIN subscribers sub ON sub.id = p.subscriber_id AND sub.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND ${PAID_SQL} AND ${salesPaymentSql('p')} AND ${BOOKING_SQL} AND p.date >= ? AND p.date < ?${pay.sql}
      GROUP BY branch, client, isNew`,
    [b.from, tenantId, b.from, b.dayAfter, ...pay.params]);
  for (const row of bookingRows) {
    const group = groups.get(groupOfBranch(row.branch));
    group.bookings += num(row.bookings);
    group.bookingClients += 1;
    if (num(row.isNew)) group.newClients += 1;
    else { group.returningClients += 1; group.returningBookings += num(row.bookings); }
  }

  // Instalments: the plan entries that fell due in the range and how many were paid, by the client's branch.
  const inst = fineClause(allowedFine, 's.branch');
  const [entries] = await db.query(
    `SELECT s.branch AS branch, COUNT(*) AS due, SUM(e.paid = 1) AS paid,
            SUM(CASE WHEN COALESCE(pl.currency, 'EGP') = 'EGP' THEN e.amount ELSE 0 END) AS dueEgp,
            SUM(CASE WHEN COALESCE(pl.currency, 'EGP') = 'EGP' AND e.paid = 1 THEN e.amount ELSE 0 END) AS paidEgp
       FROM installment_entries e
       JOIN installment_plans pl ON pl.id = e.plan_id AND pl.tenant_id = e.tenant_id
       JOIN subscribers s ON s.id = COALESCE(e.subscriber_id, pl.subscriber_id) AND s.tenant_id = e.tenant_id
      WHERE e.tenant_id = ? AND e.due_date >= ? AND e.due_date < ? AND COALESCE(pl.status, '') <> 'cancelled'${inst.sql}
      GROUP BY s.branch`,
    [tenantId, b.from, b.dayAfter, ...inst.params]);
  for (const row of entries) {
    const group = groups.get(groupOfBranch(row.branch));
    group.instalmentsDue += num(row.due); group.instalmentsPaid += num(row.paid);
    group.instalmentsDueEgp += num(row.dueEgp); group.instalmentsPaidEgp += num(row.paidEgp);
  }

  // Top courses: course/track money (bookings and their instalments) by item, five per column.
  const [items] = await db.query(
    `SELECT COALESCE(p.branch, sub.branch) AS branch, COALESCE(p.bundle_id, p.course_id) AS item,
            COALESCE(bu.title, c.title_ar, c.title, p.item_title) AS title, SUM(${MONEY_EGP}) AS egp
       FROM payments p
       LEFT JOIN subscribers sub ON sub.id = p.subscriber_id AND sub.tenant_id = p.tenant_id
       LEFT JOIN courses c ON c.id = p.course_id AND c.tenant_id = p.tenant_id
       LEFT JOIN bundles bu ON bu.id = p.bundle_id AND bu.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND ${PAID_SQL} AND ${salesPaymentSql('p')} AND (p.course_id IS NOT NULL OR p.bundle_id IS NOT NULL)
        AND p.date >= ? AND p.date < ?${pay.sql}
      GROUP BY branch, item, title`,
    [tenantId, b.from, b.dayAfter, ...pay.params]);
  const itemsByGroup = new Map();
  for (const row of items) {
    const key = groupOfBranch(row.branch);
    const list = itemsByGroup.get(key) || new Map();
    const entry = list.get(row.item) || { item: row.item, title: row.title || '—', egp: 0 };
    entry.egp += num(row.egp);
    list.set(row.item, entry);
    itemsByGroup.set(key, list);
  }
  for (const [key, list] of itemsByGroup) {
    groups.get(key).topCourses = [...list.values()].sort((x, y) => y.egp - x.egp).slice(0, 5).map(x => ({ ...x, egp: round2(x.egp) }));
  }

  for (const group of groups.values()) {
    group.netEgp = group.incomeEgp - group.expensesEgp;
    group.avgTicketEgp = group.bookings ? group.bookingsEgp / group.bookings : null;
    group.collectionRatePct = group.instalmentsDue ? Math.round((group.instalmentsPaid / group.instalmentsDue) * 1000) / 10 : null;
  }
  return groups;
}

const SUM_KEYS = ['incomeEgp', 'bookingsEgp', 'installmentsEgp', 'certificatesEgp', 'otherEgp', 'refundsEgp', 'expensesEgp', 'netEgp',
  'bookings', 'bookingClients', 'newClients', 'returningClients', 'returningBookings',
  'instalmentsDue', 'instalmentsDueEgp', 'instalmentsPaid', 'instalmentsPaidEgp'];

function totalOf(groups) {
  const total = emptyGroup();
  const items = new Map();
  for (const group of groups) {
    for (const key of SUM_KEYS) total[key] += group[key];
    for (const [kind, egp] of Object.entries(group.other)) total.other[kind] = num(total.other[kind]) + egp;
    for (const [category, egp] of Object.entries(group.expensesByCategory)) total.expensesByCategory[category] = num(total.expensesByCategory[category]) + egp;
    total.unconverted.payments += group.unconverted.payments;
    for (const [currency, amount] of Object.entries(group.unconverted.byCurrency)) total.unconverted.byCurrency[currency] = num(total.unconverted.byCurrency[currency]) + amount;
    for (const course of group.topCourses) {
      const entry = items.get(course.item) || { ...course, egp: 0 };
      entry.egp += course.egp;
      items.set(course.item, entry);
    }
  }
  // A column's top five only; the total's is the best of those (an item outside every column's five cannot reach the total's).
  total.topCourses = [...items.values()].sort((x, y) => y.egp - x.egp).slice(0, 5).map(x => ({ ...x, egp: round2(x.egp) }));
  total.avgTicketEgp = total.bookings ? total.bookingsEgp / total.bookings : null;
  total.collectionRatePct = total.instalmentsDue ? Math.round((total.instalmentsPaid / total.instalmentsDue) * 1000) / 10 : null;
  return total;
}

function present(figures, previous) {
  const rounded = { ...figures };
  for (const key of ['incomeEgp', 'bookingsEgp', 'installmentsEgp', 'certificatesEgp', 'otherEgp', 'refundsEgp', 'expensesEgp', 'netEgp', 'instalmentsDueEgp', 'instalmentsPaidEgp']) rounded[key] = round2(figures[key]);
  rounded.avgTicketEgp = figures.avgTicketEgp === null ? null : round2(figures.avgTicketEgp);
  rounded.other = Object.entries(figures.other).filter(([, egp]) => egp).map(([kind, egp]) => ({ kind, label: kindLabel(kind), egp: round2(egp) }));
  rounded.expensesByCategory = Object.entries(figures.expensesByCategory).filter(([, egp]) => egp)
    .map(([category, egp]) => ({ category, label: CATEGORY_LABELS[category] || category, egp: round2(egp) })).sort((x, y) => y.egp - x.egp);
  rounded.vs = Object.fromEntries(['incomeEgp', 'bookingsEgp', 'installmentsEgp', 'certificatesEgp', 'otherEgp', 'expensesEgp', 'netEgp', 'bookings', 'newClients', 'returningClients']
    .map(key => [key, compare(figures[key], previous[key])]));
  return rounded;
}

/** The week (Saturday to Friday) buckets ending with the one that holds today, and the month buckets ending with this month. */
function seriesBuckets(today, weeks = 8, months = 6) {
  const lastWeek = weekStartOf(today);
  const weekStarts = Array.from({ length: weeks }, (_, i) => addDaysToDateOnly(lastWeek, -7 * (weeks - 1 - i)));
  const [year, month] = today.split('-').map(Number);
  const monthKeys = Array.from({ length: months }, (_, i) => {
    const index = year * 12 + (month - 1) - (months - 1 - i);
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
  return { weekStarts, monthKeys };
}

async function series(db, tenantId, { weekStarts, monthKeys }, allowedFine) {
  const out = { weekly: [], monthly: [] };
  const pay = fineClause(allowedFine, 'COALESCE(p.branch, sub.branch)');
  const exp = allowedFine ? { sql: ` AND e.branch_id IN (${inList(allowedFine)})`, params: allowedFine.map(branchIdForBranch) } : { sql: '', params: [] };
  const spans = [
    ['weekly', weekStarts[0], addDaysToDateOnly(weekStarts[weekStarts.length - 1], 7), "FLOOR(DATEDIFF(p.date, ?) / 7)", "FLOOR(DATEDIFF(e.date, ?) / 7)", weekStarts],
    ['monthly', `${monthKeys[0]}-01`, addDaysToDateOnly(`${monthKeys[monthKeys.length - 1]}-01`, 31).slice(0, 7) + '-01', "DATE_FORMAT(p.date, '%Y-%m')", "DATE_FORMAT(e.date, '%Y-%m')", monthKeys],
  ];
  for (const [name, start, end, payBucket, expBucket, labels] of spans) {
    const weekly = name === 'weekly';
    const [income] = await db.query(
      `SELECT COALESCE(p.branch, sub.branch) AS branch, ${payBucket} AS bucket, SUM(${MONEY_EGP}) AS egp
         FROM payments p
         LEFT JOIN subscribers sub ON sub.id = p.subscriber_id AND sub.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND ${PAID_SQL} AND p.date >= ? AND p.date < ?${pay.sql}
        GROUP BY branch, bucket`,
      [...(weekly ? [start] : []), tenantId, start, end, ...pay.params]);
    const [spent] = await db.query(
      `SELECT e.branch_id, ${expBucket} AS bucket, SUM(COALESCE(e.amount_egp, CASE WHEN e.currency = 'EGP' THEN e.amount ELSE 0 END)) AS egp
         FROM expenses e
        WHERE e.tenant_id = ? AND e.deleted_at IS NULL AND e.date >= ? AND e.date < ?${exp.sql}
        GROUP BY e.branch_id, bucket`,
      [...(weekly ? [start] : []), tenantId, start, end, ...exp.params]);
    const cells = new Map();
    const cell = (label, group) => {
      const key = `${label}|${group}`;
      if (!cells.has(key)) cells.set(key, { incomeEgp: 0, expensesEgp: 0 });
      return cells.get(key);
    };
    for (const row of income) cell(weekly ? labels[num(row.bucket)] : row.bucket, groupOfBranch(row.branch)).incomeEgp += num(row.egp);
    for (const row of spent) cell(weekly ? labels[num(row.bucket)] : row.bucket, groupOfBranch(branchForId(row.branch_id, 'OTHER'))).expensesEgp += num(row.egp);
    out[name] = labels.map(label => {
      const point = { label, from: weekly ? label : `${label}-01`, branches: {} };
      let incomeEgp = 0; let expensesEgp = 0;
      for (const group of GROUP_ORDER) {
        const c = cells.get(`${label}|${group}`) || { incomeEgp: 0, expensesEgp: 0 };
        point.branches[group] = { incomeEgp: round2(c.incomeEgp), expensesEgp: round2(c.expensesEgp), netEgp: round2(c.incomeEgp - c.expensesEgp) };
        incomeEgp += c.incomeEgp; expensesEgp += c.expensesEgp;
      }
      point.total = { incomeEgp: round2(incomeEgp), expensesEgp: round2(expensesEgp), netEgp: round2(incomeEgp - expensesEgp) };
      return point;
    });
  }
  return out;
}

async function buildBranchReport({ tenantId, period = {}, scope = null, today = cairoToday(), withSeries = true }, db = pool) {
  const range = resolvePeriod(period, today);
  const allowedFine = allowedFineOf(scope);
  const [now, before] = await Promise.all([
    branchFigures(db, tenantId, range, allowedFine),
    branchFigures(db, tenantId, range.previous, allowedFine),
  ]);
  const shown = GROUP_ORDER.filter(key => !allowedFine || groupOfBranch(allowedFine[0]) === key)
    .filter(key => key !== 'OTHER' || now.get(key).incomeEgp || now.get(key).expensesEgp || before.get(key).incomeEgp || before.get(key).expensesEgp);
  const branches = shown.map(key => ({ key, label: BRANCH_GROUPS[key], ...present(now.get(key), before.get(key)) }));
  const total = { key: 'TOTAL', label: 'الإجمالي', ...present(totalOf(shown.map(key => now.get(key))), totalOf(shown.map(key => before.get(key)))) };
  return {
    period: range, branches, total,
    kinds: { ...KIND_LABELS, OTHER: 'أخرى' }, otherKinds: OTHER_KINDS,
    series: withSeries ? await series(db, tenantId, seriesBuckets(today), allowedFine) : null,
    scope: allowedFine ? 'branch' : 'all',
  };
}

module.exports = { EMPLOYEE_ROLES, buildBranchReport, buildEmployeeReport, seriesBuckets };
