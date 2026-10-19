'use strict';

// The personal overviews of the collection officer, the online manager and the Dokki reception
// (GET /api/staff/overview-summary): the money collected today, this week and this month, what is still owed,
// the instalments that are overdue or due, the last thirty days and — for the online manager — how each
// collection officer is doing. The screens added these up out of every client the panel had downloaded.
// Over the same lite clients as the clients screen (staffClientsView.js) and with its rules: collected money
// only, in pounds at the fallback rates, the balance the clients table shows.

const { addDaysToDateOnly, safeDateOnly } = require('./dates');
const { balanceOf, cairoDay, isCollected, toEgp } = require('./staffClientsView');
const { parseCrm } = require('./helpers');
const { VALID_BRANCHES } = require('../constants/permissions');
const { installmentPlansBySubscriber, withInstallmentPlans } = require('./installmentPlansBySubscriber');

// Above this many clients in the person's scope the payments and enrolments are read once for the tenant and picked
// out by client here, instead of by a list of thousands of ids (the manager's scope is every client; 30,000 ids in an
// IN () cost 0.4 s of the 0.9 s the overview took).
const READ_WHOLE_TABLE_ABOVE = 2000;

const unpaidEntries = client => (client.installmentPlans || []).flatMap(plan =>
  (plan.entries || []).filter(entry => !entry.paidAt && entry.dueDate).map(entry => ({ date: entry.dueDate, amount: entry.amount, currency: plan.currency || entry.currency || 'EGP' })));

/** The instalments of one client that are overdue (`overdue`), due today (`today`) or within the week (`week`); null when none. */
function dueOf(client, today, weekEnd) {
  const entries = unpaidEntries(client).sort((a, b) => a.date.localeCompare(b.date));
  const kinds = {
    overdue: entries.filter(entry => entry.date < today),
    today: entries.filter(entry => entry.date === today),
    week: entries.filter(entry => entry.date > today && entry.date <= weekEnd),
  };
  return { entries, kinds };
}

/**
 * `clients`: the lite clients of the person's scope. `team`: [{ id, name, role, leadIds: Set }] — the collection officers
 * with the leads each works (online manager only). `calls`: Map(staffId → { today, week, month }).
 */
function buildOverview(clients, { today, weekStart, monthStart, catalogue, team = [], calls = new Map() }) {
  const weekEnd = addDaysToDateOnly(today, 7);
  const last30 = Array.from({ length: 30 }, (_, i) => ({ day: addDaysToDateOnly(today, i - 29), rev: 0 }));
  const dayIndex = new Map(last30.map((d, i) => [d.day, i]));
  const money = { today: 0, week: 0, month: 0, total: 0, remaining: 0 };
  const overdue = []; const dueToday = []; let dueWeek = 0;
  const courseCounts = {};
  const byMember = new Map(team.map(member => [member.id, {
    id: member.id, name: member.name, role: member.role, subs: 0, monthRev: 0, weekRev: 0, todayRev: 0, remaining: 0, overdue: 0,
    callsToday: calls.get(member.id)?.today || 0, callsWeek: calls.get(member.id)?.week || 0, callsMonth: calls.get(member.id)?.month || 0,
  }]));
  // A lead may be worked by two officers (its sales owner and its collection owner): the client counts for both.
  const membersOfLead = new Map();
  for (const member of team) for (const leadId of member.leadIds) membersOfLead.set(leadId, [...(membersOfLead.get(leadId) || []), member.id]);

  for (const client of clients) {
    const balance = balanceOf(client, catalogue);
    money.remaining += balance.remainingEgp;
    for (const payment of client.paymentHistory || []) {
      if (!isCollected(payment)) continue;
      const day = cairoDay(payment.at);
      const amount = toEgp(payment.amount, payment.currency);
      money.total += amount;
      if (day === today) money.today += amount;
      if (day >= weekStart) money.week += amount;
      if (day >= monthStart) money.month += amount;
      if (dayIndex.has(day)) last30[dayIndex.get(day)].rev += amount;
      const member = byMember.get(payment.staffId);
      if (member) {
        if (day === today) member.todayRev += amount;
        if (day >= weekStart) member.weekRev += amount;
        if (day >= monthStart) member.monthRev += amount;
      }
    }
    const { entries, kinds } = dueOf(client, today, weekEnd);
    const row = () => ({ id: client.id, name: client.name, clientCode: client.clientCode || '', amount: entries[0]?.amount || 0, currency: entries[0]?.currency || 'EGP', date: entries[0]?.date || '' });
    if (kinds.overdue.length) overdue.push(row());
    if (kinds.today.length) dueToday.push(row());
    if (kinds.week.length) dueWeek += 1;
    for (const id of [...(client.enrolledCourseIds || [])]) if (id) courseCounts[id] = (courseCounts[id] || 0) + 1;
    for (const id of membersOfLead.get(client.leadId) || []) {
      const member = byMember.get(id);
      member.subs += 1;
      member.remaining += balance.remainingEgp;
      if (kinds.overdue.length) member.overdue += 1;
    }
  }
  return {
    clients: clients.length,
    money, last30,
    installments: { overdue: { count: overdue.length, rows: overdue.slice(0, 20) }, dueToday: { count: dueToday.length, rows: dueToday.slice(0, 20) }, dueWeek },
    team: [...byMember.values()], courseCounts,
  };
}

