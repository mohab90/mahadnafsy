'use strict';

/**
 * What a course or bundle actually costs, according to the catalogue.
 *
 * Both public checkout endpoints took the price from the request body. Nothing
 * compared it to anything: POST /api/orders/reserve wrote whatever it was given
 * into orders.amount, and POST /api/payments/paymob-init handed a second
 * client-supplied figure to Paymob. The webhook then read the order back, saw
 * it unpaid, and enrolled the customer — so a 3,000 EGP course could be bought
 * for one pound, and the ledger would record the order's own number either way.
 *
 * Neither endpoint requires authentication, and they cannot: guests check out.
 * So the price has to come from the catalogue rather than from the caller.
 *
 * Consultations have no catalogue row — they are priced per booking — so this
 * returns null for them and the caller keeps its previous behaviour. The
 * exposure there is smaller: a consultation order grants no course access.
 */

const CURRENCY_COLUMN = {
  EGP: 'price_egp',
  SAR: 'price_sar',
  USD: 'price_usd',
};

/**
 * @param {import('mysql2/promise').Pool|object} db
 * @param {object} options
 * @param {'course'|'bundle'|'consultation'} options.type
 * @param {string} options.itemId
 * @param {string} [options.currency]
 * @param {string} [options.tenantId]
 * @returns {Promise<number|null>} the price, or null when the catalogue has no say
 */
async function resolveCatalogPrice(db, { type, itemId, currency = 'EGP', tenantId }) {
  const table = type === 'course' ? 'courses' : type === 'bundle' ? 'bundles' : null;
  if (!table || !itemId) return null;

  const column = CURRENCY_COLUMN[String(currency || 'EGP').toUpperCase()];
  if (!column) return null;

  const params = [itemId];
  let where = 'id=?';
  if (tenantId) { where += ' AND tenant_id=?'; params.push(tenantId); }

  const [[row]] = await db.query(
    `SELECT \`${column}\` AS price FROM \`${table}\`
      WHERE ${where} AND deleted_at IS NULL LIMIT 1`,
    params
  );
  if (!row) return null;

  const price = Number(row.price);
  // A missing or zero price is not "free" — it is a catalogue row nobody has
  // priced yet. Returning null keeps the caller from charging zero for it.
  return Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * Whether a submitted amount matches the catalogue, within a currency's
 * smallest meaningful unit. Amounts arrive as floats from JSON, so an exact
 * comparison would reject 2799.999999999999.
 */
function priceMatches(submitted, expected) {
  const a = Number(submitted);
  const b = Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < 0.01;
}

module.exports = { resolveCatalogPrice, priceMatches, CURRENCY_COLUMN };
