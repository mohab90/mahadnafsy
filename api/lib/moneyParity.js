'use strict';

// Holds the two readings of what a client owes to each other (8 Nov 2026): the one every screen draws — lib/clientItems.js, through GET /api/admin/clients/:id/money and
// the `moneyItems` of every list row — and the SQL balance the receipts, the instalments, the collections and the student's page read (lib/agreedPrice.js itemBalances).
// They are the same rule written twice; this lists every client and item where they differ by a piastre. Read-only. Used by the nightly check
// (lib/reconcileChecks.js, a sample), by tools/client-money-parity.cjs (every client) and by tests/integration/oneMoneyParity.

const { clientMoney } = require('./clientMoney');
const { itemBalances } = require('./agreedPrice');

const cents = value => Math.round((Number(value) || 0) * 100);

/** @returns {Promise<string[]>} one line per client/item that differs: «<client> <item>: route […] · sql […]» as [agreed, paid, before the system, remaining] in piastres. */
async function compareClientMoney(db, { tenantId, subscriberIds }) {
  const differences = [];
  for (const subscriberId of subscriberIds) {
    const fresh = await clientMoney(db, { tenantId, subscriberId });
    if (!fresh) continue;
    const sql = await itemBalances(db, { tenantId, subscriberId });
    const ours = new Map(fresh.items.map(line => [line.item, line]));
    for (const key of new Set([...ours.keys(), ...sql.keys()])) {
      const a = ours.get(key); const s = sql.get(key);
      const mine = a ? [cents(a.agreed), cents(a.paid), cents(a.priorPaid), cents(a.remaining)] : null;
      const theirs = s ? [cents(s.expected), cents(s.paid), cents(s.priorPaid), cents(s.remaining)] : null;
      if (JSON.stringify(mine) !== JSON.stringify(theirs)) differences.push(`${subscriberId} ${key}: route ${JSON.stringify(mine)} · sql ${JSON.stringify(theirs)}`);
    }
  }
  return differences;
}

/** The clients to compare in a nightly pass: the ones with money recorded most recently, up to `limit` — where a disagreement would be seen first. */
async function recentClientIds(db, { limit = 300 } = {}) {
  const [rows] = await db.query(
    `SELECT tenant_id, subscriber_id FROM payments WHERE deleted_at IS NULL AND subscriber_id IS NOT NULL
      GROUP BY tenant_id, subscriber_id ORDER BY MAX(created_at) DESC LIMIT ${Number(limit) || 300}`);
  return rows.map(row => ({ tenantId: row.tenant_id, subscriberId: row.subscriber_id }));
}

module.exports = { compareClientMoney, recentClientIds };
