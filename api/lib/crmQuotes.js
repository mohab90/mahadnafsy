'use strict';

const crypto = require('node:crypto');

const CURRENCIES = new Set(['EGP', 'SAR', 'USD']);
const ITEM_TYPES = new Set(['course', 'bundle']);

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function quoteNumber(now = new Date()) {
  const day = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `Q-${day}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function validateQuoteInput(input) {
  const currency = String(input?.currency || 'EGP').toUpperCase();
  const discountPercent = Number(input?.discount_percent || 0);
  const taxPercent = Number(input?.tax_percent || 0);
  if (!CURRENCIES.has(currency)) throw Object.assign(new Error('Unsupported quote currency'), { statusCode: 400 });
  if (!Array.isArray(input?.items) || !input.items.length || input.items.length > 20) {
    throw Object.assign(new Error('Quote requires 1 to 20 items'), { statusCode: 400 });
  }
  if (![discountPercent, taxPercent].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) {
    throw Object.assign(new Error('Discount and tax must be between 0 and 100'), { statusCode: 400 });
  }
  const items = input.items.map((item, index) => {
    const itemType = String(item?.item_type || '').toLowerCase();
    const itemId = String(item?.item_id || '').trim();
    const quantity = Number(item?.quantity || 1);
    if (!ITEM_TYPES.has(itemType) || !itemId || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100) {
      throw Object.assign(new Error(`Invalid quote item at index ${index}`), { statusCode: 400 });
    }
    return { itemType, itemId, quantity: money(quantity) };
  });
  return { currency, discountPercent, taxPercent, items };
}

async function loadCatalogSnapshots(db, tenantId, validated) {
  const priceColumn = `price_${validated.currency.toLowerCase()}`;
  const snapshots = new Map();
  for (const itemType of ITEM_TYPES) {
    const ids = [...new Set(validated.items.filter(item => item.itemType === itemType).map(item => item.itemId))];
    if (!ids.length) continue;
    const table = itemType === 'course' ? 'courses' : 'bundles';
    const catalogTimestamp = itemType === 'course' ? 'updated_at' : 'created_at';
    const [rows] = await db.query(
      `SELECT id,title,${priceColumn} AS unit_price,${catalogTimestamp} AS catalog_updated_at
         FROM ${table}
        WHERE tenant_id=? AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
      [tenantId, ...ids]
    );
    for (const row of rows) snapshots.set(`${itemType}:${row.id}`, {
      itemType,
      itemId: row.id,
      title: row.title,
      unitPrice: money(row.unit_price),
      currency: validated.currency,
      catalogUpdatedAt: row.catalog_updated_at || null,
    });
  }
  if (snapshots.size !== new Set(validated.items.map(item => `${item.itemType}:${item.itemId}`)).size) {
    throw Object.assign(new Error('One or more catalog items were not found in this tenant'), { statusCode: 404 });
  }
  return snapshots;
}

function calculateQuote(validated, snapshots) {
  const items = validated.items.map((item, sortOrder) => {
    const snapshot = snapshots.get(`${item.itemType}:${item.itemId}`);
    const lineSubtotal = money(snapshot.unitPrice * item.quantity);
    return { ...item, ...snapshot, lineSubtotal, sortOrder };
  });
  const subtotal = money(items.reduce((sum, item) => sum + item.lineSubtotal, 0));
  const discountAmount = money(subtotal * validated.discountPercent / 100);
  const taxable = Math.max(subtotal - discountAmount, 0);
  const taxAmount = money(taxable * validated.taxPercent / 100);
  return {
    currency: validated.currency,
    discountPercent: validated.discountPercent,
    taxPercent: validated.taxPercent,
    subtotal,
    discountAmount,
    taxAmount,
    total: money(taxable + taxAmount),
    items,
  };
}

const DEFAULT_APPROVAL_BANDS = Object.freeze([
  { minPercent: 0, maxPercent: 10, level: 'none', roles: [] },
  {
    minPercent: 10.01, maxPercent: 20, level: 'manager',
    roles: ['admin', 'manager', 'online_manager', 'sales_collection_manager', 'daqqi_manager'],
  },
  { minPercent: 20.01, maxPercent: 100, level: 'executive', roles: ['admin', 'manager'] },
]);

function resolveDiscountApproval(discountPercent, configuredBands) {
  const source = Array.isArray(configuredBands) && configuredBands.length ? configuredBands : DEFAULT_APPROVAL_BANDS;
  const bands = source.map(band => ({
    minPercent: Math.max(Number(band.minPercent ?? band.min_percent) || 0, 0),
    maxPercent: Math.min(Number(band.maxPercent ?? band.max_percent) || 100, 100),
    level: ['none', 'manager', 'executive'].includes(band.level) ? band.level : 'manager',
    roles: Array.isArray(band.roles) ? [...new Set(band.roles.map(role => String(role).toLowerCase()))] : [],
  }));
  const selected = bands.find(band => discountPercent >= band.minPercent && discountPercent <= band.maxPercent)
    || DEFAULT_APPROVAL_BANDS[DEFAULT_APPROVAL_BANDS.length - 1];
  return {
    required: selected.level !== 'none',
    level: selected.level,
    roles: selected.roles,
    discountPercent,
  };
}

module.exports = {
  CURRENCIES,
  ITEM_TYPES,
  money,
  quoteNumber,
  validateQuoteInput,
  loadCatalogSnapshots,
  calculateQuote,
  DEFAULT_APPROVAL_BANDS,
  resolveDiscountApproval,
};