/**
 * The clients of one scope with only what buildOverview and the balance rule read: payments (without who recorded
 * them or their notes), the courses and tracks they hold, their plans, their agreed prices and what they paid before
 * the system. The same clients, in the same order, as shapeStaffSubscribers gives (newest first) — the overview does not
 * need their placements, certificates or contact history, which were most of what it spent reading.
 */
async function readOverviewClients(db, tenantId, sc) {
  const readClients = () => db.query(
    `SELECT s.id, s.name, s.branch, s.lead_id, s.client_code, s.crm_json
       FROM subscribers s
      WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND (${sc.where})
      ORDER BY s.created_at DESC, s.id DESC`,
    [tenantId, ...sc.params]
  );
  // Not ORDER BY date: sorting the whole table cost three times what reading it did. Each client's few payments are
  // put in date order below, which is the only order the balance rule reads them in.
  const readPayments = ids => db.query(
    `SELECT x.subscriber_id, x.course_id, x.bundle_id, x.amount, x.currency, x.payment_type, x.course_expected,
            x.\`date\`, x.status, x.staff_id
       FROM payments x
      WHERE x.tenant_id=? AND x.deleted_at IS NULL${ids ? ` AND x.subscriber_id IN (${ids.map(() => '?').join(',')})` : ''}`,
    [tenantId, ...(ids || [])]
  );
  const readEnrolments = ids => db.query(
    `SELECT x.subscriber_id, x.course_id, x.bundle_id FROM enrollments x
      WHERE x.tenant_id=? AND x.status='active'${ids ? ` AND x.subscriber_id IN (${ids.map(() => '?').join(',')})` : ''}`,
    [tenantId, ...(ids || [])]
  );

  let rows; let payRows; let enrolRows; let plansBySub; let inScope = null;
  if (sc.everyone) {
    // Every client of the tenant: nothing to ask by id, so all four reads go at once.
    [[rows], [payRows], [enrolRows], plansBySub] = await Promise.all([
      readClients(), readPayments(null), readEnrolments(null), installmentPlansBySubscriber(tenantId, null),
    ]);
    inScope = new Set(rows.map(row => row.id));
  } else {
    [rows] = await readClients();
    const ids = rows.map(row => row.id);
    const wholeTable = ids.length > READ_WHOLE_TABLE_ABOVE;
    if (wholeTable) inScope = new Set(ids);
    if (!ids.length) return [];
    [[payRows], [enrolRows], plansBySub] = await Promise.all([
      readPayments(wholeTable ? null : ids), readEnrolments(wholeTable ? null : ids), installmentPlansBySubscriber(tenantId, wholeTable ? null : ids),
    ]);
  }

  const paymentsOf = new Map();
  for (const p of payRows) {
    if (inScope && !inScope.has(p.subscriber_id)) continue;
    const list = paymentsOf.get(p.subscriber_id) || [];
    const time = p.date instanceof Date ? p.date.getTime() : NaN;
    list.push({
      amount: Number(p.amount) || 0, currency: p.currency || 'EGP',
      paymentType: (p.payment_type || 'other').toLowerCase(),
      courseId: p.course_id || null, bundleId: p.bundle_id || null,
      courseExpected: p.course_expected != null ? Number(p.course_expected) : undefined,
      at: time ? new Date(time).toISOString().slice(0, 10) : safeDateOnly(p.date), status: p.status || 'paid', staffId: p.staff_id || null,
      time: time || 0,
    });
    paymentsOf.set(p.subscriber_id, list);
  }
  for (const list of paymentsOf.values()) if (list.length > 1) list.sort((a, b) => a.time - b.time);
  const holdsOf = new Map();
  for (const e of enrolRows) {
    if (inScope && !inScope.has(e.subscriber_id)) continue;
    const held = holdsOf.get(e.subscriber_id) || { courses: [], bundles: [] };
    if (e.bundle_id && !held.bundles.includes(String(e.bundle_id))) held.bundles.push(String(e.bundle_id));
    if (e.course_id && !held.courses.includes(String(e.course_id))) held.courses.push(String(e.course_id));
    holdsOf.set(e.subscriber_id, held);
  }

  return rows.map(row => {
    const crm = withInstallmentPlans(parseCrm(row.crm_json), plansBySub.get(row.id));
    const held = holdsOf.get(row.id);
    const rawBranch = row.branch || crm.branch || null;
    const normalized = rawBranch ? rawBranch.toUpperCase().replace(/[-\s]/g, '_') : null;
    return {
      id: row.id, name: row.name,
      clientCode: row.client_code || crm.clientCode || null,
      leadId: row.lead_id || crm.leadId || undefined,
      branch: (normalized && VALID_BRANCHES.has(normalized)) ? normalized : rawBranch,
      market: crm.market, customPrices: crm.customPrices, priorPaid: crm.priorPaid,
      installmentPlans: crm.installmentPlans,
      enrolledCourseIds: held?.courses || [], enrolledBundleIds: held?.bundles || [],
      paymentHistory: paymentsOf.get(row.id) || [],
    };
  });
}

module.exports = { buildOverview, dueOf, readOverviewClients };
