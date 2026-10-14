'use strict';
/**
 * «زر تعديل لبيانات شهاده العميل تظهر لكل مسئولين التحصيل او خدمه العملاء …
 * يعدل اسم العميل علي الشهاده ويضيف الاسم بالانجليزي … والرقم القومي يعدله»
 * (10 Oct 2026). PUT /api/admin/certificate-requests/:id/client-data, for the
 * collection desk (manage_financial) as well as customer service. Real MariaDB.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-certdata-it';
const ROUTE = '/api/admin/certificate-requests/:id/client-data';
let pool; let router;

const COLLECTION = { id: 'st-cd-col', name: 'التحصيل', role: 'collection' };
const SALES = { id: 'st-cd-sal', name: 'سيلز', role: 'sales' };

async function call(body, staff) {
  const layer = router.stack.find(item => item.route?.path === ROUTE && item.route.methods.put);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params: { id: 'cr-cd-1' }, body, query: {}, headers: {}, tenantId: TENANT, user: { uid: 'u', email: 'desk@example.test' }, staffRecord: staff, isSuperAdmin: false, ip: '1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  for (const table of ['certificate_requests', 'activity_logs', 'subscribers']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/certificates');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone) VALUES ('sub-cd-1', ?, 'منى أحمد', '1018000001')", [TENANT]);
  await pool.query(
    `INSERT INTO certificate_requests (id, tenant_id, subscriber_id, type, name_ar, nationality, status)
     VALUES ('cr-cd-1', ?, 'sub-cd-1', 'INSTITUTE', 'منى أحمد علي', 'EGYPTIAN', 'PAID')`, [TENANT]);
});
after(async () => { if (!ENABLED) return; await clean(); await pool.end(); });

test('collection corrects the name on the certificate, adds the English name and the national ID', { skip }, async () => {
  const res = await call({ nameAr: 'منى أحمد علي حسن', nameEn: 'Mona Ahmed Ali', idNumber: '29001011234567' }, COLLECTION);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [[row]] = await pool.query("SELECT name_ar, name_en, id_number FROM certificate_requests WHERE id='cr-cd-1'");
  assert.deepEqual([row.name_ar, row.name_en, row.id_number], ['منى أحمد علي حسن', 'Mona Ahmed Ali', '29001011234567']);
  const [[client]] = await pool.query("SELECT name, name_en, national_id FROM subscribers WHERE id='sub-cd-1'");
  assert.equal(client.name, 'منى أحمد', 'the client record keeps its own name');
  assert.equal(client.name_en, 'Mona Ahmed Ali');
});

test('a name on the certificate that is not a full Arabic name is refused', { skip }, async () => {
  const res = await call({ nameAr: 'Mona' }, COLLECTION);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /الاسم على الشهادة|حروف عربي/);
});

test('a role with neither customer service nor collection rights cannot', { skip }, async () => {
  const res = await call({ nameEn: 'Mona Ali' }, SALES);
  assert.equal(res.statusCode, 403);
});
