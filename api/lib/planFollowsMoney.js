'use strict';

// An item's instalment plans follow what the client owes for it (8 Nov 2026: «صلح خطه الاقساط بردو لازم اي تغيير يسمع في اي مكان علي السيستم»).
//
// A plan kept its own copy of the money: its instalments were written when it was made and changed only when one was paid on the plan's own screen. A price
// lowered on the client's page, or a payment taken at «دفع وحجز», left the plan asking for the old amounts — the overdue list said 4,000 late on a course with
// 1,300 left. Now what is left on the item (lib/clientMoney.js — the one rule every screen reads) is what its open instalments come to:
//
//   - a payment for the item pays its open instalments from the earliest due, as if it were paid on the plan's screen (a part stays on the instalment);
//   - a plan that asked for everything that was left keeps asking for exactly that: a higher price is added to its last open instalment, a lower one taken
//     off its last ones;
//   - and no plan ever asks for more than is left: the excess comes off the last open instalments (an instalment brought to nothing is dropped, or, when part
//     of it was paid, closed at that part).
//
// Only plans of the item (course or track) in the item's currency are touched; due dates never move. Amounts are added in piastres.

const { tryJsonArr } = require('./installmentMath');

const cents = value => Math.round((Number(value) || 0) * 100);
const fromCents = value => value / 100;

/** A plan's parallel arrays, padded to its count, amounts in piastres. */
function shapeOf(plan) {
  const dueDates = tryJsonArr(plan.due_dates);
  const count = Number(plan.installments_count) || dueDates.length;
  const amounts = tryJsonArr(plan.installment_amounts);
  const fallback = count > 0 ? (Number(plan.total_amount) || 0) / count : 0;
  const pad = list => Array.from({ length: count }, (_, i) => (list[i] === undefined ? null : list[i]));
  return {
    id: plan.id,
    amounts: Array.from({ length: count }, (_, i) => cents(amounts[i] ?? fallback)),
    dueDates: pad(dueDates),
    paidDates: pad(tryJsonArr(plan.paid_dates)),
    paidAmounts: pad(tryJsonArr(plan.paid_amounts)).map(value => (value == null ? null : cents(value))),
    paymentIds: pad(tryJsonArr(plan.payment_ids)),
    drop: new Set(),
    changed: false,
  };
}

/** The open instalments of the plans, earliest due first: { shape, i, partial, outstanding } (piastres). */
function openOf(shapes) {
  const open = [];
  shapes.forEach((shape, order) => shape.amounts.forEach((amount, i) => {
    if (shape.paidDates[i] || !shape.dueDates[i] || shape.drop.has(i)) return;
    const partial = shape.paidAmounts[i] || 0;
    open.push({ shape, i, order, partial, outstanding: Math.max(0, amount - partial) });
  }));
  return open.sort((a, b) => String(a.shape.dueDates[a.i]).localeCompare(String(b.shape.dueDates[b.i])) || a.order - b.order || a.i - b.i);
}
const totalOf = open => open.reduce((sum, entry) => sum + entry.outstanding, 0);

/** Takes `excess` piastres off the last open instalments. */
function takeFromLast(open, excess, today) {
  for (const entry of [...open].reverse()) {
    if (excess <= 0) break;
    const take = Math.min(entry.outstanding, excess);
    if (take <= 0) continue;
    const { shape, i } = entry;
    shape.amounts[i] -= take;
    excess -= take;
    shape.changed = true;
    if (shape.amounts[i] - entry.partial <= 0) {
      if (entry.partial > 0) { shape.amounts[i] = entry.partial; shape.paidDates[i] = today; } else shape.drop.add(i);
    }
  }
}

/**
 * The pure part: changes `shapes` in place and says whether any changed.
 * @param {object[]} shapes from shapeOf, all in the item's currency
 * @param {{ remaining: number, before?: number|null, payment?: { id: string, amount: number, day: string }|null, today: string }} money
 *   remaining — what is left on the item now; before — what was left before this write (null when not known); payment — a payment for the item just taken.
 */
function followMoney(shapes, { remaining, before = null, payment = null, today }) {
  const target = Math.max(0, cents(remaining));
  const coveredAll = before != null && Math.abs(totalOf(openOf(shapes)) - Math.max(0, cents(before))) <= 1;

  if (payment && cents(payment.amount) > 0) {
    let left = cents(payment.amount);
    for (const entry of openOf(shapes)) {
      if (left <= 0) break;
      const take = Math.min(entry.outstanding, left);
      if (take <= 0) continue;
      const { shape, i } = entry;
      shape.paidAmounts[i] = entry.partial + take;
      if (entry.partial + take >= shape.amounts[i]) { shape.paidDates[i] = payment.day; shape.paymentIds[i] = payment.id; }
      left -= take;
      shape.changed = true;
    }
  }

  const open = openOf(shapes);
  const asked = totalOf(open);
  if (asked > target) takeFromLast(open, asked - target, today);
  else if (coveredAll && asked < target && open.length) {
    const last = open[open.length - 1];
    last.shape.amounts[last.i] += target - asked;
    last.shape.changed = true;
  }
  return shapes.some(shape => shape.changed);
}

