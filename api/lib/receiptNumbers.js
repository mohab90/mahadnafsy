'use strict';

// A branch's receipt numbers, in sequence.
//
// «محتاجين نخلي ارقام العمليات اللي هيا ارقام الايصالات تكون مرتبة بتسلسل ولو وقع رقم يظهر
// للمديرين ان في مشكلة في ايصال رقم كذا مش موجود» (13 Oct 2026). Dokki and Tagamoa each
// number their receipts 1, 2, 3… (payments.receipt_no, migration 280). The number is given
// INSIDE the transaction that records the payment — the counter row is locked until it
// commits — so a payment that rolls back gives its number back and nothing is skipped; and
// two desks recording at once take one number each, in turn.

const { isPhysicalBranch } = require('./physicalBranches');

const normalize = branch => String(branch || '').trim().toUpperCase().replace(/[-\s]+/g, '_');

/** The branch's series, or null: only the physical branches number their receipts. */
const receiptSeriesOf = branch => (isPhysicalBranch(normalize(branch)) ? normalize(branch) : null);

/**
 * The next receipt number of the branch, taken in `conn`'s open transaction; null for a
 * branch that has no series (online).
 */
async function nextReceiptNo(conn, { tenantId, branch }) {
  const series = receiptSeriesOf(branch);
  if (!series) return null;
  await conn.query('INSERT IGNORE INTO receipt_counters (tenant_id, branch, last_no) VALUES (?, ?, 0)', [tenantId, series]);
  const [[row]] = await conn.query('SELECT last_no FROM receipt_counters WHERE tenant_id = ? AND branch = ? FOR UPDATE', [tenantId, series]);
  const next = Number(row?.last_no || 0) + 1;
  await conn.query('UPDATE receipt_counters SET last_no = ? WHERE tenant_id = ? AND branch = ?', [next, tenantId, series]);
  return next;
}

/**
 * What is wrong with a branch's sequence, given the numbers it holds.
 * `rows` are { receiptNo, deleted } for every row with a number (a deleted one included).
 * missing   a number below the highest with no row at all
 * removed   a number whose payment was deleted
 */
function sequenceProblems(rows) {
  const present = new Map();
  for (const row of rows) present.set(Number(row.receiptNo), row);
  const highest = Math.max(0, ...present.keys());
  const missing = [];
  const removed = [];
  for (let number = 1; number <= highest; number += 1) {
    const row = present.get(number);
    if (!row) missing.push(number);
    else if (row.deleted) removed.push({ ...row, receiptNo: number });
  }
  return { highest, count: present.size, missing, removed };
}

/** The problems of each physical branch's sequence (one tenant), for the managers' alert. */
async function findReceiptGaps(db, { tenantId, branches }) {
  const out = [];
  for (const branch of branches) {
    const [rows] = await db.query(
      `SELECT p.id, p.receipt_no, p.deleted_at, p.amount, p.currency, p.date, p.staff_name
         FROM payments p WHERE p.tenant_id = ? AND p.branch = ? AND p.receipt_no IS NOT NULL
        ORDER BY p.receipt_no`, [tenantId, branch]);
    const problems = sequenceProblems(rows.map(row => ({
      receiptNo: row.receipt_no, deleted: Boolean(row.deleted_at), paymentId: row.id,
      amount: Number(row.amount) || 0, currency: row.currency, date: row.date, staffName: row.staff_name || null,
    })));
    out.push({ branch, ...problems });
  }
  return out;
}

module.exports = { receiptSeriesOf, nextReceiptNo, sequenceProblems, findReceiptGaps };
