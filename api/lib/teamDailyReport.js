'use strict';

// «تقرير يومي عن كل سيلز: مكالماته، الحجوزات النهارده، الفلوس، الليدز الجديدة،
// المتابعات — كل حاجة في اليوم، وأزرار أمس و7 و15 و30 يوم».
//
// One read per figure over a range of Cairo days, grouped by rep. Each column is
// compared the way it is stored: communications.date, leads.assigned_at and
// leads.created_at hold UTC instants, so the range is the UTC instants of Cairo's
// midnights; payments.date and leads.next_follow_up_date hold a picked calendar
// day at midnight, so they are compared as days.

const { pool } = require('./db');
const { addDaysToDateOnly, cairoDayStartUtc, cairoToday, isValidDateOnly } = require('./dates');
const { LEAD_STATUSES, isOpenLeadStatus } = require('./leadStatuses');

const MAX_DAYS = 93;

function reportRange(query = {}) {
  const today = cairoToday();
  const to = isValidDateOnly(query.to) ? query.to : today;
  let from = isValidDateOnly(query.from) ? query.from : to;
  if (from > to) from = to;
  const earliest = addDaysToDateOnly(to, -(MAX_DAYS - 1));
  if (from < earliest) from = earliest;
  return { from, to, today };
}

const num = value => Number(value) || 0;

// Whose client paid. The rep is on the subscriber — the column, or, for most
// of them, only in crm_json — or on the lead they came from. Payments are
// almost all recorded by the desk, so the recorder is not the rep. Read with
// `payments p LEFT JOIN subscribers sub … LEFT JOIN leads l ON l.id=sub.lead_id`.
const PAYMENT_REP_SQL = `COALESCE(
              NULLIF(sub.assigned_sales_id, ''),
              NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(sub.crm_json, '$.assignedSalesId')), 'null'), ''),
              NULLIF(l.assigned_sales_id, ''))`;
const PAYMENT_EGP_SQL = "COALESCE(p.amount_egp, CASE WHEN p.currency='EGP' THEN p.amount ELSE 0 END)";

