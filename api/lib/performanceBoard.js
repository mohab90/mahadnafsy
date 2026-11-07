'use strict';

/**
 * «لوحة KPI — المدير»: how each employee and each branch did over a period (7 Nov 2026), from the database.
 *
 * Per employee: the leads they were given and how many became clients (and the rate); the money they recorded — new bookings, instalments collected, and
 * certificates apart (certificate money is not course money); how fast they first answered a new lead they were given (minutes from the later of its arrival and its assignment
 * to their first outgoing contact); the follow-ups still waiting against the contacts made; attendance and lateness where HR holds it; the month's target against what the month
 * has brought; the last three months of money and the change against their average; and a rank by money. Per branch: leads, conversion and money.
 *
 * Days are Cairo days, `from` and `to` inclusive. Money is payments.amount_egp of paid, undeleted payments by the staff member who recorded them.
 */

const { pool } = require('./db');
const { addDaysToDateOnly, cairoDayStartUtc, cairoToday } = require('./dates');
const { CONVERTED_SQL } = require('./leadStatuses');
const { FOLLOW_UP_OPEN } = require('./leadFollowUps');

const COURSE_MONEY = "(p.payment_type IS NULL OR UPPER(p.payment_type) <> 'CERTIFICATE')";
const num = value => Number(value) || 0;
const MAX_DAYS = 366;
const PRESENT = ['PRESENT', 'LATE', 'HALF_DAY', 'REMOTE'];

const monthStartOf = day => `${day.slice(0, 7)}-01`;
function monthsBack(day, count) {
  const [year, month] = day.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const index = year * 12 + (month - 1) - (count - i);
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
  });
}

/** The range a picker names: today | week (the last 7 days) | month (this month so far) | custom (from, to). */
function rangeOf({ range = 'month', from, to } = {}, today = cairoToday()) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (range === 'today') return { from: today, to: today };
  if (range === 'week') return { from: addDaysToDateOnly(today, -6), to: today };
  if (range === 'custom' && day.test(from || '') && day.test(to || '')) {
    const [a, b] = from <= to ? [from, to] : [to, from];
    const span = Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
    return { from: a, to: span > MAX_DAYS ? addDaysToDateOnly(a, MAX_DAYS - 1) : b };
  }
  return { from: monthStartOf(today), to: today };
}

