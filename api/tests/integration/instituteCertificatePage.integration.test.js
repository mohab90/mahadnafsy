'use strict';
/**
 * The institute certificate on a real MariaDB (14 Oct 2026): the page the client sees (the
 * whole design), the desk's copy for the pre-printed paper (?mode=form), the desk's list,
 * and the edit that changes one certificate only.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-certpage-it';
const CODE = 'CERT-PAGE-IT-0001';
let pool; let publicRouter; let deskRouter;

const run = async (router, method, route, { params = {}, query = {}, body = {} } = {}) => {
  const layer = router.stack.find(item => item.route?.path === route && item.route.methods[method]);
  assert.ok(layer, `${method} ${route} exists`);
  const res = {
    statusCode: 200, body: null, headers: {}, sent: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.sent = payload; return this; },
    type() { return this; }, set() { return this; }, setHeader(key, value) { this.headers[key] = value; },
  };
  const req = { params, query, body, headers: {}, tenantId: TENANT, user: { uid: 'u', email: 'desk@example.test' },
    staffRecord: { id: 'st-cp', name: 'التحصيل', role: 'collection' }, isSuperAdmin: false, ip: '1', get: () => undefined };
  const handlers = layer.route.stack.map(entry => entry.handle);
  // The guards are covered elsewhere; this runs the handler itself.
  await handlers[handlers.length - 1](req, res, () => {});
  return res;
};

async function clean() {
  for (const table of ['client_history', 'course_completions', 'subscribers', 'courses', 'users']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  publicRouter = require('../../routes/public');
  deskRouter = require('../../routes/instituteCertificates');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]);
  await pool.query("INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u-cp-1', ?, 'trainer-cp@example.test', 'x', 'Dr Sara Adel', 'instructor')", [TENANT]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, title_en, title_ar, description, short_description, instructor, instructor_id, thumbnail, category, type,
                          price_egp, price_sar, price_usd, orig_price_egp, orig_price_sar, orig_price_usd, rating, students, duration, level, hours, sort_order)
     VALUES ('c-cp-1', ?, 'دبلومة', 'Clinical Psychology Diploma', 'دبلومة', 'd', 's', 'x', 'u-cp-1', 't', 'GENERAL', 'RECORDED', 0, 0, 0, 0, 0, 0, 0, 0, '', '', 40, 0)`, [TENANT]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, name_en, phone, client_code) VALUES ('s-cp-1', ?, 'منى أحمد', 'mona ahmed ali', '1018000777', 'C-CP-1')", [TENANT]);
  await pool.query("INSERT INTO course_completions (id, tenant_id, subscriber_id, course_id, certificate_code, status) VALUES ('cc-cp-1', ?, 's-cp-1', 'c-cp-1', ?, 'active')", [TENANT, CODE]);
});
after(async () => { if (!ENABLED) return; await clean(); await pool.end(); });

const page = query => run(publicRouter, 'get', '/api/completions/:code/certificate', { params: { code: CODE }, query: { staff: '1', ...query } });

test("the client's page is the whole design with the name, the course, the duration and the trainer", { skip }, async () => {
  const res = await page({});
  assert.equal(res.statusCode, 200, String(res.sent).slice(0, 300));
  const html = String(res.sent);
  assert.match(html, />MONA AHMED ALI<\/div>/);
  assert.match(html, />Clinical Psychology Diploma<\/div>/);
  assert.match(html, />Duration: 40 Hours<\/div>/);
  assert.match(html, />Dr Sara Adel<\/div>/, "the course's trainer is on the trainer's line");
  assert.match(html, /certificate-template\.jpg/);
});

test("the desk's copy has the name and the course only, at 17 and 22 cm, and no trainer", { skip }, async () => {
  const html = String((await page({ mode: 'form' })).sent);
  assert.match(html, />MONA AHMED ALI<\/span>/);
  assert.match(html, />Duration: 40 Hours<\/span>/);
  assert.doesNotMatch(html, /Dr Sara Adel/);
  assert.match(html, /top:calc\(17cm - 0\.8cm\)/);
  assert.match(html, /top:calc\(22cm - 0\.7cm\)/);
  assert.match(String((await page({ mode: 'form', nameTop: '16', courseTop: '21' })).sent), /top:calc\(16cm - 0\.8cm\)/);
});

test("the desk's list says what prints, and an edit changes this certificate only", { skip }, async () => {
  const listed = (await run(deskRouter, 'get', '/api/admin/institute-certificates')).body.find(row => row.code === CODE);
  assert.equal(listed.printed.name, 'MONA AHMED ALI');
  assert.equal(listed.printed.duration, '40 Hours');
  assert.equal(listed.printed.trainer, 'Dr Sara Adel');
  assert.deepEqual(listed.missing, []);

  const saved = await run(deskRouter, 'put', '/api/admin/institute-certificates/:id/edit', {
    params: { id: 'cc-cp-1' }, body: { nameEn: 'Mona Ahmed Ali Hassan', courseEn: 'Clinical Psychology Diploma (Advanced)', duration: '6 Months', trainer: 'Dr Hany' } });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  const html = String((await page({})).sent);
  assert.match(html, />MONA AHMED ALI HASSAN<\/div>/);
  assert.match(html, />Clinical Psychology Diploma \(Advanced\)<\/div>/);
  assert.match(html, />Duration: 6 Months<\/div>/);
  assert.match(html, />Dr Hany<\/div>/);
  const [[client]] = await pool.query("SELECT name_en FROM subscribers WHERE id='s-cp-1'");
  assert.equal(client.name_en, 'mona ahmed ali', "the client's file is not rewritten");
  const [[course]] = await pool.query("SELECT title_en FROM courses WHERE id='c-cp-1'");
  assert.equal(course.title_en, 'Clinical Psychology Diploma', 'nor is the course');

  // An emptied field goes back to what the sources say.
  await run(deskRouter, 'put', '/api/admin/institute-certificates/:id/edit', { params: { id: 'cc-cp-1' }, body: {} });
  assert.match(String((await page({})).sent), />MONA AHMED ALI<\/div>/);
});

test('the edit refuses an Arabic name, course or duration, and an unknown certificate', { skip }, async () => {
  const arabic = await run(deskRouter, 'put', '/api/admin/institute-certificates/:id/edit', { params: { id: 'cc-cp-1' }, body: { nameEn: 'منى أحمد' } });
  assert.equal(arabic.statusCode, 400);
  assert.equal(arabic.body.code, 'CERT_ENGLISH_ONLY');
  assert.equal((await run(deskRouter, 'put', '/api/admin/institute-certificates/:id/edit', { params: { id: 'cc-cp-1' }, body: { duration: '٦ شهور' } })).statusCode, 400);
  assert.equal((await run(deskRouter, 'put', '/api/admin/institute-certificates/:id/edit', { params: { id: 'nope' }, body: {} })).statusCode, 404);
});

test('a certificate with no English name is not printed, and says what is missing', { skip }, async () => {
  await pool.query("UPDATE subscribers SET name_en=NULL WHERE id='s-cp-1'");
  const res = await page({});
  assert.equal(res.statusCode, 409);
  assert.match(String(res.sent), /الاسم بالإنجليزي للعميل/);
  // …until the desk types it on the certificate.
  await run(deskRouter, 'put', '/api/admin/institute-certificates/:id/edit', { params: { id: 'cc-cp-1' }, body: { nameEn: 'Mona Ahmed' } });
  assert.equal((await page({})).statusCode, 200);
});
