'use strict';
/**
 * The Egypt site's two prices (lib/egyptianPricing.js) against a real MariaDB: the price the site shows is the non-Egyptian tier's, an Egyptian
 * (national ID typed, or already on his record) pays the Egyptian tier's, the tiers' discount prices are the owner's separate offer — and with the
 * setting off, nothing differs from what the unchanged price functions give. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-egy-price-it';
const ID_A = '29001011234567';
const ID_B = '29505152101234';
let pool; let pricing; let checkout; let adminRoute; let lib; let effective; let setTenantSetting; let enrollment; let publicAgain;

const handler = (router, path, method) => router.stack.find(item => item.route?.path === path && item.route.methods[method]).route.stack.at(-1).handle;
async function call(router, path, { body = {}, method = 'post', user = null } = {}) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  await handler(router, path, method)({
    body, tenantId: TENANT, headers: {}, ip: '127.0.0.1', socket: {}, get: () => undefined, ...(user ? { user } : {}),
  }, res);
  return res;
}
const intent = (uid, body = {}) => call(checkout, '/api/public/checkout-intent', {
  user: { uid }, body: { itemType: 'course', itemId: 'c-egy-1', customerName: 'عميل', customerPhone: '01016000001', ...body },
});
const quote = body => call(pricing, '/api/public/price-quote', { body: { itemType: 'course', itemId: 'c-egy-1', currency: 'EGP', ...body } });
const setting = async value => {
  if (value === null) await pool.query("DELETE FROM tenant_settings WHERE tenant_id=? AND section='egyptian_pricing'", [TENANT]);
  else await setTenantSetting('egyptian_pricing', value, { tenantId: TENANT });
  require('../../lib/db').cacheInvalidateLocal('public-prices', 'courses', 'bundles');
};

async function clean() {
  for (const table of ['orders', 'lead_events', 'leads', 'subscribers', 'catalog_prices', 'promo_codes', 'courses', 'bundles', 'tenant_settings',
    'notifications', 'client_code_counter']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
  await pool.query('DELETE FROM tenants WHERE id=?', [TENANT]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  pricing = require('../../routes/public-pricing');
  checkout = require('../../routes/lead-capture-crm');
  adminRoute = require('../../routes/egyptian-pricing');
  lib = require('../../lib/egyptianPricing');
  effective = require('../../lib/effectivePrice');
  enrollment = require('../../lib/enrollmentPricing');
  ({ setTenantSetting } = require('../../lib/tenantSettings'));
  publicAgain = lib;
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Egy IT', 'active')", [TENANT, TENANT]);
  const course = (id, egp, sar, usd) => pool.query(
    `INSERT INTO courses (id, tenant_id, title, title_ar, short_description, instructor, description, price_egp, price_sar, price_usd, thumbnail, category, type, is_published)
     VALUES (?, ?, ?, ?, 'd', 'x', 'd', ?, ?, ?, '', 'GENERAL', 'RECORDED', 1)`, [id, TENANT, id, id, egp, sar, usd]);
  await course('c-egy-1', 2800, 300, 80);      // the owner's example: Egyptians 2800 (offer 2300), non-Egyptians 3400 (offer 2800)
  await course('c-egy-2', 2000, 250, 60);      // no non-Egyptian price of its own
  await pool.query(
    `INSERT INTO bundles (id, tenant_id, title, description, thumbnail, price_egp, price_sar, price_usd, is_published)
     VALUES ('b-egy-1', ?, 'مسار', 'd', '', 6000, 600, 160, 1)`, [TENANT]);
  const tier = (type, id, name, price, discount) => pool.query(
    'INSERT INTO catalog_prices (tenant_id, item_type, item_id, tier, price, discount_price) VALUES (?,?,?,?,?,?)', [TENANT, type, id, name, price, discount]);
  await tier('course', 'c-egy-1', 'ONLINE_EGYPT', 2800, 2300);
  await tier('course', 'c-egy-1', 'ONLINE_EGYPT_FOREIGN', 3400, 2800);
  await tier('bundle', 'b-egy-1', 'ONLINE_EGYPT_FOREIGN', 7000, null);
  await pool.query("INSERT INTO promo_codes (id, tenant_id, code, discount_type, discount_value, active) VALUES ('pc-egy-1', ?, 'TEN', 'percent', 10, 1)", [TENANT])
    .catch(() => {});
  const sub = (id, uid, phone, extra = {}) => pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, branch, firebase_uid, national_id, nationality) VALUES (?, ?, 'عميل', ?, 'ONLINE_EGYPT', ?, ?, ?)`,
    [id, TENANT, phone, uid, extra.nid || null, extra.nat || null]);
  await sub('s-new', 'uid-new', '1016000001');
  await sub('s-other', 'uid-other', '1016000002');
  await sub('s-foreign', 'uid-foreign', '1016000003', { nat: 'NON_EGYPTIAN_EGYPT' });
  await sub('s-stored', 'uid-stored', '1016000004', { nid: ID_B });
  await sub('s-record', 'uid-record', '1016000005', { nat: 'EGYPTIAN' });
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

const cashDue = (price, mode = 'cash') => enrollment.amountDueNow(price, mode, enrollment.DEFAULT_RATES);

// ── OFF: nothing differs from the unchanged price functions ─────────────────────────────────────────────────────────────

test('OFF (no setting stored): the price functions give exactly the catalogue prices, with or without a national ID in the request', { skip }, async () => {
  await setting(null);
  const context = await effective.loadPricingContext(pool, TENANT);
  assert.equal(context.egyptianPricing.enabled, false);
  const items = [['course', 'c-egy-1', 2800], ['course', 'c-egy-2', 2000], ['bundle', 'b-egy-1', 6000]];
  for (const [type, itemId, base] of items) {
    for (const promoCode of ['', 'TEN']) {
      for (const payMode of ['cash', 'installment']) {
        const reference = effective.quoteItem(
          effective.priceItem({ type, itemId, currency: 'EGP', base, discounts: context.discounts, content: context.content, promoCode,
            promoRow: promoCode ? await effective.findPromoRow(pool, { tenantId: TENANT, code: promoCode }) : null }),
          { payMode, rates: context.rates, type });
        for (const egyptian of [false, true]) {
          const got = await effective.resolveEffectivePrice(pool, { type, itemId, currency: 'EGP', tenantId: TENANT, payMode, promoCode, egyptian });
          assert.deepEqual(got, reference, `${type}:${itemId} ${promoCode} ${payMode} ${egyptian}`);
          assert.equal('egyptian' in got, false);
        }
      }
    }
  }
  for (const currency of ['SAR', 'USD']) {
    const got = await effective.resolveEffectivePrice(pool, { type: 'course', itemId: 'c-egy-1', currency, tenantId: TENANT, egyptian: true });
    assert.equal(got.base, currency === 'SAR' ? 300 : 80);
  }
});

test('OFF: the price list, the public payloads and the quote carry no new key and no new price', { skip }, async () => {
  await setting(null);
  const list = await call(pricing, '/api/public/prices', { method: 'get' });
  assert.deepEqual(Object.keys(list.body).sort(), ['items', 'rates']);
  assert.deepEqual(list.body.items['course:c-egy-1'].EGP, { base: 2800, price: 2800, discount: null });
  const rows = [{ id: 'c-egy-1', price: { EGP: 2800, SAR: 300, USD: 80 } }];
  assert.equal(await publicAgain.applyShownPrices(pool, { tenantId: TENANT, type: 'course', items: rows }), rows, 'the very same array comes back');
  const q = await quote({ nationalId: ID_A });
  assert.deepEqual([q.body.price, q.body.base, 'egyptian' in q.body, 'nationalIdMasked' in q.body], [2800, 2800, false, false]);
});

test('OFF: checkout charges the catalogue price, records no tier and ignores a national ID', { skip }, async () => {
  await setting(null);
  const res = await intent('uid-new', { nationalId: ID_A, shownAmount: 1 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.amount, res.body.basePrice, 'egyptian' in res.body], [cashDue(2800), 2800, false]);
  const [[order]] = await pool.query('SELECT amount, price_tier, list_price, egyptian_discount, discount_basis FROM orders WHERE id=?', [res.body.orderId]);
  assert.deepEqual([Number(order.amount), order.price_tier, order.list_price, order.egyptian_discount, order.discount_basis], [cashDue(2800), null, null, null, null]);
  const [[client]] = await pool.query("SELECT national_id FROM subscribers WHERE id='s-new'");
  assert.equal(client.national_id, null, 'an ID typed while the setting is off is not stored');
});

test('the switch is off unless it is exactly true; the offer is stored off whenever the feature is off', { skip }, async () => {
  for (const raw of [undefined, null, {}, { enabled: 'true' }, { enabled: 1 }, { enabled: false, offerActive: true }]) {
    assert.deepEqual(lib.normalizeSettings(raw), { enabled: false, offerActive: false });
  }
  assert.deepEqual(lib.normalizeSettings({ enabled: true }), { enabled: true, offerActive: false });
  assert.deepEqual(lib.normalizeSettings({ enabled: true, offerActive: true }), { enabled: true, offerActive: true });
});

// ── ON ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('ON: the price list and the public payloads show the non-Egyptian price, only for EGP and only where the item has one', { skip }, async () => {
  await setting({ enabled: true });
  const list = await call(pricing, '/api/public/prices', { method: 'get' });
  assert.deepEqual(list.body.egyptianPricing, { enabled: true });
  assert.deepEqual(list.body.items['course:c-egy-1'].EGP, { base: 3400, price: 3400, discount: null, egyptianTier: true });
  assert.deepEqual([list.body.items['course:c-egy-1'].SAR.price, list.body.items['course:c-egy-1'].USD.price], [300, 80]);
  assert.deepEqual(list.body.items['course:c-egy-2'].EGP, { base: 2000, price: 2000, discount: null }, 'no non-Egyptian price: as today');
  assert.equal(list.body.items['bundle:b-egy-1'].EGP.price, 7000);
  const shown = await publicAgain.applyShownPrices(pool, { tenantId: TENANT, type: 'course', items: [
    { id: 'c-egy-1', price: { EGP: 2800, SAR: 300, USD: 80 } }, { id: 'c-egy-2', price: { EGP: 2000, SAR: 250, USD: 60 } }] });
  assert.deepEqual(shown.map(item => item.price), [{ EGP: 3400, SAR: 300, USD: 80 }, { EGP: 2000, SAR: 250, USD: 60 }]);
});

test('ON: a visitor without an ID is quoted the non-Egyptian price; a valid ID gives the Egyptian price and the saving; the ID is never sent back whole', { skip }, async () => {
  await setting({ enabled: true });
  const plain = await quote({});
  assert.deepEqual([plain.body.price, plain.body.base, plain.body.egyptian], [3400, 3400, { audience: 'foreign', tier: 'ONLINE_EGYPT_FOREIGN', shown: 3400, discount: 0 }]);
  const egy = await quote({ nationalId: '٢٩٠٠١٠١١٢٣٤٥٦٧' });
  assert.deepEqual([egy.body.price, egy.body.base, egy.body.dueNow], [2800, 3400, cashDue(2800)]);
  assert.deepEqual(egy.body.egyptian, { audience: 'egyptian', tier: 'ONLINE_EGYPT', shown: 3400, discount: 600 });
  assert.equal(egy.body.nationalIdMasked, '***********567');
  assert.equal(JSON.stringify(egy.body).includes(ID_A), false);
  const bad = await quote({ nationalId: '123' });
  assert.deepEqual([bad.body.price, bad.body.nationalIdError.code], [3400, 'NATIONAL_ID_INVALID']);
  const instalment = await quote({ nationalId: ID_A, payMode: 'installment' });
  assert.deepEqual([instalment.body.planTotal, instalment.body.dueNow], [enrollment.installmentTotal(2800), cashDue(2800, 'installment')]);
});

test('ON: an item without a non-Egyptian price is charged and shown as today, with no national-ID block', { skip }, async () => {
  await setting({ enabled: true });
  const q = await quote({ itemId: 'c-egy-2', nationalId: ID_A });
  assert.deepEqual([q.body.price, q.body.base, 'egyptian' in q.body, 'nationalIdMasked' in q.body], [2000, 2000, false, false]);
});

test('ON: SAR and USD are untouched for everyone', { skip }, async () => {
  await setting({ enabled: true, offerActive: true });
  for (const [currency, base] of [['SAR', 300], ['USD', 80]]) {
    for (const egyptian of [false, true]) {
      const got = await effective.resolveEffectivePrice(pool, { type: 'course', itemId: 'c-egy-1', currency, tenantId: TENANT, egyptian });
      assert.deepEqual([got.price, got.base, 'egyptian' in got], [base, base, false]);
    }
  }
});

test('ON: a coupon applies to the price the client is charged', { skip }, async () => {
  await setting({ enabled: true });
  const foreign = await quote({ promoCode: 'TEN' });
  assert.deepEqual([foreign.body.price, foreign.body.discount.code], [3060, 'TEN']);
  const egy = await quote({ promoCode: 'TEN', nationalId: ID_A });
  assert.deepEqual([egy.body.price, egy.body.base], [2520, 3400]);
});

test('ON checkout: no ID is the non-Egyptian price; the order records the tier and no discount', { skip }, async () => {
  await setting({ enabled: true });
  const res = await intent('uid-other', {});
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.amount, res.body.basePrice], [cashDue(3400), 3400]);
  const [[order]] = await pool.query('SELECT amount, price_tier, list_price, egyptian_discount, discount_basis FROM orders WHERE id=?', [res.body.orderId]);
  assert.deepEqual([Number(order.amount), order.price_tier, Number(order.list_price), order.egyptian_discount, order.discount_basis],
    [cashDue(3400), 'ONLINE_EGYPT_FOREIGN', 3400, null, null]);
});

test('ON checkout: a valid ID is the Egyptian price, stored on the client, recorded on the order; the Paymob charge is the order amount; the same order is re-priced when the ID goes', { skip }, async () => {
  await setting({ enabled: true });
  const res = await intent('uid-new', { nationalId: ID_A, shownAmount: cashDue(2800) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.amount, res.body.basePrice, res.body.egyptian.discount, res.body.egyptian.nationalIdMasked], [cashDue(2800), 3400, 600, '***********567']);
  assert.equal(JSON.stringify(res.body).includes(ID_A), false);
  const [[order]] = await pool.query('SELECT amount, price_tier, list_price, egyptian_discount, discount_basis FROM orders WHERE id=?', [res.body.orderId]);
  assert.deepEqual([Number(order.amount), order.price_tier, Number(order.list_price), Number(order.egyptian_discount), order.discount_basis],
    [cashDue(2800), 'ONLINE_EGYPT', 3400, 600, 'national_id']);
  const [[client]] = await pool.query("SELECT national_id, nationality FROM subscribers WHERE id='s-new'");
  assert.deepEqual([client.national_id, client.nationality], [ID_A, 'EGYPTIAN']);
  const { paymobCharge } = require('../../lib/paymobGateway');
  assert.deepEqual(await paymobCharge(res.body.orderId, TENANT, { amount: order.amount, currency: 'EGP' }), { amount: cashDue(2800), currency: 'EGP' });
  // His record now holds the ID: the next checkout needs none, and the same pending order is re-priced by the same function.
  const again = await intent('uid-new', { shownAmount: cashDue(2800) });
  assert.deepEqual([again.statusCode, again.body.orderId, again.body.amount], [200, res.body.orderId, cashDue(2800)]);
});

test('ON checkout: an instalment plan totals the Egyptian price', { skip }, async () => {
  await setting({ enabled: true });
  const res = await intent('uid-stored', { payMode: 'installment' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.amount, res.body.planTotal], [cashDue(2800, 'installment'), enrollment.installmentTotal(2800)]);
  const [[order]] = await pool.query('SELECT notes FROM orders WHERE id=?', [res.body.orderId]);
  assert.equal(JSON.parse(order.notes).planTotal, enrollment.installmentTotal(2800));
});

test('ON checkout: a client whose record holds a valid ID, or says EGYPTIAN, gets the Egyptian price without being asked', { skip }, async () => {
  await setting({ enabled: true });
  const stored = await intent('uid-stored', {});
  assert.equal(stored.body.amount, cashDue(2800));
  const record = await intent('uid-record', {});
  assert.equal(record.body.amount, cashDue(2800));
  const [[order]] = await pool.query('SELECT discount_basis FROM orders WHERE id=?', [record.body.orderId]);
  assert.equal(order.discount_basis, 'record');
});

test('ON checkout: a client recorded as a non-Egyptian resident is priced at the foreign tier and a typed ID is ignored', { skip }, async () => {
  await setting({ enabled: true });
  const res = await intent('uid-foreign', { nationalId: ID_A });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.amount, cashDue(3400));
});

test('ON checkout: the same ID on a second account is refused with the institute message and nothing is created or stored', { skip }, async () => {
  await setting({ enabled: true });
  const before = (await pool.query('SELECT COUNT(*) AS n FROM orders WHERE tenant_id=?', [TENANT]))[0][0].n;
  const res = await intent('uid-other', { nationalId: ID_A });
  assert.deepEqual([res.statusCode, res.body.code, res.body.error], [409, 'NATIONAL_ID_TAKEN', 'الرقم القومي ده متسجل على حساب تاني — كلّم المعهد']);
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM orders WHERE tenant_id=?', [TENANT]))[0][0].n, before);
  const [[other]] = await pool.query("SELECT national_id FROM subscribers WHERE id='s-other'");
  assert.equal(other.national_id, null);
  const mismatch = await intent('uid-stored', { nationalId: ID_A });
  assert.equal(mismatch.body.code, 'NATIONAL_ID_MISMATCH');
  const bad = await intent('uid-other', { nationalId: '123' });
  assert.deepEqual([bad.statusCode, bad.body.code], [400, 'NATIONAL_ID_INVALID']);
});

test('ON checkout: a stale shown price is answered with PRICE_CHANGED and the real one', { skip }, async () => {
  await setting({ enabled: true });
  const stale = await intent('uid-stored', { shownAmount: cashDue(3400) });
  assert.deepEqual([stale.statusCode, stale.body.code, stale.body.price], [409, 'PRICE_CHANGED', cashDue(2800)]);
  const fresh = await intent('uid-stored', { shownAmount: cashDue(2800) });
  assert.equal(fresh.statusCode, 200);
});

test('the offer: tier discount prices are used only while it is on — 3400→2800 for non-Egyptians, 2800→2300 for Egyptians', { skip }, async () => {
  await setting({ enabled: true });
  assert.equal((await quote({})).body.price, 3400);
  await setting({ enabled: true, offerActive: true });
  const foreign = await quote({});
  assert.deepEqual([foreign.body.base, foreign.body.price, foreign.body.discount.source], [3400, 2800, 'tier_offer']);
  const egy = await quote({ nationalId: ID_A });
  assert.deepEqual([egy.body.base, egy.body.price, egy.body.egyptian.discount], [3400, 2300, 600]);
  const list = await call(pricing, '/api/public/prices', { method: 'get' });
  assert.deepEqual([list.body.items['course:c-egy-1'].EGP.base, list.body.items['course:c-egy-1'].EGP.price], [3400, 2800]);
  const res = await intent('uid-record', {});
  assert.equal(res.body.amount, cashDue(2300));
  await setting({ enabled: true, offerActive: false });
  assert.equal((await quote({})).body.price, 3400);
});

test('the owner list flags the items that have no non-Egyptian price', { skip }, async () => {
  const rows = await lib.listForOwner(pool, TENANT);
  const by = id => rows.find(row => row.id === id);
  assert.deepEqual([by('c-egy-1').egyptian, by('c-egy-1').foreign, by('c-egy-1').egyptianOffer, by('c-egy-1').foreignOffer, by('c-egy-1').unpriced], [2800, 3400, 2300, 2800, false]);
  assert.deepEqual([by('c-egy-2').foreign, by('c-egy-2').unpriced], [null, true]);
});

test('the settings route stores the switch, keeps the offer inside it, and refuses a non-boolean', { skip }, async () => {
  const put = body => call(adminRoute, '/api/admin/egyptian-pricing', { method: 'put', body, user: { uid: 'owner' } });
  assert.equal((await put({ enabled: 'yes' })).statusCode, 400);
  assert.deepEqual((await put({ enabled: true, offerActive: true })).body.settings, { enabled: true, offerActive: true });
  assert.deepEqual((await put({ enabled: false })).body.settings, { enabled: false, offerActive: false });
  assert.deepEqual((await put({ enabled: true })).body.settings, { enabled: true, offerActive: false });
  const got = await call(adminRoute, '/api/admin/egyptian-pricing', { method: 'get' });
  assert.equal(got.body.items.length, 3);
});

test('the public quote never says whether an ID is already held by a client; the booking does', { skip }, async () => {
  await setting({ enabled: true });
  const q = await quote({ nationalId: ID_A });
  assert.deepEqual([q.body.price, 'nationalIdError' in q.body], [2800, false]);
  const booked = await intent('uid-other', { nationalId: ID_A });
  assert.equal(booked.body.code, 'NATIONAL_ID_TAKEN');
});
