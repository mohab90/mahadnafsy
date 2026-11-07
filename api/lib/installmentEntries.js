'use strict';

// installment_entries (migration 369): one row per instalment of a plan, kept in step with installment_plans' parallel JSON arrays, so «what is overdue / due soon» is a range read
// on idx_entry_due (tenant_id, due_date, paid) instead of every plan's arrays walked in JavaScript. The plan is the source; the table can always be rebuilt from it.
//
// An entry is a plan's i-th instalment that has a due date (lib/installmentMath.js planEntries): paid when its paid date is set; a part-payment leaves it unpaid, as the plan does.

const { planEntries } = require('./installmentMath');

const COUNT_CAP = 10000;

/** Rewrites one plan's rows from the plan as it is now. `db` is the pool or the connection of the transaction that wrote the plan. */
async function syncPlanEntries(db, tenantId, planId) {
  const [[plan]] = await db.query(
    `SELECT id, tenant_id, subscriber_id, currency, total_amount, installments_count, installment_amounts, due_dates, paid_dates, paid_amounts, payment_ids
       FROM installment_plans WHERE id = ? AND tenant_id = ?`, [planId, tenantId]);
  await db.query('DELETE FROM installment_entries WHERE plan_id = ? AND tenant_id = ?', [planId, tenantId]);
  if (!plan) return 0;
  const paymentIds = (() => { try { const v = JSON.parse(plan.payment_ids || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } })();
  const rows = planEntries(plan).map(entry => {
    const seq = Number(String(entry.id).split('-').pop()) - 1;
    return [entry.id, planId, tenantId, seq, entry.dueDate, entry.amount, entry.paidAt ? 1 : 0, entry.paidAt || null, paymentIds[seq] || null, plan.subscriber_id];
  });
  if (rows.length) await db.query('INSERT INTO installment_entries (id, plan_id, tenant_id, seq, due_date, amount, paid, paid_at, payment_id, subscriber_id) VALUES ?', [rows]);
  return rows.length;
}

/** The rows of a set of plans (as installment_plans rows) in one write: their old rows are cleared and the new ones inserted together. */
async function writeRowsOf(db, plans) {
  if (!plans.length) return 0;
  const rows = [];
  for (const plan of plans) {
    const paymentIds = (() => { try { const v = JSON.parse(plan.payment_ids || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } })();
    for (const entry of planEntries(plan)) {
      const seq = Number(String(entry.id).split('-').pop()) - 1;
      rows.push([entry.id, plan.id, plan.tenant_id, seq, entry.dueDate, entry.amount, entry.paidAt ? 1 : 0, entry.paidAt || null, paymentIds[seq] || null, plan.subscriber_id]);
    }
  }
  await db.query('DELETE FROM installment_entries WHERE plan_id IN (?)', [plans.map(plan => plan.id)]);
  for (let at = 0; at < rows.length; at += 2000) {
    await db.query('INSERT INTO installment_entries (id, plan_id, tenant_id, seq, due_date, amount, paid, paid_at, payment_id, subscriber_id) VALUES ?', [rows.slice(at, at + 2000)]);
  }
  return rows.length;
}

/** Every plan's rows from the plans (the nightly job), a batch of plans at a time. Returns how many entries were written. */
async function rebuildInstallmentEntries(pool, { tenantId = null, batch = 1000 } = {}) {
  let after = '';
  let written = 0;
  for (;;) {
    const [plans] = await pool.query(
      `SELECT id, tenant_id, subscriber_id, currency, total_amount, installments_count, installment_amounts, due_dates, paid_dates, paid_amounts, payment_ids
         FROM installment_plans WHERE id > ?${tenantId ? ' AND tenant_id = ?' : ''} ORDER BY id LIMIT ?`,
      tenantId ? [after, tenantId, batch] : [after, batch]);
    if (!plans.length) break;
    written += await writeRowsOf(pool, plans);
    after = plans.at(-1).id;
    if (plans.length < batch) break;
  }
  // rows of plans that no longer exist
  await pool.query(`DELETE e FROM installment_entries e LEFT JOIN installment_plans ip ON ip.id = e.plan_id WHERE ip.id IS NULL${tenantId ? ' AND e.tenant_id = ?' : ''}`, tenantId ? [tenantId] : []);
  return written;
}

/**
 * The instalments due on or before `soonUntil` and still unpaid, over the clients a scope sees: { overdue, upcoming } as dueInstallments (lib/staffClientsView.js) answers,
 * with the counts of each (not capped) and the first `limit` rows by due date. `scope` is { where, params } over the alias `s` (subscribers).
 */
async function dueFromEntries(pool, tenantId, scope, today, soonUntil, limit = 200) {
  // STRAIGHT_JOIN: from the entries' own index (tenant, due date, paid) to the client by its key, then the plan by its key — the optimiser's own order started from the clients.
  const from = `FROM installment_entries e
       STRAIGHT_JOIN subscribers s ON s.id = e.subscriber_id AND s.tenant_id = e.tenant_id
       STRAIGHT_JOIN installment_plans ip ON ip.id = e.plan_id`;
  const where = range => `WHERE e.tenant_id = ? AND e.paid = 0 AND ${range} AND s.deleted_at IS NULL AND (${scope.where})`;
  const rowsOf = (range, params) => pool.query(
    `SELECT e.due_date, e.amount, ip.currency, ip.title, s.id AS client_id, s.name, s.phone, COALESCE(c.title, b.title) AS course_title
       ${from}
       LEFT JOIN courses c ON c.id = ip.course_id AND c.tenant_id = ip.tenant_id
       LEFT JOIN bundles b ON b.id = ip.bundle_id AND b.tenant_id = ip.tenant_id
      ${where(range)} ORDER BY e.due_date, e.id LIMIT ?`, params).then(([rows]) => rows.map(row => ({
    clientId: row.client_id, name: row.name, phone: row.phone || '', courseTitle: row.course_title || row.title || '',
    amount: Number(row.amount) || 0, currency: row.currency || 'EGP', dueDate: String(row.due_date instanceof Date ? row.due_date.toISOString() : row.due_date).slice(0, 10),
  })));
  const [[counts], overdue, upcoming] = await Promise.all([
    // counted up to COUNT_CAP unpaid instalments: a badge that reads «10,000+» does not need the exact size of a backlog that large
    pool.query(`SELECT COALESCE(SUM(c.late), 0) AS overdue, COALESCE(SUM(1 - c.late), 0) AS upcoming FROM (SELECT (e.due_date <= ?) AS late ${from} ${where('e.due_date <= ?')} LIMIT ${COUNT_CAP + 1}) c`, [today, tenantId, soonUntil, ...scope.params]),
    rowsOf('e.due_date <= ?', [tenantId, today, ...scope.params, limit]),
    rowsOf('e.due_date > ? AND e.due_date <= ?', [tenantId, today, soonUntil, ...scope.params, limit]),
  ]);
  const overdueCount = Number(counts[0].overdue) || 0;
  const upcomingCount = Number(counts[0].upcoming) || 0;
  return { overdueCount, upcomingCount, capped: overdueCount + upcomingCount > COUNT_CAP, overdue, upcoming };
}

module.exports = { syncPlanEntries, rebuildInstallmentEntries, dueFromEntries };