async function buildTeamDailyReport({ tenantId, from, to, today, onlyRepId = null }, db = pool) {
  const startUtc = cairoDayStartUtc(from);
  const endUtc = cairoDayStartUtc(addDaysToDateOnly(to, 1));
  const dayAfter = addDaysToDateOnly(to, 1);
  const openStatuses = [...LEAD_STATUSES].filter(isOpenLeadStatus);
  const openIn = openStatuses.map(() => '?').join(',');

  const [reps] = await db.query(
    `SELECT id, name FROM staff
      WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL AND UPPER(role)='SALES'
      ORDER BY name`,
    [tenantId]
  );

  const [comms] = await db.query(
    `SELECT staff_id AS rep,
            SUM(type='CALL') AS calls, SUM(type='WHATSAPP') AS whatsapp,
            SUM(type='MEETING') AS meetings, COUNT(*) AS contacts,
            COUNT(DISTINCT lead_id) AS leadsContacted
       FROM communications
      WHERE tenant_id=? AND date >= ? AND date < ?
      GROUP BY staff_id`,
    [tenantId, startUtc, endUtc]
  );

  // What each rep was handed in the range — the same assigned_at the daily cap
  // counts, so this column and «أقصى عدد يستلمه» agree. Split by when the lead
  // arrived: a lead handed out today may have come in weeks ago (the pool, the
  // hourly backlog, a reassignment), and it sits far down the rep's list, which
  // is newest first — «بيقول انه اتوزعلهم داتا اليوم وبدخل بيكون دا مش حقيقي».
  const [received] = await db.query(
    `SELECT assigned_sales_id AS rep, COUNT(*) AS newLeads,
            SUM(created_at >= ? AND created_at < ?) AS freshLeads
       FROM leads
      WHERE tenant_id=? AND hidden=0 AND assigned_at >= ? AND assigned_at < ?
      GROUP BY assigned_sales_id`,
    [startUtc, endUtc, tenantId, startUtc, endUtc]
  );

  const [[arrived]] = await db.query(
    `SELECT COUNT(*) AS total,
            SUM(assigned_sales_id IS NULL OR assigned_sales_id='') AS unassigned
       FROM leads
      WHERE tenant_id=? AND hidden=0 AND created_at >= ? AND created_at < ?`,
    [tenantId, startUtc, endUtc]
  );

  const [followUps] = await db.query(
    `SELECT assigned_sales_id AS rep,
            SUM(next_follow_up_date >= ? AND next_follow_up_date < ?) AS followUpsDue,
            SUM(next_follow_up_date < ?) AS followUpsOverdue
       FROM leads
      WHERE tenant_id=? AND hidden=0 AND next_follow_up_date IS NOT NULL
        AND assigned_sales_id IS NOT NULL AND status IN (${openIn})
      GROUP BY assigned_sales_id`,
    [from, dayAfter, today, tenantId, ...openStatuses]
  );

  const [money] = await db.query(
    `SELECT ${PAYMENT_REP_SQL} AS rep,
            SUM(p.is_installment=0) AS bookings, SUM(p.is_installment=1) AS installments,
            SUM(${PAYMENT_EGP_SQL}) AS moneyEgp
       FROM payments p
       LEFT JOIN subscribers sub ON sub.id=p.subscriber_id AND sub.tenant_id=p.tenant_id
       LEFT JOIN leads l ON l.id=sub.lead_id AND l.tenant_id=sub.tenant_id
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status='paid')
        AND p.date >= ? AND p.date < ?
      GROUP BY rep`,
    [tenantId, from, dayAfter]
  );

  const byRep = rows => new Map(rows.map(row => [String(row.rep || ''), row]));
  const commsBy = byRep(comms);
  const receivedBy = byRep(received);
  const followBy = byRep(followUps);
  const moneyBy = byRep(money);

  const rows = reps
    .filter(rep => !onlyRepId || String(rep.id) === String(onlyRepId))
    .map(rep => {
      const id = String(rep.id);
      const c = commsBy.get(id) || {};
      const f = followBy.get(id) || {};
      const m = moneyBy.get(id) || {};
      return {
        id, name: rep.name,
        calls: num(c.calls), whatsapp: num(c.whatsapp), meetings: num(c.meetings),
        contacts: num(c.contacts), leadsContacted: num(c.leadsContacted),
        newLeads: num(receivedBy.get(id)?.newLeads),
        freshLeads: num(receivedBy.get(id)?.freshLeads),
        followUpsDue: num(f.followUpsDue), followUpsOverdue: num(f.followUpsOverdue),
        bookings: num(m.bookings), installments: num(m.installments), moneyEgp: Math.round(num(m.moneyEgp)),
      };
    });

  const repIds = new Set(reps.map(rep => String(rep.id)));
  const unattributed = { bookings: 0, installments: 0, moneyEgp: 0 };
  for (const row of money) {
    if (repIds.has(String(row.rep || ''))) continue;
    unattributed.bookings += num(row.bookings);
    unattributed.installments += num(row.installments);
    unattributed.moneyEgp += Math.round(num(row.moneyEgp));
  }

  const sum = key => rows.reduce((total, row) => total + row[key], 0);
  const team = {
    newLeads: num(arrived?.total),
    newLeadsUnassigned: num(arrived?.unassigned),
    calls: sum('calls'), whatsapp: sum('whatsapp'), contacts: sum('contacts'), leadsContacted: sum('leadsContacted'),
    followUpsDue: sum('followUpsDue'), followUpsOverdue: sum('followUpsOverdue'),
    // The whole desk's money, the unattributed included, so the headline is
    // what came in and the table says who.
    bookings: sum('bookings') + (onlyRepId ? 0 : unattributed.bookings),
    installments: sum('installments') + (onlyRepId ? 0 : unattributed.installments),
    moneyEgp: sum('moneyEgp') + (onlyRepId ? 0 : unattributed.moneyEgp),
  };

  return { from, to, today, team, reps: rows, unattributed: onlyRepId ? null : unattributed };
}

/**
 * The leads behind a rep's «ليدز استلمها», one by one: when each arrived, when
 * it was handed to them and by what — so the figure can be checked against the
 * rep's own list.
 */
async function listReceivedLeads({ tenantId, repId, from, to }, db = pool) {
  const startUtc = cairoDayStartUtc(from);
  const endUtc = cairoDayStartUtc(addDaysToDateOnly(to, 1));
  const [rows] = await db.query(
    `SELECT l.id, l.name, l.phone, l.source, l.status, l.created_at, l.assigned_at, (l.created_at >= ?) AS fresh,
            (SELECT t.description FROM lead_timeline t
              WHERE t.tenant_id=l.tenant_id AND t.lead_id=l.id AND t.event_type='assigned'
              ORDER BY t.at DESC LIMIT 1) AS how
       FROM leads l
      WHERE l.tenant_id=? AND l.hidden=0 AND l.assigned_sales_id=? AND l.assigned_at >= ? AND l.assigned_at < ?
      ORDER BY l.assigned_at DESC LIMIT 500`,
    [startUtc, tenantId, repId, startUtc, endUtc]
  );
  return rows.map(row => ({
    id: row.id, name: row.name, phone: row.phone, source: row.source, status: row.status,
    createdAt: row.created_at, assignedAt: row.assigned_at,
    fresh: Number(row.fresh) === 1,
    how: row.how || null,
  }));
}

module.exports = { MAX_DAYS, PAYMENT_EGP_SQL, PAYMENT_REP_SQL, buildTeamDailyReport, listReceivedLeads, reportRange };
