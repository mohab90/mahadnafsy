'use strict';
/**
 * The Egyptian price and the non-Egyptian price of a course or track, on the Egypt (EGP) site.
 *
 * «السعر هيكون 3400، ولو سجّل إنه مصري يظهرله سعر 2800. 2300 ده سعر خصم البلاك فرايدي، لما أنفّذه يبقى موجود بس» (the owner, 12 Nov 2026).
 *
 * The prices already exist: lib/priceTiers.js keeps one per tier and the owner fills them in the course editor. This module only decides which of
 * the two a visitor is shown and charged, and it does nothing at all until tenant_settings section 'egyptian_pricing' has `enabled: true`:
 *   - ONLINE_EGYPT («أونلاين — مصريين», the column price_egp) is the price an Egyptian pays, as it has always been charged.
 *   - ONLINE_EGYPT_FOREIGN («أونلاين — غير مصريين مقيمين في مصر») is the price the site shows, and a non-Egyptian pays — only when the owner
 *     gave that tier a price of its own above the Egyptian one. An item without one (it inherits the Egyptian price) is untouched for everyone.
 *   - The tiers' discount prices are the Black Friday offer: used only while `offerActive` is on, each for its own audience.
 *
 * Who is Egyptian (resolveAudience): a client already recorded as a non-Egyptian is never; one who types a valid national ID that no other client holds is;
 * one whose record holds such an ID, or says EGYPTIAN, is. Anyone else is shown the non-Egyptian price.
 */

const { getTenantSetting } = require('./tenantSettings');
const { checkEgyptianNationalId, normalizeNationalId, NATIONAL_ID_MESSAGES } = require('./egyptianNationalId');

const SECTION = 'egyptian_pricing';
const TABLES = { course: 'courses', bundle: 'bundles' };
const NATIONAL_ID_TAKEN_MESSAGE = 'الرقم القومي ده متسجل على حساب تاني — كلّم المعهد';
const NATIONAL_ID_MISMATCH_MESSAGE = 'الرقم ده مختلف عن الرقم المسجّل على حسابك — كلّم المعهد';

const OFF = Object.freeze({ enabled: false, offerActive: false });

/** The stored setting as it is read: anything that is not an explicit `true` is off. */
function normalizeSettings(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const enabled = value.enabled === true;
  // The offer is part of this feature: with the feature off there is nothing for it to be on in.
  return enabled ? { enabled, offerActive: value.offerActive === true } : OFF;
}

async function loadSettings(db, tenantId) {
  const raw = await getTenantSetting(SECTION, { tenantId, fallback: null, db }).catch(() => null);
  return normalizeSettings(raw);
}

const money = value => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The two prices of items, by id: { egyptian, foreign (null when the item has no non-Egyptian price above the Egyptian one),
 * egyptianOffer, foreignOffer (null unless the tier has a discount price below its price) }.
 */
async function loadTierPrices(db, { tenantId, type, ids = null }) {
  const table = TABLES[type];
  const out = new Map();
  if (!table || (ids && !ids.length)) return out;
  const idFilter = ids ? ' AND id IN (?)' : '';
  const [items] = await db.query(
    `SELECT id, price_egp FROM \`${table}\` WHERE tenant_id=? AND deleted_at IS NULL${idFilter}`,
    ids ? [tenantId, ids] : [tenantId]);
  const [rows] = await db.query(
    `SELECT item_id, tier, price, discount_price FROM catalog_prices
      WHERE tenant_id=? AND item_type=? AND tier IN ('ONLINE_EGYPT','ONLINE_EGYPT_FOREIGN')${ids ? ' AND item_id IN (?)' : ''}`,
    ids ? [tenantId, type, ids] : [tenantId, type]);
  const byItem = new Map();
  for (const row of rows) {
    if (!byItem.has(row.item_id)) byItem.set(row.item_id, {});
    byItem.get(row.item_id)[row.tier] = row;
  }
  for (const item of items) {
    const egyptian = money(item.price_egp);
    const tiers = byItem.get(item.id) || {};
    const foreignRow = tiers.ONLINE_EGYPT_FOREIGN;
    const foreignPrice = money(foreignRow?.price);
    const foreign = foreignPrice > egyptian && egyptian > 0 ? foreignPrice : null;
    const egyptianOfferPrice = money(tiers.ONLINE_EGYPT?.discount_price);
    const foreignOfferPrice = money(foreignRow?.discount_price);
    out.set(String(item.id), {
      egyptian, foreign,
      egyptianOffer: egyptianOfferPrice > 0 && egyptianOfferPrice < egyptian ? egyptianOfferPrice : null,
      foreignOffer: foreign && foreignOfferPrice > 0 && foreignOfferPrice < foreign ? foreignOfferPrice : null,
    });
  }
  return out;
}

/**
 * Which price a client is entitled to. `typedId` is what he typed at this booking ('' / undefined when nothing); `checkTyped: false` skips the one-ID-one-client lookup for it (the public quote).
 * @returns {Promise<{ egyptian: boolean, basis: 'national_id'|'record'|null, nationalId: string|null, store: boolean, error: null|{status:number, code:string, message:string} }>}
 */
