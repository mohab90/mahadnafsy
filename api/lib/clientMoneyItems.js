'use strict';

// `moneyItems` on every client row the admin screens read (8 Nov 2026): what the client holds, the price agreed for each item and where it came from, what was
// paid (here and before the system) and what is left — lib/clientItems.js, the one rule, run on the row's own data. The browser draws these lines; it does not
// work them out (admin/lib/agreedPrice.ts no longer has the rule). GET /api/admin/clients/:id/money (lib/clientMoney.js) is the same function on freshly
// loaded data, so a table row and the client's page agree to the piastre.

const { clientItems } = require('./clientItems');
const { clientCurrency } = require('./staffClientsView');

/** The catalogue as the rule reads it: { courses: Map(id → {price, title}), bundles: Map(id → {price, title, courseIds}) }. Read live: a price edited a moment ago is the price. */
async function loadMoneyCatalogue(db, tenantId) {
  const [courses] = await db.query(
    "SELECT id, COALESCE(NULLIF(title_ar, ''), title) AS title, price_egp, price_sar, price_usd FROM courses WHERE tenant_id=?", [tenantId]);
  const [bundles] = await db.query(
    `SELECT b.id, b.title, b.price_egp, b.price_sar, b.price_usd, GROUP_CONCAT(bc.course_id) AS course_ids
       FROM bundles b LEFT JOIN bundle_courses bc ON bc.bundle_id = b.id AND bc.tenant_id = b.tenant_id WHERE b.tenant_id=? GROUP BY b.id`, [tenantId]);
  const priceOf = row => ({ EGP: Number(row.price_egp) || 0, SAR: Number(row.price_sar) || 0, USD: Number(row.price_usd) || 0 });
  return {
    courses: new Map(courses.map(row => [String(row.id), { price: priceOf(row), title: row.title }])),
    bundles: new Map(bundles.map(row => [String(row.id), { price: priceOf(row), title: row.title, courseIds: row.course_ids ? String(row.course_ids).split(',') : [] }])),
  };
}

/** The same clients, each with `moneyItems`. The rows must carry paymentHistory (with courseExpected), customPrices, priorPaid and the enrolled ids. */
async function withMoneyItems(db, tenantId, clients, catalogue = null) {
  if (!clients.length) return clients;
  const held = catalogue || await loadMoneyCatalogue(db, tenantId);
  return clients.map(client => ({ ...client, moneyItems: clientItems(client, held, clientCurrency(client)) }));
}

module.exports = { loadMoneyCatalogue, withMoneyItems };
