'use strict';
/**
 * 2 Nov 2026, against a real database:
 *  - «محتاج اقدر اعدل سعر شهادة او اغيرها اخليها لغير المصرين في مصر او سعودي لو كان دخلها غلط»: a certificate request moved to another group is repriced
 *    from the price list of that group (and moves to its currency while nothing is paid); the price of a PAID one can be corrected, and its
 *    payment's expected price follows, while what was paid is left to the payment;
 *  - the sign-in sheet reads a login as the client the institute already has (by the number in any spelling or the email), says which branch,
 *    «محتمل» for a lead, and flags a client who still has a lead of the same contact.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-default';
const MARK = 'cgl2nov';
let pool; let router;

async function putDetails(id, body) {
  const layer = router.stack.find(item => item.route?.path === '/api/admin/certificate-requests/:id/details' && item.route.methods.put);
  assert.ok(layer);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await layer.route.stack.at(-1).handle({ params: { id }, body, tenantId: TENANT, isSuperAdmin: true, staffRecord: { id: 'st', role: 'admin', name: 'مدير' }, user: { uid: 'u', email: 'a@b.c' }, ip: '127.0.0.1', headers: {}, get: () => undefined }, res);
  return res;
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  const { setTenantSetting } = require('../../lib/tenantSettings');
  router = require('../../routes/certificates');
  await setTenantSetting('content', {
    extra_cert_pricing: JSON.stringify({ institute: { egyptianEGP: 500, residentEGP: 900, residentSAR: 200, foreignUSD: 60 } }),
  }, { tenantId: TENANT });
  await pool.query(`DELETE FROM certificate_requests WHERE id LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM payments WHERE id LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM subscribers WHERE id LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM leads WHERE id LIKE '${MARK}%'`);
  const sub = (id, code, name, phone, email, branch) => pool.query(
    "INSERT INTO subscribers (id, tenant_id, client_code, name, phone, email, is_active, branch, branch_id, source) VALUES (?,?,?,?,?,?,1,?,?,'test')",
    [id, TENANT, code, name, phone, email, branch, `branch-${branch.toLowerCase().replace('_', '-')}`]);
  await sub(`${MARK}-s1`, 'T-CGL-1', 'عميل سعودي', '01099900001', null, 'ONLINE_SAUDI');
  await sub(`${MARK}-s2`, 'T-CGL-2', 'عميلة الدقي', null, `${MARK}-d@example.test`, 'DAQQI');
  const lead = (id, code, name, phone, email) => pool.query(
    "INSERT INTO leads (id, tenant_id, client_code, name, phone, email, source, status, hidden) VALUES (?,?,?,?,?,?,'test','new',0)",
    [id, TENANT, code, name, phone, email]);
  await lead(`${MARK}-l1`, 'T-CGL-L1', 'نفس العميل السعودي كليد', '1099900001', null);
  await lead(`${MARK}-l2`, 'T-CGL-L2', 'ليد بس', '1099900002', null);
  await pool.query("INSERT INTO certificate_requests (id, subscriber_id, type, nationality, status, price, paid_amount, currency, tenant_id) VALUES (?,?,'INSTITUTE','EGYPTIAN','PRICED',500,0,'EGP',?)", [`${MARK}-c1`, `${MARK}-s1`, TENANT]);
  await pool.query("INSERT INTO certificate_requests (id, subscriber_id, type, nationality, status, price, paid_amount, currency, tenant_id) VALUES (?,?,'INSTITUTE','EGYPTIAN','PAID',500,500,'EGP',?)", [`${MARK}-c2`, `${MARK}-s2`, TENANT]);
  await pool.query(
    "INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, status, payment_type, certificate_request_id, course_expected, date) VALUES (?,?,?,500,'EGP','paid','CERTIFICATE',?,500,NOW())",
    [`${MARK}-p2`, TENANT, `${MARK}-s2`, `${MARK}-c2`]);
});
after(async () => {
  if (!ENABLED) return;
  await pool.query(`DELETE FROM enrollments WHERE id LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM courses WHERE id LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM bundles WHERE id LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM certificate_requests WHERE id LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM payments WHERE id LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM subscribers WHERE id LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM leads WHERE id LIKE '${MARK}%'`);
  await pool.end();
});

test('an unpaid certificate moved to the Saudi resident group is repriced from that list, in riyals', { skip }, async () => {
  const res = await putDetails(`${MARK}-c1`, { nationality: 'SAUDI_RESIDENT', price: 500 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(res.body.changed.includes('الجنسية') && res.body.changed.includes('السعر') && res.body.changed.includes('العملة'), JSON.stringify(res.body.changed));
  const [[row]] = await pool.query('SELECT nationality, price, currency FROM certificate_requests WHERE id=?', [`${MARK}-c1`]);
  assert.equal(row.nationality, 'SAUDI_RESIDENT');
  assert.equal(Number(row.price), 200);
  assert.equal(row.currency, 'SAR');
});

test('a PAID certificate moved to the non-Egyptian resident group is repriced in its own currency, and its payment\'s expected price follows', { skip }, async () => {
  const res = await putDetails(`${MARK}-c2`, { nationality: 'NON_EGYPTIAN_EGYPT', price: 500 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [[row]] = await pool.query('SELECT nationality, price, currency, paid_amount FROM certificate_requests WHERE id=?', [`${MARK}-c2`]);
  assert.equal(row.nationality, 'NON_EGYPTIAN_EGYPT');
  assert.equal(Number(row.price), 900);
  assert.equal(row.currency, 'EGP');
  assert.equal(Number(row.paid_amount), 500, 'what was paid is left to the payment');
  const [[payment]] = await pool.query('SELECT amount, course_expected FROM payments WHERE id=?', [`${MARK}-p2`]);
  assert.equal(Number(payment.course_expected), 900);
  assert.equal(Number(payment.amount), 500);
});

test('the price of a paid certificate can be corrected by hand; what was paid cannot be edited from the certificate', { skip }, async () => {
  const price = await putDetails(`${MARK}-c2`, { price: 800 });
  assert.equal(price.statusCode, 200, JSON.stringify(price.body));
  const [[payment]] = await pool.query('SELECT course_expected FROM payments WHERE id=?', [`${MARK}-p2`]);
  assert.equal(Number(payment.course_expected), 800);
  const paid = await putDetails(`${MARK}-c2`, { paidAmount: 100 });
  assert.equal(paid.statusCode, 409);
});

test('a login is read as the client the institute already has, with the branch, and a leftover lead of the same number is flagged', { skip }, async () => {
  const { clientKinds } = require('../../lib/loginClientKind');
  const kinds = await clientKinds(pool, {
    tenantId: TENANT,
    people: [
      { key: 'a', phone: '1099900001' },              // an account holding the identity form; the client holds 01…
      { key: 'b', phone: '+201099900002' },            // a lead only
      { key: 'c', phone: '01000000000', email: `${MARK}-d@example.test` }, // a client by the email
      { key: 'd', phone: '01111111111' },              // nobody
    ],
  });
  assert.equal(kinds.get('a').kind, 'client');
  assert.equal(kinds.get('a').branch_label, 'أونلاين سعودي');
  assert.equal(kinds.get('a').client_code, 'T-CGL-1');
  assert.equal(kinds.get('a').also_lead, true, 'a lead of the same number is still open beside the client');
  assert.equal(kinds.get('b').kind, 'lead');
  assert.equal(kinds.get('b').branch_label, 'محتمل');
  assert.equal(kinds.get('c').kind, 'client');
  assert.equal(kinds.get('c').branch_label, 'الدقي');
  assert.equal(kinds.get('d').kind, 'none');
});

test('the debts list counts a track once and leaves a certificate out of the course\'s balance', { skip }, async () => {
  const { loadOutstandingBalances } = require('../../lib/outstandingBalances');
  await pool.query("INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type, is_published) VALUES (?,?,?,?,'','','x','','GENERAL','RECORDED',1)", [`${MARK}-course`, TENANT, `${MARK}-course`, 'كورس']);
  await pool.query("INSERT INTO bundles (id, tenant_id, title, description, is_published) VALUES (?,?,?,?,1)", [`${MARK}-track`, TENANT, 'مسار', '']);
  await pool.query("INSERT INTO subscribers (id, tenant_id, client_code, name, phone, is_active, branch, branch_id, source) VALUES (?,?,?,?,?,1,'ONLINE_EGYPT','branch-online-egypt','test')", [`${MARK}-s3`, TENANT, 'T-CGL-3', 'عميل مسار', '01099900003']);
  await pool.query("INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, bundle_id, enrolled_at, status) VALUES (?,?,?,?,?,NOW(),'active')", [`${MARK}-e3`, TENANT, `${MARK}-s3`, `${MARK}-course`, `${MARK}-track`]);
  const insert = (id, type, amount, expected, extra) => pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, amount, amount_egp, fx_rate_to_egp, currency, status, payment_type, course_expected, date, ${extra.col}) VALUES (?,?,?,?,?,1,'EGP','paid',?,?,NOW(),?)`,
    [id, TENANT, `${MARK}-s3`, amount, amount, type, expected, extra.val]);
  await insert(`${MARK}-p3a`, 'COURSE', 1000, 3000, { col: 'bundle_id', val: `${MARK}-track` });
  await insert(`${MARK}-p3b`, 'COURSE', 500, 1500, { col: 'course_id', val: `${MARK}-course` });   // a booking made as a single course, before the track
  await insert(`${MARK}-p3c`, 'CERTIFICATE', 100, 900, { col: 'course_id', val: `${MARK}-course` });
  const rows = await loadOutstandingBalances(TENANT, [`${MARK}-s3`]);
  const mine = rows.find(row => row.id === `${MARK}-s3`);
  assert.ok(mine, 'the client owes something');
  assert.equal(Number(mine.total_expected), 3000, 'the track\'s price, once');
  assert.equal(Number(mine.total_paid), 1500, 'the money against the track and against its course; not the certificate');
  assert.equal(Number(mine.outstanding), 1500);
});

test('a site form filled by a number a client already holds is not filed as a second record', { skip }, async () => {
  const { capturePublicLead } = require('../../lib/publicLead');
  await pool.query("INSERT INTO subscribers (id, tenant_id, client_code, name, phone, is_active, branch, branch_id, source) VALUES (?,?,?,?,?,1,'ONLINE_EGYPT','branch-online-egypt','test')", [`${MARK}-s4`, TENANT, 'T-CGL-4', 'عميل قديم', '01099900004']);
  const result = await capturePublicLead({ tenantId: TENANT, name: 'نفس العميل', phone: '1099900004', notes: 'عايز أسأل عن كورس', source: 'contact', branch: 'ONLINE_EGYPT' });
  assert.equal(result.existing, true);
  assert.equal(result.clientId, `${MARK}-s4`);
  const [leads] = await pool.query("SELECT id FROM leads WHERE tenant_id=? AND phone_digits IN ('1099900004','01099900004')", [TENANT]);
  assert.equal(leads.length, 0, 'no lead was made for a client');
  const [[event]] = await pool.query("SELECT label FROM activity_logs WHERE entity='subscriber' AND entity_id=? AND action='public_form_again'", [`${MARK}-s4`]);
  assert.match(event.label, /عايز أسأل عن كورس/);
  await pool.query("DELETE FROM activity_logs WHERE entity='subscriber' AND entity_id=?", [`${MARK}-s4`]);
});
