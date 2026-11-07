'use strict';
/**
 * GET /api/admin/clients/:id/money — the one answer to «what does this client owe and have paid», over HTTP on the real app with signed-in staff, against a real
 * MariaDB (7 Nov 2026). It carries every item the client holds with the catalogue price, the agreed price and where it came from, paid, paid before the system and
 * what is left; certificates and extras apart from the courses; the totals added in piastres. A price edited anywhere is in the next answer — nothing is cached —
 * and the change is in the client's history with who made it. Each role sees what its scope allows: the managers and the accounts every client, sales and customer
 * service every client, sales and collection the ones assigned to them, and nobody another institute's. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const { startApp, signInStaff, ensureTenant } = require('./support/http');

const T = 'tenant-cmoney-it';
const OTHER = 'tenant-cmoney-other-it';
const COURSE = 'co-cm-1';
let pool; let app; const who = {};

const money = (session, id = 'sub-cm-1') => app.call('GET', `/api/admin/clients/${id}/money`, { session });
let noteNo = 0;
const record = (session, payment) => app.call('POST', '/api/admin/subscriber-payments', {
  session, body: { subscriber_id: 'sub-cm-1', payment: { amount: 1000, currency: 'EGP', paymentType: 'COURSE', courseId: COURSE, paymentMethod: 'كاش', isInstallment: true, status: 'paid', note: `n${++noteNo}`, ...payment } },
});

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  for (const tenant of [T, OTHER]) await ensureTenant(pool, tenant);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES (?, ?, 'كورس العلاج المعرفي', '', '', '', '', 'GENERAL', 'RECORDED', 3000), ('co-cm-other', ?, 'كورس تاني', '', '', '', '', 'GENERAL', 'RECORDED', 100)`, [COURSE, T, OTHER]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, email, branch, branch_id, is_active, created_at) VALUES
       ('sub-cm-1', ?, 'عميلة أونلاين', '01044400001', 'cm1@example.test', 'ONLINE_EGYPT', 'branch-online-egypt', 1, UTC_TIMESTAMP()),
       ('sub-cm-2', ?, 'عميل غير مسند', '01044400002', 'cm2@example.test', 'ONLINE_EGYPT', 'branch-online-egypt', 1, UTC_TIMESTAMP()),
       ('sub-cm-3', ?, 'عميل التحصيل', '01044400003', 'cm3@example.test', 'ONLINE_EGYPT', 'branch-online-egypt', 1, UTC_TIMESTAMP()),
       ('sub-cm-other', ?, 'عميلة معهد تاني', '01044400009', 'cmother@example.test', 'ONLINE_EGYPT', 'branch-online-egypt', 1, UTC_TIMESTAMP())`, [T, T, T, OTHER]);
  await require('../../lib/tenantSettings').setTenantSetting('content', {
    extra_cert_pricing: JSON.stringify({ AIN_SHAMS: { egyptianEGP: 1000 } }),
    extra_item_pricing: JSON.stringify({ carnets: [{ id: 'k1', label: 'كارنيه المعهد', priceEGP: 250 }], books: [] }),
  }, { tenantId: T });
  app = await startApp(pool);
  who.admin = await signInStaff(pool, app, { tenantId: T, id: 'st-cm-admin', role: 'ADMIN', name: 'المدير' });
  who.accountant = await signInStaff(pool, app, { tenantId: T, id: 'st-cm-acc', role: 'ACCOUNTANT', name: 'المحاسب' });
  who.collection = await signInStaff(pool, app, { tenantId: T, id: 'st-cm-col', role: 'COLLECTION', name: 'التحصيل' });
  who.sales = await signInStaff(pool, app, { tenantId: T, id: 'st-cm-sal', role: 'SALES', name: 'المندوب' });
  who.support = await signInStaff(pool, app, { tenantId: T, id: 'st-cm-sup', role: 'SUPPORT', name: 'خدمة العملاء' });
  who.hr = await signInStaff(pool, app, { tenantId: T, id: 'st-cm-hr', role: 'HR', name: 'HR', permissions: ['view_dashboard', 'view_staff'] });
  who.otherAdmin = await signInStaff(pool, app, { tenantId: OTHER, id: 'st-cm-other', role: 'ADMIN', name: 'مدير تاني' });
  await pool.query("UPDATE subscribers SET assigned_sales_id='st-cm-sal', assigned_cs_id='st-cm-sup' WHERE id='sub-cm-1'");
  await pool.query("UPDATE subscribers SET assigned_cs_id='st-cm-col' WHERE id='sub-cm-3'");
});
after(async () => {
  if (!ENABLED) return;
  if (app) await app.close();
  await pool.end().catch(() => {});
});

test('the course: catalogue, agreed price and its source, paid, remaining — and a price edited on the client page is in the very next answer', { skip }, async () => {
  const booked = await record(who.admin, {});
  assert.equal(booked.status, 200, booked.text);
  let line = (await money(who.admin)).body.items.find(item => item.item === COURSE);
  assert.deepEqual([line.kind, line.catalogue, line.agreed, line.source, line.paid, line.priorPaid, line.remaining, line.currency],
    ['course', 3000, 3000, 'client', 1000, 0, 2000, 'EGP'], 'the first payment fixes the price the client agreed to: the catalogue figure of the day');
  assert.match(line.title, /كورس العلاج/);

  const edited = await app.call('PUT', '/api/admin/subscribers/sub-cm-1/item-money', { session: who.admin, body: { item: COURSE, expected: 2500, priorPaid: 300, confirmNotRecorded: true } });
  assert.equal(edited.status, 200, edited.text);
  const answer = await money(who.admin);
  assert.equal(answer.status, 200);
  line = answer.body.items.find(item => item.item === COURSE);
  assert.deepEqual([line.agreed, line.source, line.paid, line.priorPaid, line.remaining], [2500, 'client', 1000, 300, 1200], 'agreed 2,500 − paid 1,000 − before the system 300');

  const [[log]] = await pool.query("SELECT actor, label FROM activity_logs WHERE tenant_id=? AND entity_id='sub-cm-1' AND action='price_changed' ORDER BY at DESC LIMIT 1", [T]);
  assert.ok(log, 'the change of price is in the client\'s history');
  assert.ok(log.actor && !log.actor.includes('@'), 'who: the name of the person, not an email');
  assert.match(log.label, /3,000 ← 2,500/, 'old price ← new price');
});

test('a certificate is a line of its own at the price agreed for it; a carnet is an extra; the totals are added in piastres', { skip }, async () => {
  await pool.query(
    `INSERT INTO certificate_requests (id, tenant_id, subscriber_id, type, nationality, status, price, currency, paid_amount, course_id)
     VALUES ('cr-cm-1', ?, 'sub-cm-1', 'AIN_SHAMS', 'EGYPTIAN', 'PRICED', 1000, 'EGP', 0.10, ?)`, [T, COURSE]);
  const edited = await app.call('PUT', '/api/admin/certificate-requests/cr-cm-1/details', { session: who.admin, body: { price: 900.2 } });
  assert.equal(edited.status, 200, edited.text);
  const carnet = await record(who.admin, { paymentType: 'CARNEH', itemTitle: 'كارنيه المعهد', amount: 100, isInstallment: false });
  assert.equal(carnet.status, 200, carnet.text);

  const answer = (await money(who.admin)).body;
  assert.ok(!answer.items.some(item => String(item.item).startsWith('cert:')), 'a certificate is never a line of the courses');
  const cert = answer.certificates.find(row => row.id === 'cr-cm-1');
  assert.deepEqual([cert.agreed, cert.list, cert.source, cert.paid, cert.remaining], [900.2, 1000, 'client', 0.1, 900.1], '900.20 − 0.10 is 900.10, not a float sum');
  const extra = answer.extras.find(row => row.title === 'كارنيه المعهد');
  assert.deepEqual([extra.kind, extra.agreed, extra.source, extra.paid, extra.remaining], ['carneh', 250, 'catalogue', 100, 150]);
  // 2,500 + 900.20 + 250 agreed; paid 1,000 + 300 before the system + 0.10 + 100; left 1,200 + 900.10 + 150.
  assert.deepEqual(answer.totals.EGP, { agreed: 3650.2, paid: 1400.1, remaining: 2250.1 });
});

test('each role sees what its scope allows: the managers and the accounts every client, sales and collection their own, support all of them, nobody another institute\'s', { skip }, async () => {
  const expected = { admin: ['sub-cm-1', 200, 200], accountant: ['sub-cm-1', 200, 200], collection: ['sub-cm-3', 200, 403], sales: ['sub-cm-1', 200, 403], support: ['sub-cm-1', 200, 200], hr: ['sub-cm-1', 403, 403] };
  for (const [role, [own, assigned, other]] of Object.entries(expected)) {
    const mine = await money(who[role], own);
    const notMine = await money(who[role], 'sub-cm-2');
    assert.equal(mine.status, assigned, `${role} on an assigned client: ${mine.text}`);
    assert.equal(notMine.status, other, `${role} on a client who is not theirs: ${notMine.text}`);
  }
  const crossTenant = await money(who.admin, 'sub-cm-other');
  assert.equal(crossTenant.status, 404, 'another institute\'s client does not exist for this one');
  const alone = await money(who.otherAdmin, 'sub-cm-1');
  assert.equal(alone.status, 404);
  const anonymous = await app.call('GET', '/api/admin/clients/sub-cm-1/money', {});
  assert.ok([401, 403].includes(anonymous.status), 'no sign-in, no money');
});

test('a client the server does not know is a 404, and the answer is never cached', { skip }, async () => {
  assert.equal((await money(who.admin, 'no-such-client')).status, 404);
  const res = await fetch(`${app.base}/api/admin/clients/sub-cm-1/money`, { headers: { Cookie: who.admin.cookie, 'X-Tenant-Id': T } });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
