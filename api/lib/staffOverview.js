'use strict';

// The personal overviews of the collection officer, the online manager and the Dokki reception
// (GET /api/staff/overview-summary): the money collected today, this week and this month, what is still owed,
// the instalments that are overdue or due, the last thirty days and — for the online manager — how each
// collection officer is doing. The screens added these up out of every client the panel had downloaded.
// Over the same lite clients as the clients screen (staffClientsView.js) and with its rules: collected money
// only, in pounds at the fallback rates, the balance the clients table shows.

const { addDaysToDateOnly } = require('./dates');
const { balanceOf, cairoDay, isCollected, toEgp } = require('./staffClientsView');

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

module.exports = { buildOverview, dueOf };