async function buildPerformance(tenantId, { from, to, today = cairoToday() }) {
  const start = cairoDayStartUtc(from);
  const end = cairoDayStartUtc(addDaysToDateOnly(to, 1));
  const targetMonth = to.slice(0, 7);
  const months = [...monthsBack(to, 3), monthStartOf(to)];
  const monthEnd = addDaysToDateOnly(to, 1);
  const monthSums = months.map((month, i) => `COALESCE(SUM(CASE WHEN p.date >= ? AND p.date < ? THEN p.amount_egp END), 0) AS m${i}`).join(', ');
  const monthParams = months.flatMap((month, i) => [cairoDayStartUtc(month), i === months.length - 1 ? cairoDayStartUtc(monthEnd) : cairoDayStartUtc(months[i + 1])]);

  const [[staff], [leads], [money], [monthly], [responses], [due], [contacts], [attendance], [targets], [branchLeads], [branchMoney]] = await Promise.all([
    pool.query(`SELECT s.id, s.name, s.role, COALESCE(b.label, s.branch_id) AS branch FROM staff s LEFT JOIN branches b ON b.id = s.branch_id AND b.tenant_id = s.tenant_id
                 WHERE s.tenant_id = ? AND s.is_active = 1 AND s.deleted_at IS NULL`, [tenantId]),
    pool.query(`SELECT l.assigned_sales_id AS id, COUNT(*) AS received, SUM(l.status IN ${CONVERTED_SQL}) AS converted FROM leads l
                 WHERE l.tenant_id = ? AND l.deleted_at IS NULL AND l.hidden = 0 AND l.assigned_sales_id IS NOT NULL AND l.created_at >= ? AND l.created_at < ? GROUP BY 1`, [tenantId, start, end]),
    pool.query(`SELECT p.staff_id AS id,
                       COALESCE(SUM(CASE WHEN ${COURSE_MONEY} AND p.is_installment = 0 THEN p.amount_egp END), 0) AS revenue,
                       COALESCE(SUM(CASE WHEN ${COURSE_MONEY} AND p.is_installment = 1 THEN p.amount_egp END), 0) AS collections,
                       COALESCE(SUM(CASE WHEN UPPER(p.payment_type) = 'CERTIFICATE' THEN p.amount_egp END), 0) AS certificates,
                       MAX(NULLIF(p.staff_name, '')) AS name
                  FROM payments p WHERE p.tenant_id = ? AND p.status = 'paid' AND p.deleted_at IS NULL AND p.staff_id IS NOT NULL AND p.date >= ? AND p.date < ? GROUP BY 1`, [tenantId, start, end]),
    pool.query(`SELECT p.staff_id AS id, ${monthSums} FROM payments p
                 WHERE p.tenant_id = ? AND p.status = 'paid' AND p.deleted_at IS NULL AND ${COURSE_MONEY} AND p.staff_id IS NOT NULL AND p.date >= ? AND p.date < ? GROUP BY 1`,
    [...monthParams, tenantId, cairoDayStartUtc(months[0]), cairoDayStartUtc(monthEnd)]),
    pool.query(`SELECT r.id, AVG(r.minutes) AS minutes, COUNT(*) AS answered FROM (
                  SELECT l.assigned_sales_id AS id, TIMESTAMPDIFF(MINUTE, GREATEST(l.created_at, COALESCE(l.assigned_at, l.created_at)), (SELECT MIN(c.date) FROM communications c
                          WHERE c.tenant_id = l.tenant_id AND c.lead_id = l.id AND c.staff_id = l.assigned_sales_id AND c.direction = 'OUT' AND c.date >= COALESCE(l.assigned_at, l.created_at))) AS minutes
                    FROM leads l WHERE l.tenant_id = ? AND l.deleted_at IS NULL AND l.hidden = 0 AND l.assigned_sales_id IS NOT NULL AND l.created_at >= ? AND l.created_at < ?) r
                 WHERE r.minutes IS NOT NULL GROUP BY 1`, [tenantId, start, end]),
    pool.query(`SELECT l.assigned_sales_id AS id, COUNT(*) AS n FROM leads l
                 WHERE l.tenant_id = ? AND l.deleted_at IS NULL AND ${FOLLOW_UP_OPEN} AND l.assigned_sales_id IS NOT NULL AND l.next_follow_up_date >= ? AND l.next_follow_up_date < ? GROUP BY 1`, [tenantId, start, end]),
    pool.query(`SELECT c.staff_id AS id, COUNT(*) AS n FROM communications c WHERE c.tenant_id = ? AND c.staff_id IS NOT NULL AND c.direction = 'OUT' AND c.date >= ? AND c.date < ? GROUP BY 1`, [tenantId, start, end]),
    pool.query(`SELECT a.staff_id AS id, SUM(a.status IN (?)) AS present, SUM(a.status = 'LATE') AS late, SUM(a.status = 'ABSENT') AS absent, COALESCE(SUM(a.late_minutes), 0) AS late_minutes
                  FROM attendance_logs a WHERE a.tenant_id = ? AND a.date >= ? AND a.date <= ? GROUP BY 1`, [PRESENT, tenantId, from, to]),
    pool.query('SELECT staff_id AS id, revenue_target, leads_target FROM sales_targets WHERE tenant_id = ? AND period = ?', [tenantId, targetMonth]),
    pool.query(`SELECT l.branch AS branch, COUNT(*) AS received, SUM(l.status IN ${CONVERTED_SQL}) AS converted FROM leads l
                 WHERE l.tenant_id = ? AND l.deleted_at IS NULL AND l.hidden = 0 AND l.created_at >= ? AND l.created_at < ? GROUP BY 1`, [tenantId, start, end]),
    pool.query(`SELECT COALESCE(p.branch, 'OTHER') AS branch,
                       COALESCE(SUM(CASE WHEN ${COURSE_MONEY} AND p.is_installment = 0 THEN p.amount_egp END), 0) AS revenue,
                       COALESCE(SUM(CASE WHEN ${COURSE_MONEY} AND p.is_installment = 1 THEN p.amount_egp END), 0) AS collections,
                       COALESCE(SUM(CASE WHEN UPPER(p.payment_type) = 'CERTIFICATE' THEN p.amount_egp END), 0) AS certificates
                  FROM payments p WHERE p.tenant_id = ? AND p.status = 'paid' AND p.deleted_at IS NULL AND p.date >= ? AND p.date < ? GROUP BY 1`, [tenantId, start, end]),
  ]);

  const by = rows => new Map(rows.map(row => [String(row.id), row]));
  const [leadBy, moneyBy, monthBy, respBy, dueBy, contactBy, attBy, targetBy] = [leads, money, monthly, responses, due, contacts, attendance, targets].map(by);
  const people = new Map(staff.map(s => [String(s.id), { id: s.id, name: s.name, role: s.role, branch: s.branch }]));
  // Someone who recorded money and has no staff row any more (left, or the owner) is still on the board by the name on their payments.
  for (const row of money) if (!people.has(String(row.id))) people.set(String(row.id), { id: row.id, name: row.name || 'غير معروف', role: '', branch: null });

  const employees = [...people.values()].map(person => {
    const id = String(person.id);
    const lead = leadBy.get(id); const cash = moneyBy.get(id); const att = attBy.get(id); const target = targetBy.get(id);
    const m = monthBy.get(id);
    const trend = m ? [num(m.m0), num(m.m1), num(m.m2)].map(Math.round) : [0, 0, 0];
    const monthToDate = m ? Math.round(num(m.m3)) : 0;
    const average = trend.reduce((sum, value) => sum + value, 0) / 3;
    const received = num(lead?.received); const converted = num(lead?.converted);
    const revenue = Math.round(num(cash?.revenue)); const collections = Math.round(num(cash?.collections));
    return {
      id: person.id, name: person.name, role: person.role, branch: person.branch,
      leads: { received, converted, rate: received ? Math.round((converted / received) * 100) : 0 },
      money: { revenue, collections, certificates: Math.round(num(cash?.certificates)), total: revenue + collections },
      responseMinutes: respBy.get(id) ? Math.round(num(respBy.get(id).minutes)) : null,
      followUps: { waiting: num(dueBy.get(id)?.n), contacts: num(contactBy.get(id)?.n) },
      attendance: att ? { present: num(att.present), late: num(att.late), absent: num(att.absent), lateMinutes: num(att.late_minutes) } : null,
      target: target ? {
        month: targetMonth, revenue: num(target.revenue_target), leads: num(target.leads_target), achieved: monthToDate,
        pct: num(target.revenue_target) ? Math.round((monthToDate / num(target.revenue_target)) * 100) : null,
      } : null,
      trend: { months: months.slice(0, 3).map(month => month.slice(0, 7)), money: trend, changeVsAverage: average > 0 ? Math.round(((monthToDate - average) / average) * 100) : null, monthToDate },
    };
  }).filter(e => e.money.total > 0 || e.money.certificates > 0 || e.leads.received > 0 || e.followUps.contacts > 0 || e.followUps.waiting > 0 || e.attendance)
    .sort((a, b) => b.money.total - a.money.total || b.leads.converted - a.leads.converted || String(a.name).localeCompare(String(b.name), 'ar'))
    .map((e, i) => ({ ...e, rank: i + 1 }));

  const branchMap = new Map();
  for (const row of branchLeads) branchMap.set(row.branch || 'OTHER', { branch: row.branch || 'OTHER', received: num(row.received), converted: num(row.converted), revenue: 0, collections: 0, certificates: 0 });
  for (const row of branchMoney) {
    const entry = branchMap.get(row.branch) || { branch: row.branch, received: 0, converted: 0, revenue: 0, collections: 0, certificates: 0 };
    Object.assign(entry, { revenue: Math.round(num(row.revenue)), collections: Math.round(num(row.collections)), certificates: Math.round(num(row.certificates)) });
    branchMap.set(row.branch, entry);
  }
  const branches = [...branchMap.values()].map(b => ({ ...b, rate: b.received ? Math.round((b.converted / b.received) * 100) : 0, total: b.revenue + b.collections }))
    .sort((a, b) => b.total - a.total);
  return { from, to, today, employees, branches };
}

module.exports = { buildPerformance, rangeOf, monthsBack, MAX_DAYS };
