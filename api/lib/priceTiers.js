'use strict';

/**
 * What a course or track (مسار) costs at each branch.
 *
 * «نخلي كل كورس باكتر من سعر … سعر الدقي لوحدة وسعر الاونلاين للمصرين وسعر
 * الاونلاين لغير المصرين في مصر وسعر التجمع لوحدة … كمان يكون في سعر الخصم».
 *
 * A course used to carry one price per currency (price_egp / price_sar /
 * price_usd), so the Dokki desk, an online Egyptian and a foreign resident of
 * Egypt all read the same EGP figure, and the desk typed a «سعر مختلف» whenever
 * that was wrong. Each tier here is a price at one branch, in that branch's
 * currency, with an optional discount price the desk may offer instead.
 *
 * The three online tiers are also the public site's prices: saving one writes
 * the matching price_* column, and a tier with no row of its own reads it. The
 * physical branches and the foreign-resident tier fall back to the online
 * Egyptian price until somebody prices them — «inherited» says so, so the
 * course editor can show which figures nobody has set yet.
 */

const PRICE_TIERS = Object.freeze([
  { key: 'DAQQI', label: 'فرع الدقي', currency: 'EGP', branch: 'DAQQI', physical: true },
  { key: 'TAGAMOA', label: 'فرع التجمع', currency: 'EGP', branch: 'TAGAMOA', physical: true },
  { key: 'ONLINE_EGYPT', label: 'أونلاين — مصريين', currency: 'EGP', branch: 'ONLINE_EGYPT', column: 'price_egp', nationality: 'EGYPTIAN' },
  { key: 'ONLINE_EGYPT_FOREIGN', label: 'أونلاين — غير مصريين مقيمين في مصر', currency: 'EGP', branch: 'ONLINE_EGYPT', nationality: 'NON_EGYPTIAN_EGYPT' },
  { key: 'ONLINE_SAUDI', label: 'أونلاين — سعودي', currency: 'SAR', branch: 'ONLINE_SAUDI', column: 'price_sar' },
  { key: 'ONLINE_ABROAD', label: 'أونلاين — دولي', currency: 'USD', branch: 'ONLINE_ABROAD', column: 'price_usd' },
]);
const TIER_BY_KEY = new Map(PRICE_TIERS.map(tier => [tier.key, tier]));
const TABLES = { course: 'courses', bundle: 'bundles' };

const BONUS_ROLES = Object.freeze(['sales', 'service', 'instructor']);

const money = value => {
  if (value === '' || value == null) return null;
  const n = Math.round(Number(value) * 100) / 100;
  return Number.isFinite(n) && n > 0 && n <= 10000000 ? n : null;
};

/** The tier a branch (and, for online Egypt, a nationality) is priced at. */
function tierForBranch(branch, nationality) {
  const b = String(branch || '').toUpperCase();
  if (b === 'ONLINE_EGYPT' && String(nationality || '').toUpperCase() === 'NON_EGYPTIAN_EGYPT') return 'ONLINE_EGYPT_FOREIGN';
  return TIER_BY_KEY.has(b) ? b : null;
}

