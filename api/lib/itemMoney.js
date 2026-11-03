'use strict';

// The price one client agreed for an item and the money they paid for it before the system — the table client_item_money (migration 359), and the ONLY code that
// reads or writes it. They were two maps inside subscribers.crm_json (customPrices / priorPaid), read from twenty places and overwritten by any whole-client save from a
// screen holding an older copy (3 Nov 2026: «انقل الأسعار المتفق عليها ومدفوع قبل السيستم من crm_json لجدول»).
//
// An item is a course id, or `bundle:<id>` for a track. A row holds either number or both; a number of zero (or none) is no row.
// The maps the screens and the older code speak — { customPrices: { item: price }, priorPaid: { item: amount } } — are what loadItemMoney returns, so callers that
// held `crm.priorPaid` change one line. A test (tests/clientItemMoneyHasOneHome.test.js) keeps anything else from reading the old place.

const IN_CHUNK = 1000;
const num = value => Number(value) || 0;

/** The maps of one client, or of many: Map<subscriberId, { customPrices, priorPaid }> (a client with nothing is absent; use moneyOf to always get maps). */
async function loadItemMoney(db, { tenantId, subscriberIds = null }) {
  const out = new Map();
  const add = rows => {
    for (const row of rows) {
      const entry = out.get(row.subscriber_id) || { customPrices: {}, priorPaid: {} };
      if (num(row.agreed_price) > 0) entry.customPrices[row.item_key] = num(row.agreed_price);
      if (num(row.prior_paid) > 0) entry.priorPaid[row.item_key] = num(row.prior_paid);
      out.set(row.subscriber_id, entry);
    }
  };
  if (subscriberIds === null) {
    const [rows] = await db.query('SELECT subscriber_id, item_key, agreed_price, prior_paid FROM client_item_money WHERE tenant_id=?', [tenantId]);
    add(rows);
    return out;
  }
  const ids = [...new Set(subscriberIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const [rows] = await db.query(
      'SELECT subscriber_id, item_key, agreed_price, prior_paid FROM client_item_money WHERE tenant_id=? AND subscriber_id IN (?)', [tenantId, ids.slice(i, i + IN_CHUNK)]);
    add(rows);
  }
  return out;
}

const EMPTY = Object.freeze({ customPrices: Object.freeze({}), priorPaid: Object.freeze({}) });

/** One client's maps (always both). */
async function moneyOf(db, { tenantId, subscriberId }) {
  const found = (await loadItemMoney(db, { tenantId, subscriberIds: [subscriberId] })).get(subscriberId);
  return found || { customPrices: {}, priorPaid: {} };
}

/** The client's crm object with the two maps filled from the table (a copy that was left inside the JSON is overridden, never read). */
function withItemMoney(crm, money) {
  const { customPrices: _old1, priorPaid: _old2, ...rest } = crm || {};
  const held = money || EMPTY;
  return { ...rest, customPrices: { ...held.customPrices }, priorPaid: { ...held.priorPaid } };
}

/** The crm object as it is stored: without the two maps. */
function withoutItemMoney(crm) {
  const { customPrices: _old1, priorPaid: _old2, ...rest } = crm || {};
  return rest;
}

/** The whole of what a client paid before the system, for balances that read nothing else. */
async function priorPaidTotals(db, { tenantId, subscriberIds }) {
  const out = new Map();
  for (const [id, entry] of await loadItemMoney(db, { tenantId, subscriberIds })) {
    out.set(id, Object.values(entry.priorPaid).reduce((sum, value) => sum + num(value), 0));
  }
  return out;
}

const keepOrDrop = (db, tenantId, subscriberId, itemKey) => db.query(
  'DELETE FROM client_item_money WHERE tenant_id=? AND subscriber_id=? AND item_key=? AND COALESCE(agreed_price, 0) <= 0 AND COALESCE(prior_paid, 0) <= 0',
  [tenantId, subscriberId, itemKey]);

/** Set (a positive number) or clear (zero / null) one client's price for one item; `undefined` leaves it as it is. Run inside the caller's transaction. */
async function setItemMoney(db, { tenantId, subscriberId, itemKey, price, priorPaid }) {
  if (!itemKey) return;
  const asNumber = value => (value === undefined ? undefined : (num(value) > 0 ? num(value) : null));
  const newPrice = asNumber(price);
  const newPrior = asNumber(priorPaid);
  if (newPrice === undefined && newPrior === undefined) return;
  await db.query(
    `INSERT INTO client_item_money (tenant_id, subscriber_id, item_key, agreed_price, prior_paid) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE agreed_price = ${newPrice === undefined ? 'agreed_price' : 'VALUES(agreed_price)'}, prior_paid = ${newPrior === undefined ? 'prior_paid' : 'VALUES(prior_paid)'}`,
    [tenantId, subscriberId, itemKey, newPrice ?? null, newPrior ?? null]);
  await keepOrDrop(db, tenantId, subscriberId, itemKey);
}

/** Replace both whole maps of a client (a track renamed, a currency converted): what is not in them is gone. Run inside the caller's transaction. */
async function replaceItemMoney(db, { tenantId, subscriberId, customPrices = {}, priorPaid = {} }) {
  await db.query('DELETE FROM client_item_money WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]);
  const items = new Set([...Object.keys(customPrices), ...Object.keys(priorPaid)]);
  const rows = [...items]
    .map(item => [tenantId, subscriberId, item, num(customPrices[item]) > 0 ? num(customPrices[item]) : null, num(priorPaid[item]) > 0 ? num(priorPaid[item]) : null])
    .filter(row => row[3] !== null || row[4] !== null);
  if (rows.length) await db.query('INSERT INTO client_item_money (tenant_id, subscriber_id, item_key, agreed_price, prior_paid) VALUES ?', [rows]);
}

// Every comparison with another table's column names the collation of THIS table's columns on the other side: a database holds text columns in more than one collation
// (production has utf8mb4_general_ci ones), and MariaDB refuses to compare two columns of different ones. It is on the other table's value, so this table's key stays usable.
const UNICODE = 'COLLATE utf8mb4_unicode_ci';

/** SQL for «paid before the system» of one item, for a query that has the client as `${clientAlias}` and the item as `${itemSql}` (a column or a bound value). */
function priorPaidSql(clientAlias, itemSql) {
  return `COALESCE((SELECT m.prior_paid FROM client_item_money m WHERE m.tenant_id = ${clientAlias}.tenant_id ${UNICODE} AND m.subscriber_id = ${clientAlias}.id ${UNICODE} AND m.item_key = ${itemSql} ${UNICODE}), 0)`;
}

/** SQL for the whole of a client's «paid before the system», for a query that has the client as `${clientAlias}`. */
function priorPaidTotalSql(clientAlias) {
  return `COALESCE((SELECT SUM(m.prior_paid) FROM client_item_money m WHERE m.tenant_id = ${clientAlias}.tenant_id ${UNICODE} AND m.subscriber_id = ${clientAlias}.id ${UNICODE}), 0)`;
}

module.exports = { loadItemMoney, moneyOf, withItemMoney, withoutItemMoney, priorPaidTotals, setItemMoney, replaceItemMoney, priorPaidSql, priorPaidTotalSql };
