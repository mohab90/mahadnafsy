'use strict';
/**
 * Two institutes holding the same shape of data, for tests that prove one
 * never sees the other's rows through the real app.
 *
 * seedTenantPair() files, in each tenant: an administrator who can sign in, a
 * sales rep, a course, a lead, a client enrolled on the course with a paid
 * payment, an order, a certificate request and a support ticket. Every row
 * carries its tenant's marker (ISO-ALPHA / ISO-BRAVO) in a name or a note, so
 * a leak is a marker in the answer; the lead and the client share one phone
 * number and one e-mail across the two tenants, so anything that matches by
 * phone or address without the tenant shows up too.
 *
 * Tenant A is the original institute: the legacy modules (reports, search) are
 * open only there (middleware/legacyTenantContainment.js), so A is the side
 * that can ask the widest questions.
 */
const bcrypt = require('bcryptjs');

const SHARED_PHONE = '01055512345';
const SHARED_EMAIL = 'iso.client@example.test';
const PASSWORD = 'Iso-Tenant-Pass-2026!';

function sideFor(tenantId, tag) {
  const lower = tag.toLowerCase();
  return {
    tenantId, tag, marker: `ISO-${tag}`,
    adminEmail: `iso.admin.${lower}@example.test`, password: PASSWORD,
    ids: {
      user: `u-iso-${lower}`, admin: `st-iso-${lower}-admin`, rep: `st-iso-${lower}-rep`,
      course: `co-iso-${lower}`, lead: `ld-iso-${lower}`, subscriber: `sub-iso-${lower}`,
      enrollment: `en-iso-${lower}`, payment: `pay-iso-${lower}`, order: `ord-iso-${lower}`,
      certificate: `cr-iso-${lower}`, ticket: `tk-iso-${lower}`,
    },
  };
}

const ROW_TABLES = [
  ['support_tickets', 'ticket'], ['certificate_requests', 'certificate'], ['orders', 'order'], ['payments', 'payment'],
  ['enrollments', 'enrollment'], ['subscribers', 'subscriber'], ['leads', 'lead'], ['courses', 'course'],
];

async function cleanSide(pool, side) {
  for (const [table, key] of ROW_TABLES) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=? AND id=?`, [side.tenantId, side.ids[key]]).catch(() => {});
  }
  await pool.query('DELETE FROM staff WHERE tenant_id=? AND id IN (?, ?)', [side.tenantId, side.ids.admin, side.ids.rep]).catch(() => {});
  await pool.query('DELETE FROM login_history WHERE user_id=?', [side.ids.user]).catch(() => {});
  await pool.query('DELETE FROM users WHERE tenant_id=? AND id=?', [side.tenantId, side.ids.user]).catch(() => {});
}

async function seedSide(pool, side, amount) {
  const t = side.tenantId;
  const { ids, marker } = side;
  const hash = await bcrypt.hash(side.password, 4);
  await pool.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active, session_version)
     VALUES (?, ?, ?, ?, ?, 'staff', 1, 1)`, [ids.user, t, side.adminEmail, hash, `${marker}-ADMIN`]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       (?, ?, ?, ?, '1011110000', 'ADMIN', 1, '2025-01-01'),
       (?, ?, ?, ?, '1011110001', 'SALES', 1, '2025-01-01')`,
    [ids.admin, t, `${marker}-ADMIN`, side.adminEmail, ids.rep, t, `${marker}-REP`, `iso.rep.${side.tag.toLowerCase()}@example.test`]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES (?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', ?)`, [ids.course, t, `${marker}-COURSE`, amount]);
  await pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, email, source, status, hidden, assigned_sales_id, assigned_sales_name, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'new', 0, ?, ?, ?, UTC_TIMESTAMP())`,
    [ids.lead, t, `${marker}-LEAD`, SHARED_PHONE, SHARED_EMAIL, `${marker}-SOURCE`, ids.rep, `${marker}-REP`, `${marker}-NOTE`]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, email, is_active, assigned_sales_id, assigned_sales_name, notes, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, UTC_TIMESTAMP())`,
    [ids.subscriber, t, `${marker}-CLIENT`, SHARED_PHONE, SHARED_EMAIL, ids.rep, `${marker}-REP`, `${marker}-NOTE`]);
  await pool.query(
    `INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, enrolled_at, status, entitlement_source)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), 'active', 'manual')`, [ids.enrollment, t, ids.subscriber, ids.course]);
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, amount_egp, payment_type, payment_method,
                           status, date, note, staff_id, staff_name, item_title, created_at)
     VALUES (?, ?, ?, ?, ?, 'EGP', ?, 'COURSE', 'cash', 'paid', CURDATE(), ?, ?, ?, ?, UTC_TIMESTAMP())`,
    [ids.payment, t, ids.subscriber, ids.course, amount, amount, `${marker}-PAYMENT`, ids.rep, `${marker}-REP`, `${marker}-COURSE`]);
  await pool.query(
    `INSERT INTO orders (id, tenant_id, type, item_id, item_title, amount, currency, customer_name, customer_email, customer_phone,
                         status, subscriber_id, course_id, created_at, paid_at)
     VALUES (?, ?, 'course', ?, ?, ?, 'EGP', ?, ?, ?, 'paid', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [ids.order, t, ids.course, `${marker}-COURSE`, amount, `${marker}-ORDER`, SHARED_EMAIL, SHARED_PHONE, ids.subscriber, ids.course]);
  await pool.query(
    `INSERT INTO certificate_requests (id, tenant_id, subscriber_id, course_id, type, custom_name, status, price, currency, requested_at)
     VALUES (?, ?, ?, ?, 'institute', ?, 'PENDING', 0, 'EGP', UTC_TIMESTAMP())`,
    [ids.certificate, t, ids.subscriber, ids.course, `${marker}-CERT`]);
  await pool.query(
    `INSERT INTO support_tickets (id, tenant_id, ticket_code, subscriber_id, subscriber_email, subscriber_name, subject, body,
                                  channel, priority, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'whatsapp', 'normal', 'open', UTC_TIMESTAMP())`,
    [ids.ticket, t, `${marker}-T1`, ids.subscriber, SHARED_EMAIL, `${marker}-CLIENT`, `${marker}-TICKET`, `${marker}-BODY`]);
}