async function resolveAudience(db, { tenantId, subscriberId = null, typedId = '', checkTyped = true }) {
  const none = { egyptian: false, basis: null, nationalId: null, store: false, error: null };
  const [[row]] = subscriberId
    ? await db.query('SELECT national_id, nationality FROM subscribers WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [subscriberId, tenantId])
    : [[null]];
  const nationality = String(row?.nationality || '').toUpperCase();
  // Recorded as living in Egypt without being Egyptian (or as Saudi / international): priced as the foreign tier without being asked, and a typed ID is ignored.
  if (nationality && nationality !== 'EGYPTIAN') return none;

  const taken = async nationalId => {
    const [[other]] = await db.query(
      'SELECT id FROM subscribers WHERE tenant_id=? AND national_id=? AND deleted_at IS NULL AND id<>? LIMIT 1',
      [tenantId, nationalId, subscriberId || '']);
    return Boolean(other);
  };
  const stored = checkEgyptianNationalId(row?.national_id);

  if (normalizeNationalId(typedId)) {
    const checked = checkEgyptianNationalId(typedId);
    if (!checked.ok) return { ...none, error: { status: 400, code: 'NATIONAL_ID_INVALID', message: NATIONAL_ID_MESSAGES[checked.problem] } };
    if (stored.ok && stored.value !== checked.value) {
      return { ...none, error: { status: 409, code: 'NATIONAL_ID_MISMATCH', message: NATIONAL_ID_MISMATCH_MESSAGE } };
    }
    // A price quote is public: asking it whether an ID is already held would tell anyone which IDs are our clients. Only the booking (checkTyped) asks.
    if (checkTyped && await taken(checked.value)) return { ...none, error: { status: 409, code: 'NATIONAL_ID_TAKEN', message: NATIONAL_ID_TAKEN_MESSAGE } };
    return { egyptian: true, basis: 'national_id', nationalId: checked.value, store: !stored.ok, error: null };
  }
  if (stored.ok) {
    // An ID that two records hold is not a proof of anyone: neither gets the Egyptian price from it.
    if (await taken(stored.value)) return none;
    return { egyptian: true, basis: 'national_id', nationalId: stored.value, store: false, error: null };
  }
  if (nationality === 'EGYPTIAN') return { egyptian: true, basis: 'record', nationalId: null, store: false, error: null };
  return none;
}

/**
 * Writes a typed ID onto the client inside the booking's transaction, after asking again whether another client holds it
 * (two checkouts with one ID at once). Throws NATIONAL_ID_TAKEN.
 */
async function storeNationalId(conn, { tenantId, subscriberId, nationalId }) {
  const [[other]] = await conn.query(
    'SELECT id FROM subscribers WHERE tenant_id=? AND national_id=? AND deleted_at IS NULL AND id<>? LIMIT 1 FOR UPDATE',
    [tenantId, nationalId, subscriberId]);
  if (other) throw Object.assign(new Error(NATIONAL_ID_TAKEN_MESSAGE), { status: 409, code: 'NATIONAL_ID_TAKEN' });
  await conn.query(
    `UPDATE subscribers SET national_id=?, nationality=COALESCE(nationality, 'EGYPTIAN')
      WHERE id=? AND tenant_id=? AND (national_id IS NULL OR national_id='')`,
    [nationalId, subscriberId, tenantId]);
}

/**
 * The public course / track payloads with the price the Egypt site shows: price.EGP becomes the non-Egyptian price for an item that has one.
 * Returns `items` itself, untouched, while the feature is off — the public catalogue is byte for byte what it was.
 */
async function applyShownPrices(db, { tenantId, type, items }) {
  if (!items.length) return items;
  const settings = await loadSettings(db, tenantId);
  if (!settings.enabled) return items;
  const tiers = await loadTierPrices(db, { tenantId, type, ids: items.map(item => String(item.id)) });
  return items.map(item => {
    const tier = tiers.get(String(item.id));
    return tier?.foreign ? { ...item, price: { ...item.price, EGP: tier.foreign } } : item;
  });
}

/** Every course and track with both prices, for the owner's list before he switches the feature on. */
async function listForOwner(db, tenantId) {
  const out = [];
  for (const type of ['course', 'bundle']) {
    const tiers = await loadTierPrices(db, { tenantId, type });
    const [items] = await db.query(
      `SELECT id, ${type === 'course' ? 'COALESCE(NULLIF(title_ar, \'\'), title)' : 'title'} AS title, is_published
         FROM \`${TABLES[type]}\` WHERE tenant_id=? AND deleted_at IS NULL ORDER BY is_published DESC, sort_order, title`, [tenantId]);
    for (const item of items) {
      const t = tiers.get(String(item.id)) || { egyptian: 0, foreign: null, egyptianOffer: null, foreignOffer: null };
      out.push({
        type, id: item.id, title: item.title || '', published: Boolean(item.is_published),
        egyptian: t.egyptian || null, foreign: t.foreign, egyptianOffer: t.egyptianOffer, foreignOffer: t.foreignOffer,
        // No non-Egyptian price above the Egyptian one: the site shows this item exactly as today.
        unpriced: !t.foreign,
      });
    }
  }
  return out;
}

module.exports = {
  SECTION, NATIONAL_ID_TAKEN_MESSAGE, normalizeSettings, loadSettings, loadTierPrices, resolveAudience, storeNationalId, listForOwner, applyShownPrices,
};
