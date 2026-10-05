'use strict';
// The period statement: «تقرير الحسابات محتاج تقويه واحترافيه اكتر».
//
// One period read back the way an owner reads it, every figure beside the
// same-length period before it:
//
//   collected      paid payments, in EGP (payments.amount_egp)
//   − refunds      approved or done in the period, in EGP
//   − expenses     the expenses register (expenses.amount_egp)
//   = operating result
//   − owed to the team, not yet paid: commissions and booking bonuses still
//     PENDING, instructor fees still pending/approved. Once they go through
//     payroll they are salaries, which the expenses register already carries —
//     counting the paid ones here would count them twice.
//   = result after what the team is owed
//
// Then where the money came from (branch, kind, payment method, top courses),
// where it went (expense categories), the trend, who still owes us, and the
// ledger's own revenue and expense totals for the same dates so a gap between
// cash and the books shows instead of hiding.
//
// Branch scope is the caller's resolveFinancialScope result; instructor fees
// carry no branch, so a branch-scoped statement leaves them out and says so.

const { addDaysToDateOnly } = require('./dates');
const { loadOutstandingBalances } = require('./outstandingBalances');

const num = value => Math.round((Number(value) || 0) * 100) / 100;

const dayDiff = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/** The same number of days, ending the day before `from`. */
function previousPeriod(from, to) {
  const days = dayDiff(from, to) + 1;
  const prevTo = addDaysToDateOnly(from, -1);
  return { from: addDaysToDateOnly(prevTo, -(days - 1)), to: prevTo };
}

/** Rows of [key, amount, count] into the shape the report draws, largest first. */
const ranked = rows => rows
  .map(row => ({ key: row.k == null ? '' : String(row.k), amount: num(row.amount), count: Number(row.cnt) || 0 }))
  .filter(row => row.amount !== 0 || row.count)
  .sort((a, b) => b.amount - a.amount);