/** Seeds both tenants; B's institute row and an active plan are created if missing. */
async function seedTenantPair(pool, { tenantA = 'tenant-default', tenantB = 'tenant-iso-bravo-it' } = {}) {
  const a = sideFor(tenantA, 'ALPHA');
  const b = sideFor(tenantB, 'BRAVO');
  await cleanTenantPair(pool, { a, b });
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status, plan_key) VALUES (?, ?, 'Isolation B', 'active', 'enterprise-local')",
    [tenantB, tenantB]);
  await pool.query(
    `INSERT IGNORE INTO tenant_subscriptions (id, tenant_id, plan_id, status, starts_at)
     SELECT ?, ?, id, 'active', UTC_TIMESTAMP() FROM saas_plans WHERE plan_key='enterprise-local' LIMIT 1`,
    [`sub-${tenantB}`, tenantB]);
  await seedSide(pool, a, 1234);
  await seedSide(pool, b, 8765);
  return { a, b };
}

async function cleanTenantPair(pool, { a, b }) {
  for (const side of [a, b]) await cleanSide(pool, side);
  await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id=?', [b.tenantId]).catch(() => {});
  await pool.query('DELETE FROM tenants WHERE id=?', [b.tenantId]).catch(() => {});
}

/** Signs in through POST /api/auth/login and returns the session cookie. */
async function signIn(base, side) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': side.tenantId },
    body: JSON.stringify({ email: side.adminEmail, password: side.password }),
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`sign-in for ${side.adminEmail} answered ${res.status}: ${text}`);
  const cookie = (res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || ''])
    .map(value => value.split(';')[0]).find(value => value.startsWith('authToken='));
  if (!cookie) throw new Error(`sign-in for ${side.adminEmail} set no session cookie`);
  return cookie;
}

async function getAs(base, side, cookie, path) {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie, 'X-Tenant-Id': side.tenantId } });
  return { status: res.status, text: await res.text() };
}

/**
 * Every path answers 200 for `own`, names none of `foreign`'s markers or ids,
 * and — where `expectOwn` lists a marker — does show `own`'s row, so an empty
 * or failing answer cannot pass for an isolated one.
 */
async function assertIsolated(assert, base, own, foreign, cookie, endpoints) {
  const foreignNeedles = [foreign.marker, ...Object.values(foreign.ids)];
  for (const { path, expectOwn } of endpoints) {
    const { status, text } = await getAs(base, own, cookie, path);
    assert.equal(status, 200, `${own.tag} GET ${path}: ${text.slice(0, 300)}`);
    const leaked = foreignNeedles.filter(needle => text.includes(needle));
    assert.deepEqual(leaked, [], `${own.tag} GET ${path} shows ${foreign.tag}'s rows`);
    if (expectOwn) assert.ok(text.includes(`${own.marker}-${expectOwn}`), `${own.tag} GET ${path} shows its own ${expectOwn}`);
  }
}

module.exports = { seedTenantPair, cleanTenantPair, signIn, getAs, assertIsolated, SHARED_PHONE, SHARED_EMAIL };
