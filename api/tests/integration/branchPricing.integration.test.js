'use strict';
/**
 * A booking at the desk is priced by the course's branch tier, not by a typed
 * figure; it takes the client's real name; and it pays the course's booking
 * bonuses once. Against a real MariaDB; runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-branchprice-it';
let pool; let router; let tiers;

async function book(body) {
  const layer = router.stack.find(item => item.route?.path === '/api/admin/subscriber-payments' && item.route.methods.post);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  await layer.route.stack.at(-1).handle({
    params: {}, body, query: {}, headers: {}, tenantId: TENANT,
    user: { uid: 'u', email: 'desk@example.test' }, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}

const CLIENT = { nameAr: 'أحمد محمد عبد الله', nameEn: 'Ahmed Mohamed Abdallah', nationalId: '29001011234567', phoneConfirmed: true };
const payment = overrides => ({
  amount: 1000, currency: 'EGP', paymentType: 'COURSE', courseId: 'co-bp-1', paymentMethod: 'كاش',
  isInstallment: true, branch: 'DAQQI', status: 'paid', ...overrides,
});

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [TENANT]).catch(() => {});
  for (const table of ['journal_entries', 'payment_audit_log', 'financial_audit_log', 'crm_commissions', 'instructor_fees',
    'entitlement_events', 'enrollments', 'payments', 'catalog_prices', 'subscribers', 'courses', 'instructor_rates', 'staff', 'outbox']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  tiers = require('../../lib/priceTiers');
  await clean();
  router = require('../../routes/subscriber-payments');
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, commission_rate) VALUES
       ('st-bp-rep', ?, 'مندوب', 'rep-bp@example.test', '1015000001', 'SALES', 1, '2025-01-01', 0),
       ('st-bp-cs', ?, 'تحصيل', 'cs-bp@example.test', '1015000002', 'COLLECTION', 1, '2025-01-01', 0),
       ('st-bp-dr', ?, 'محاضرة', 'dr-bp@example.test', '1015000003', 'INSTRUCTOR', 1, '2025-01-01', 0)`, [TENANT, TENANT, TENANT]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, instructor_id, price_egp, price_sar)
     VALUES ('co-bp-1', ?, 'كورس العلاج المعرفي', '', '', '', '', 'GENERAL', 'RECORDED', 'st-bp-dr', 3000, 450)`, [TENANT]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id, assigned_sales_id, assigned_cs_id)
     VALUES ('sub-bp-1', ?, 'Ahmed fb', '1015000004', 'DAQQI', 'branch-daqqi', 'st-bp-rep', 'st-bp-cs'),
            ('sub-bp-2', ?, 'عميل تاني', '1015000005', 'DAQQI', 'branch-daqqi', NULL, NULL)`, [TENANT, TENANT]);
  const conn = await pool.getConnection();
  try {
    await tiers.saveItemPricing(conn, {
      tenantId: TENANT, type: 'course', itemId: 'co-bp-1',
      tiers: { DAQQI: { price: 2500, discountPrice: 2200 } },
      bonuses: { sales: { type: 'fixed', value: 200 }, service: { type: 'percent', value: 5 }, instructor: { type: 'fixed', value: 100 } },
    });
  } finally { conn.release(); }
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('each branch has its own price; an unpriced Egyptian tier reads the online price', { skip }, async () => {
  const pricing = await tiers.getItemPricing(pool, { tenantId: TENANT, type: 'course', itemId: 'co-bp-1' });
  const byKey = Object.fromEntries(pricing.tiers.map(t => [t.key, t]));
  assert.deepEqual([byKey.DAQQI.price, byKey.DAQQI.discountPrice, byKey.DAQQI.inherited], [2500, 2200, false]);
  assert.deepEqual([byKey.TAGAMOA.price, byKey.TAGAMOA.inherited], [3000, true]);
  assert.deepEqual([byKey.ONLINE_SAUDI.price, byKey.ONLINE_SAUDI.currency], [450, 'SAR']);
  assert.equal(byKey.ONLINE_ABROAD.price, null, 'no dollar price was ever set');
});

test('a discount at or above the price is refused', { skip }, async () => {
  const conn = await pool.getConnection();
  try {
    await assert.rejects(tiers.saveItemPricing(conn, {
      tenantId: TENANT, type: 'course', itemId: 'co-bp-1', tiers: { TAGAMOA: { price: 2000, discountPrice: 2000 } },
    }), /أقل من السعر/);
  } finally { conn.release(); }
});

test('the booking is charged the Dokki discount price, and the real name is kept', { skip }, async () => {
  const res = await book({ subscriber_id: 'sub-bp-1', client: CLIENT, payment: payment({ priceTier: 'DAQQI', useDiscount: true }) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [[row]] = await pool.query("SELECT course_expected FROM payments WHERE tenant_id=? AND subscriber_id='sub-bp-1'", [TENANT]);
  assert.equal(Number(row.course_expected), 2200);
  const [[sub]] = await pool.query("SELECT name, name_ar, name_en, national_id FROM subscribers WHERE id='sub-bp-1' AND tenant_id=?", [TENANT]);
  assert.deepEqual([sub.name, sub.name_ar, sub.name_en, sub.national_id],
    ['أحمد محمد عبد الله', 'أحمد محمد عبد الله', 'Ahmed Mohamed Abdallah', '29001011234567']);
});

test('the booking bonuses are paid once: rep 200, collection 5% of 2,200, lecturer 100', { skip }, async () => {
  const second = await book({ subscriber_id: 'sub-bp-1', payment: payment({ amount: 1200 }) });
  assert.equal(second.statusCode, 200, JSON.stringify(second.body));
  const [bonuses] = await pool.query(
    "SELECT staff_id, commission_amount FROM crm_commissions WHERE tenant_id=? AND payment_id LIKE 'booking:%' ORDER BY staff_id", [TENANT]);
  assert.deepEqual(bonuses.map(b => [b.staff_id, Number(b.commission_amount)]), [['st-bp-cs', 110], ['st-bp-rep', 200]]);
  const [fees] = await pool.query("SELECT staff_id, total_amount FROM instructor_fees WHERE tenant_id=? AND source_key LIKE 'booking:%'", [TENANT]);
  assert.deepEqual(fees.map(f => [f.staff_id, Number(f.total_amount)]), [['st-bp-dr', 100]]);
});

test('a typed price that is not the catalogue price is refused', { skip }, async () => {
  const res = await book({ subscriber_id: 'sub-bp-2', client: { ...CLIENT, nationalId: '' }, payment: payment({ priceTier: 'DAQQI', courseExpected: 1500 }) });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'PRICE_MISMATCH');
});

test('no discount where the course has none, and no booking without the Arabic triple name', { skip }, async () => {
  const noDiscount = await book({ subscriber_id: 'sub-bp-2', client: { ...CLIENT, nationalId: '' }, payment: payment({ priceTier: 'TAGAMOA', branch: undefined, useDiscount: true }) });
  assert.equal(noDiscount.body?.code, 'TIER_NOT_PRICED', JSON.stringify([noDiscount.statusCode, noDiscount.body]));
  const shortName = await book({ subscriber_id: 'sub-bp-2', client: { ...CLIENT, nameAr: 'أحمد محمد', nationalId: '' }, payment: payment({ priceTier: 'DAQQI' }) });
  assert.equal(shortName.body?.code, 'NAME_AR_REQUIRED');
  const sameId = await book({ subscriber_id: 'sub-bp-2', client: CLIENT, payment: payment({ priceTier: 'DAQQI' }) });
  assert.equal(sameId.statusCode, 409, 'one national ID, two clients');
});

test('a percentage button takes that much off the branch list price; any other figure is refused', { skip }, async () => {
  const client = { ...CLIENT, nameAr: 'منى سامي حسن', nationalId: '' };
  const odd = await book({ subscriber_id: 'sub-bp-2', client, payment: payment({ priceTier: 'DAQQI', discountPct: 12 }) });
  assert.equal(odd.body?.code, 'TIER_NOT_PRICED', JSON.stringify([odd.statusCode, odd.body]));
  const both = await book({ subscriber_id: 'sub-bp-2', client, payment: payment({ priceTier: 'DAQQI', discountPct: 10, useDiscount: true }) });
  assert.equal(both.body?.code, 'TIER_NOT_PRICED', 'the course discount and a percentage do not stack');
  const wrong = await book({ subscriber_id: 'sub-bp-2', client, payment: payment({ priceTier: 'DAQQI', discountPct: 20, courseExpected: 2500 }) });
  assert.equal(wrong.body?.code, 'PRICE_MISMATCH');
  const ok = await book({ subscriber_id: 'sub-bp-2', client, payment: payment({ priceTier: 'DAQQI', discountPct: 20, courseExpected: 2000 }) });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const [[row]] = await pool.query("SELECT course_expected FROM payments WHERE tenant_id=? AND subscriber_id='sub-bp-2' ORDER BY created_at DESC LIMIT 1", [TENANT]);
  assert.equal(Number(row.course_expected), 2000, '20% off 2,500');
});

// «سعر كورس جديد اسمه عميل الدقي غير المصري … بنفس اسعار الاونلاين غير مصري» (10 Oct 2026).
test('«عميل الدقي غير المصري» reads the online foreign price and discount until given its own, and books at Dokki', { skip }, async () => {
  const conn = await pool.getConnection();
  try {
    await tiers.saveItemPricing(conn, {
      tenantId: TENANT, type: 'course', itemId: 'co-bp-1',
      tiers: { ONLINE_EGYPT_FOREIGN: { price: 3600, discountPrice: 3300 } },
    });
  } finally { conn.release(); }
  const read = async () => Object.fromEntries((await tiers.getItemPricing(pool, { tenantId: TENANT, type: 'course', itemId: 'co-bp-1' })).tiers.map(t => [t.key, t]));
  let byKey = await read();
  assert.deepEqual(
    [byKey.DAQQI_FOREIGN.price, byKey.DAQQI_FOREIGN.discountPrice, byKey.DAQQI_FOREIGN.inheritedFrom, byKey.DAQQI_FOREIGN.branch],
    [3600, 3300, 'ONLINE_EGYPT_FOREIGN', 'DAQQI']);

  const client = { ...CLIENT, nameAr: 'جون مايكل سميث', nameEn: 'John Michael Smith', nationalId: 'P1234567' };
  const res = await book({ subscriber_id: 'sub-bp-2', client, payment: payment({ priceTier: 'DAQQI_FOREIGN', useDiscount: true, courseExpected: 3300, amount: 1300 }) });
  assert.equal(res.statusCode, 200, JSON.stringify([res.statusCode, res.body]));
  const [[row]] = await pool.query("SELECT course_expected, branch FROM payments WHERE tenant_id=? AND subscriber_id='sub-bp-2' ORDER BY created_at DESC LIMIT 1", [TENANT]);
  assert.deepEqual([Number(row.course_expected), row.branch], [3300, 'DAQQI']);

  const conn2 = await pool.getConnection();
  try {
    await tiers.saveItemPricing(conn2, { tenantId: TENANT, type: 'course', itemId: 'co-bp-1', tiers: { DAQQI_FOREIGN: { price: 3400, discountPrice: null } } });
  } finally { conn2.release(); }
  byKey = await read();
  assert.deepEqual([byKey.DAQQI_FOREIGN.price, byKey.DAQQI_FOREIGN.inherited, byKey.DAQQI_FOREIGN.discountPrice], [3400, false, null], 'its own price, and no discount it was not given');
});