/** The columns of a changed shape, dropped instalments taken out of every array together. */
function columnsOf(shape) {
  const keep = shape.amounts.map((_, i) => i).filter(i => !shape.drop.has(i));
  const pick = list => keep.map(i => list[i]);
  const amounts = pick(shape.amounts);
  const paidDates = pick(shape.paidDates);
  const paidCount = paidDates.filter(Boolean).length;
  return {
    installment_amounts: JSON.stringify(amounts.map(fromCents)),
    due_dates: JSON.stringify(pick(shape.dueDates)),
    paid_dates: JSON.stringify(paidDates),
    paid_amounts: JSON.stringify(pick(shape.paidAmounts).map(value => (value == null ? null : fromCents(value)))),
    payment_ids: JSON.stringify(pick(shape.paymentIds)),
    installments_count: amounts.length,
    paid_count: paidCount,
    total_amount: fromCents(amounts.reduce((sum, amount) => sum + amount, 0)),
    status: paidCount >= amounts.length ? 'completed' : 'active',
  };
}

const itemKeyOf = ({ courseId, bundleId }) => (bundleId ? `bundle:${bundleId}` : String(courseId || ''));

/** What is left on one item by the one rule (lib/clientMoney.js): { remaining, currency } or null when the client does not hold it. */
async function itemRemaining(db, { tenantId, subscriberId, courseId = null, bundleId = null }) {
  if (!subscriberId || (!courseId && !bundleId)) return null;
  const { clientMoney } = require('./clientMoney');
  const money = await clientMoney(db, { tenantId, subscriberId });
  const line = money?.items.find(item => item.item === itemKeyOf({ courseId, bundleId }));
  return line ? { remaining: line.remaining, currency: String(line.currency || 'EGP').toUpperCase() } : null;
}

/**
 * Brings the item's active plans to what is left on it, inside the caller's transaction (`db` is its connection). Returns the ids of the plans it rewrote.
 * `before` is itemRemaining() taken before the write (or null); `payment` a payment for the item just written ({ id, amount, currency, day }).
 */
async function planFollowsMoney(db, { tenantId, subscriberId, courseId = null, bundleId = null, before = null, payment = null, today }) {
  if (!subscriberId || (!courseId && !bundleId)) return [];
  const [plans] = await db.query(
    `SELECT id, currency, total_amount, installments_count, installment_amounts, due_dates, paid_dates, paid_amounts, payment_ids
       FROM installment_plans
      WHERE tenant_id=? AND subscriber_id=? AND course_id <=> ? AND bundle_id <=> ? AND status='active'
      ORDER BY created_at, id FOR UPDATE`,
    [tenantId, subscriberId, bundleId ? null : courseId, bundleId || null]);
  if (!plans.length) return [];
  const now = await itemRemaining(db, { tenantId, subscriberId, courseId, bundleId });
  if (!now) return [];
  const shapes = plans.filter(plan => String(plan.currency || 'EGP').toUpperCase() === now.currency).map(shapeOf);
  if (!shapes.length) return [];
  const sameCurrency = value => value && String(value.currency || now.currency).toUpperCase() === now.currency;
  const { cairoToday } = require('./dates');
  const changed = followMoney(shapes, {
    remaining: now.remaining,
    before: sameCurrency(before) ? before.remaining : null,
    payment: sameCurrency(payment) ? payment : null,
    today: today || cairoToday(),
  });
  if (!changed) return [];
  const { syncPlanEntries } = require('./installmentEntries');
  const written = [];
  for (const shape of shapes.filter(item => item.changed)) {
    const columns = columnsOf(shape);
    await db.query(
      `UPDATE installment_plans SET installment_amounts=?, due_dates=?, paid_dates=?, paid_amounts=?, payment_ids=?, installments_count=?, paid_count=?, total_amount=?, status=?
        WHERE id=? AND tenant_id=?`,
      [columns.installment_amounts, columns.due_dates, columns.paid_dates, columns.paid_amounts, columns.payment_ids, columns.installments_count,
        columns.paid_count, columns.total_amount, columns.status, shape.id, tenantId]);
    await syncPlanEntries(db, tenantId, shape.id);
    written.push(shape.id);
  }
  return written;
}

module.exports = { followMoney, shapeOf, columnsOf, itemRemaining, planFollowsMoney };