/** {sales,service,instructor}: each {type:'fixed'|'percent', value} or absent. */
function normalizeBonuses(raw) {
  const source = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : (raw || {});
  const out = {};
  for (const role of BONUS_ROLES) {
    const entry = source[role];
    if (!entry) continue;
    const type = entry.type === 'percent' ? 'percent' : 'fixed';
    const value = Number(entry.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (type === 'percent' && value > 100) continue;
    out[role] = { type, value: Math.round(value * 100) / 100 };
  }
  return out;
}

function shapeTiers(item, rows) {
  const byTier = new Map(rows.map(row => [row.tier, row]));
  const columnPrice = tier => (tier.column ? money(item[tier.column]) : null);
  const onlineEgypt = money(byTier.get('ONLINE_EGYPT')?.price) ?? columnPrice(TIER_BY_KEY.get('ONLINE_EGYPT'));
  return PRICE_TIERS.map(tier => {
    const row = byTier.get(tier.key);
    let price = money(row?.price) ?? columnPrice(tier);
    let inherited = false;
    if (price == null && tier.currency === 'EGP' && tier.key !== 'ONLINE_EGYPT' && onlineEgypt != null) {
      price = onlineEgypt;
      inherited = true;
    }
    const discount = money(row?.discount_price);
    return {
      key: tier.key,
      label: tier.label,
      currency: tier.currency,
      branch: tier.branch,
      price,
      // A discount at or above the price is no discount; it is a typo.
      discountPrice: discount != null && price != null && discount < price ? discount : null,
      inherited,
    };
  });
}

async function loadItems(db, tenantId, type, itemId) {
  const table = TABLES[type];
  if (!table) return [];
  const params = [tenantId];
  let where = 'tenant_id=? AND deleted_at IS NULL';
  if (itemId) { where += ' AND id=?'; params.push(itemId); }
  const [rows] = await db.query(
    `SELECT id, price_egp, price_sar, price_usd, booking_bonuses_json FROM \`${table}\` WHERE ${where}`, params);
  return rows;
}

async function loadPriceRows(db, tenantId, type, itemId) {
  const params = [tenantId, type];
  let where = 'tenant_id=? AND item_type=?';
  if (itemId) { where += ' AND item_id=?'; params.push(itemId); }
  const [rows] = await db.query(
    `SELECT item_id, tier, price, discount_price FROM catalog_prices WHERE ${where}`, params);
  return rows;
}

/** One course's or track's tiers and booking bonuses, or null when it is not in the catalogue. */
async function getItemPricing(db, { tenantId, type, itemId }) {
  const [item] = await loadItems(db, tenantId, type, itemId);
  if (!item) return null;
  const rows = await loadPriceRows(db, tenantId, type, itemId);
  return { type, itemId, tiers: shapeTiers(item, rows), bonuses: normalizeBonuses(item.booking_bonuses_json) };
}

/** Every course and track at once — what the booking screen needs to price any of them. */
async function listCatalogPricing(db, tenantId) {
  const out = { course: {}, bundle: {} };
  for (const type of ['course', 'bundle']) {
    const [items, rows] = await Promise.all([loadItems(db, tenantId, type), loadPriceRows(db, tenantId, type)]);
    const rowsByItem = new Map();
    for (const row of rows) {
      if (!rowsByItem.has(row.item_id)) rowsByItem.set(row.item_id, []);
      rowsByItem.get(row.item_id).push(row);
    }
    for (const item of items) {
      out[type][item.id] = {
        tiers: shapeTiers(item, rowsByItem.get(item.id) || []),
        bonuses: normalizeBonuses(item.booking_bonuses_json),
      };
    }
  }
  return out;
}

/**
 * Save the tiers and bonuses of one item. `tiers` is {TIER_KEY: {price, discountPrice}};
 * a tier left out is left alone, a tier sent with an empty price is cleared
 * (and inherits again). Runs on the caller's connection, inside its transaction.
 */
async function saveItemPricing(conn, { tenantId, type, itemId, tiers, bonuses, staffId = null }) {
  const table = TABLES[type];
  if (!table) throw Object.assign(new Error('Unknown catalogue type'), { status: 400 });
  const [[item]] = await conn.query(
    `SELECT id FROM \`${table}\` WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [itemId, tenantId]);
  if (!item) throw Object.assign(new Error('الكورس أو المسار مش موجود'), { status: 404 });

  for (const [key, value] of Object.entries(tiers || {})) {
    const tier = TIER_BY_KEY.get(key);
    if (!tier) throw Object.assign(new Error(`Unknown price tier: ${key}`), { status: 400 });
    const price = money(value?.price);
    let discount = money(value?.discountPrice);
    if (discount != null && (price == null || discount >= price)) {
      throw Object.assign(new Error(`سعر الخصم في «${tier.label}» لازم يبقى أقل من السعر`), { status: 400 });
    }
    if (price == null) discount = null;
    await conn.query(
      `INSERT INTO catalog_prices (tenant_id, item_type, item_id, tier, price, discount_price, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE price=VALUES(price), discount_price=VALUES(discount_price), updated_by=VALUES(updated_by)`,
      [tenantId, type, itemId, key, price, discount, staffId]);
    // The online tiers are the public site's prices too.
    if (tier.column && price != null) {
      await conn.query(`UPDATE \`${table}\` SET \`${tier.column}\`=? WHERE id=? AND tenant_id=?`, [price, itemId, tenantId]);
    }
  }
  if (bonuses !== undefined) {
    const normalized = normalizeBonuses(bonuses);
    await conn.query(`UPDATE \`${table}\` SET booking_bonuses_json=? WHERE id=? AND tenant_id=?`,
      [Object.keys(normalized).length ? JSON.stringify(normalized) : null, itemId, tenantId]);
  }
}

/**
 * The price the desk may charge for one item at one tier: the tier price, or
 * its discount price when the rep chose it. Null when the catalogue cannot say
 * (unknown item, unpriced tier, or a discount that does not exist).
 */
async function resolveTierPrice(db, { tenantId, type, itemId, tier, useDiscount = false }) {
  if (!TIER_BY_KEY.has(tier)) return null;
  const pricing = await getItemPricing(db, { tenantId, type, itemId });
  if (!pricing) return null;
  const entry = pricing.tiers.find(row => row.key === tier);
  if (!entry || entry.price == null) return null;
  if (useDiscount) {
    if (entry.discountPrice == null) return null;
    return { tier, currency: entry.currency, branch: entry.branch, price: entry.discountPrice, listPrice: entry.price, discounted: true };
  }
  return { tier, currency: entry.currency, branch: entry.branch, price: entry.price, listPrice: entry.price, discounted: false };
}

module.exports = {
  PRICE_TIERS,
  BONUS_ROLES,
  tierForBranch,
  normalizeBonuses,
  getItemPricing,
  listCatalogPricing,
  saveItemPricing,
  resolveTierPrice,
};