async function periodTotals(db, { tenantId, from, to, scope, rates }) {
  const end = addDaysToDateOnly(to, 1);
  const b = scope?.branchId || null;
  const pay = b ? ' AND p.branch_id=?' : '';
  const args = extra => (b ? [tenantId, from, end, b, ...extra] : [tenantId, from, end, ...extra]);

  const [[money]] = await db.query(
    `SELECT COALESCE(SUM(p.amount_egp),0) AS collected, COUNT(*) AS cnt, COUNT(DISTINCT p.subscriber_id) AS clients
       FROM payments p
      WHERE p.tenant_id=? AND p.date>=? AND p.date<? AND p.status='paid' AND p.deleted_at IS NULL${pay}`,
    args([]));

  // A refund is in the refund's own currency; the payment it reverses carries
  // the rate it was taken at.
  const [[refund]] = await db.query(
    `SELECT COALESCE(SUM(r.amount * CASE
                WHEN r.currency IS NULL OR r.currency='EGP' THEN 1
                WHEN p.currency=r.currency AND p.fx_rate_to_egp>0 THEN p.fx_rate_to_egp
                WHEN r.currency='SAR' THEN ? WHEN r.currency='USD' THEN ? ELSE 1 END),0) AS v,
            COUNT(*) AS cnt
       FROM refunds r
       LEFT JOIN payments p ON p.id=r.payment_id AND p.tenant_id=r.tenant_id AND p.deleted_at IS NULL
      WHERE r.tenant_id=? AND r.status IN ('approved','done')
        AND COALESCE(r.resolved_at, r.created_at)>=? AND COALESCE(r.resolved_at, r.created_at)<?${pay}`,
    [rates.SAR || 1, rates.USD || 1, ...args([])]);

  const [[expense]] = await db.query(
    `SELECT COALESCE(SUM(amount_egp),0) AS v, COUNT(*) AS cnt FROM expenses
      WHERE tenant_id=? AND date>=? AND date<? AND deleted_at IS NULL${b ? ' AND branch_id=?' : ''}`,
    args([]));

  const [[commission]] = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN status='PENDING' THEN commission_amount ELSE 0 END),0) AS pending,
            COALESCE(SUM(commission_amount),0) AS accrued
       FROM crm_commissions
      WHERE tenant_id=? AND created_at>=? AND created_at<? AND status<>'CANCELLED'${b ? ' AND branch_id=?' : ''}`,
    args([]));

  let fees = { pending: 0, accrued: 0 };
  if (!b) {
    const [[row]] = await db.query(
      `SELECT COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN total_amount * CASE currency WHEN 'SAR' THEN ? WHEN 'USD' THEN ? ELSE 1 END ELSE 0 END),0) AS pending,
              COALESCE(SUM(total_amount * CASE currency WHEN 'SAR' THEN ? WHEN 'USD' THEN ? ELSE 1 END),0) AS accrued
         FROM instructor_fees
        WHERE tenant_id=? AND created_at>=? AND created_at<? AND status<>'rejected'`,
      [rates.SAR || 1, rates.USD || 1, rates.SAR || 1, rates.USD || 1, tenantId, from, end]);
    fees = row;
  }

  const collected = num(money.collected);
  const refunds = num(refund.v);
  const expenses = num(expense.v);
  const teamPending = num(Number(commission.pending) + Number(fees.pending));
  const operating = num(collected - refunds - expenses);
  return {
    collected,
    payments: Number(money.cnt) || 0,
    payingClients: Number(money.clients) || 0,
    averageTicket: money.cnt ? num(collected / Number(money.cnt)) : 0,
    refunds,
    refundsCount: Number(refund.cnt) || 0,
    expenses,
    expensesCount: Number(expense.cnt) || 0,
    operating,
    margin: collected > 0 ? num((operating / collected) * 100) : 0,
    teamAccrued: num(Number(commission.accrued) + Number(fees.accrued)),
    teamPending,
    afterTeam: num(operating - teamPending),
  };
}

async function buildFinanceStatement(db, { tenantId, from, to, scope = null, rates = {} }) {
  const prev = previousPeriod(from, to);
  const end = addDaysToDateOnly(to, 1);
  const b = scope?.branchId || null;
  const pay = b ? ' AND p.branch_id=?' : '';
  const base = b ? [tenantId, from, end, b] : [tenantId, from, end];
  const paidIn = `p.tenant_id=? AND p.date>=? AND p.date<? AND p.status='paid' AND p.deleted_at IS NULL${pay}`;

  const [current, previous] = await Promise.all([
    periodTotals(db, { tenantId, from, to, scope, rates }),
    periodTotals(db, { tenantId, from: prev.from, to: prev.to, scope, rates }),
  ]);

  const [byBranch] = await db.query(
    `SELECT p.branch AS k, SUM(p.amount_egp) AS amount, COUNT(*) AS cnt FROM payments p WHERE ${paidIn} GROUP BY p.branch`, base);
  const [byType] = await db.query(
    `SELECT p.payment_type AS k, SUM(p.amount_egp) AS amount, COUNT(*) AS cnt FROM payments p WHERE ${paidIn} GROUP BY p.payment_type`, base);
  const [byMethod] = await db.query(
    `SELECT COALESCE(NULLIF(p.payment_method,''),'غير محدد') AS k, SUM(p.amount_egp) AS amount, COUNT(*) AS cnt FROM payments p WHERE ${paidIn} GROUP BY k`, base);
  const [topItems] = await db.query(
    `SELECT COALESCE(c.title, bu.title, NULLIF(p.item_title,''), p.payment_type) AS k,
            CASE WHEN p.course_id IS NOT NULL THEN 'COURSE' WHEN p.bundle_id IS NOT NULL THEN 'BUNDLE' ELSE p.payment_type END AS kind,
            SUM(p.amount_egp) AS amount, COUNT(*) AS cnt, COUNT(DISTINCT p.subscriber_id) AS clients
       FROM payments p
       LEFT JOIN courses c ON c.id=p.course_id AND c.tenant_id=p.tenant_id
       LEFT JOIN bundles bu ON bu.id=p.bundle_id AND bu.tenant_id=p.tenant_id
      WHERE ${paidIn}
      GROUP BY COALESCE(p.course_id, p.bundle_id, p.item_title, p.payment_type), k, kind
      ORDER BY amount DESC LIMIT 10`, base);
  const [byCategory] = await db.query(
    `SELECT category AS k, SUM(amount_egp) AS amount, COUNT(*) AS cnt FROM expenses
      WHERE tenant_id=? AND date>=? AND date<? AND deleted_at IS NULL${b ? ' AND branch_id=?' : ''} GROUP BY category`, base);

  // Up to two months reads by day; longer, by month.
  const byDay = dayDiff(from, to) <= 62;
  const bucket = column => (byDay ? `DATE_FORMAT(${column}, '%Y-%m-%d')` : `DATE_FORMAT(${column}, '%Y-%m')`);
  const [inSeries] = await db.query(
    `SELECT ${bucket('p.date')} AS k, SUM(p.amount_egp) AS amount, COUNT(*) AS cnt FROM payments p WHERE ${paidIn} GROUP BY k`, base);
  const [outSeries] = await db.query(
    `SELECT ${bucket('date')} AS k, SUM(amount_egp) AS amount, COUNT(*) AS cnt FROM expenses
      WHERE tenant_id=? AND date>=? AND date<? AND deleted_at IS NULL${b ? ' AND branch_id=?' : ''} GROUP BY k`, base);
  const buckets = [];
  if (byDay) {
    for (let d = from; d && d <= to; d = addDaysToDateOnly(d, 1)) buckets.push(d);
  } else {
    for (let m = from.slice(0, 7); m <= to.slice(0, 7);) {
      buckets.push(m);
      const [y, mo] = m.split('-').map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
  }
  const inMap = new Map(inSeries.map(r => [r.k, num(r.amount)]));
  const outMap = new Map(outSeries.map(r => [r.k, num(r.amount)]));
  const series = buckets.map(k => ({ key: k, collected: inMap.get(k) || 0, expenses: outMap.get(k) || 0 }));

  // The ledger's view of the same dates.
  const journalArgs = b ? [tenantId, from, to, b] : [tenantId, from, to];
  const [[ledger]] = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN jel.account_code LIKE '4%' THEN jel.credit-jel.debit ELSE 0 END),0) AS revenue,
            COALESCE(SUM(CASE WHEN jel.account_code LIKE '5%' THEN jel.debit-jel.credit ELSE 0 END),0) AS expenses
       FROM journal_entries je JOIN journal_entry_lines jel ON jel.entry_id=je.id
      WHERE je.tenant_id=? AND je.entry_date BETWEEN ? AND ?${b ? ' AND je.branch_id=?' : ''}`,
    journalArgs);

  const owing = await loadOutstandingBalances(tenantId, null, scope);
  const receivables = {
    total: num(owing.reduce((sum, row) => sum + (Number(row.outstanding) || 0), 0)),
    clients: owing.length,
    top: owing.slice(0, 5).map(row => ({ name: row.name, code: row.client_code || null, outstanding: num(row.outstanding) })),
  };

  return {
    period: { from, to, days: dayDiff(from, to) + 1 },
    previousPeriod: prev,
    branch: scope?.branch || null,
    instructorFeesIncluded: !b,
    current,
    previous,
    byBranch: ranked(byBranch),
    byType: ranked(byType),
    byMethod: ranked(byMethod),
    topItems: topItems.map(row => ({ name: String(row.k || ''), kind: row.kind, amount: num(row.amount), count: Number(row.cnt) || 0, clients: Number(row.clients) || 0 })),
    expensesByCategory: ranked(byCategory),
    series: { unit: byDay ? 'day' : 'month', points: series },
    ledger: { revenue: num(ledger.revenue), expenses: num(ledger.expenses), net: num(Number(ledger.revenue) - Number(ledger.expenses)) },
    receivables,
  };
}

module.exports = { buildFinanceStatement, previousPeriod, periodTotals };
