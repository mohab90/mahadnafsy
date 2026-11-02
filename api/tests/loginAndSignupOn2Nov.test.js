'use strict';
/**
 * 2 Nov 2026, «بعض العملاء مش بيعرفوا يعملوا تسجيل دخول … ليه أي عميل بيعمل تسجيل دخول السيستم بيحسبه كأنه عميل جديد وبيظهر كأنه مكرر»:
 *
 *  - a client stored as 01XXXXXXXXX (7,114 of 14,241 on production) was a stranger to the check "already a client?" that compared with the bare
 *    1XXXXXXXXX, so signing in filed them again as a new lead «تسجيل دخول»;
 *  - «نسيت كلمة المرور» by number looked the client up the same way, so for most clients no code was ever sent;
 *  - 32 customers were refused 305 times in two weeks by the two-device rule with «تواصل مع الدعم»;
 *  - the sign-in page: an email or a number with the password, a code on the channel typed, no WhatsApp-code sign-in, both ways in at sign-up;
 *  - a year of access, a year and a half for two tracks.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-login-2-nov-0123456789abcdef0123456789';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ensureLeadForUser } = require('../lib/registrationLead');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

function fakeConn({ clientPhoneDigits = null, clientEmail = null } = {}) {
  const writes = [];
  return {
    writes,
    async query(sql, params = []) {
      const flat = String(sql).replace(/\s+/g, ' ');
      if (/FROM subscribers/.test(flat)) {
        const byPhone = clientPhoneDigits && params.includes(clientPhoneDigits);
        const byEmail = clientEmail && params.includes(clientEmail);
        return [byPhone || byEmail ? [{ id: 'sub-1' }] : []];
      }
      if (/INSERT INTO leads/.test(flat)) { writes.push(flat); return [{ affectedRows: 1 }]; }
      return [[]];
    },
  };
}

test('a client stored as 01XXXXXXXXX who signs in is not filed again as a new lead', async () => {
  const conn = fakeConn({ clientPhoneDigits: '01012345678' });
  const outcome = await ensureLeadForUser(conn, { tenantId: 't', user: { id: 'u1', name: 'منى', phone: '1012345678' } });
  assert.equal(outcome.created, false);
  assert.equal(outcome.reason, 'already a client');
  assert.equal(conn.writes.length, 0, 'no lead was written');
});

test('every spelling of the number is asked for, and the email counts too', async () => {
  const asked = [];
  const conn = { async query(sql, params) { asked.push({ sql: String(sql), params }); return [[{ id: 'sub-1' }]]; } };
  await ensureLeadForUser(conn, { tenantId: 't', user: { id: 'u1', phone: '+201012345678', email: 'Mona@Example.com ' } });
  const query = asked.find(item => /FROM subscribers/.test(item.sql));
  assert.match(query.sql, /phone_digits IN \(/);
  for (const spelling of ['1012345678', '01012345678', '201012345678']) assert.ok(query.params.includes(spelling), spelling);
  assert.ok(query.params.includes('mona@example.com'), 'the email, case and spaces aside');
});

test('a real newcomer still becomes a lead', async () => {
  const conn = fakeConn();
  const seen = [];
  const original = conn.query;
  conn.query = async (sql, params) => { seen.push(String(sql)); return original(sql, params); };
  // no client, and the lead lookup finds none: reaches the INSERT (the code-number and rep helpers are the real ones, which need a database)
  await assert.rejects(ensureLeadForUser(conn, { tenantId: 't', user: { id: 'u2', name: 'جديد', phone: '1099999999' } }), () => true);
  assert.ok(seen.some(sql => /FROM subscribers/.test(sql)), 'it asked whether the person is a client first');
});

test('the forgotten-password code finds a client by every spelling of the number and goes where it was asked for', () => {
  const src = read('api/routes/auth/passwordReset.js');
  assert.match(src, /const clientSpellings = matchingSpellings\(rawIdentifier\);/);
  assert.match(src, /phone_digits IN \(\$\{clientSpellings\.map\(\(\) => '\?'\)\.join\(','\)\}\)/);
  assert.match(src, /const userSpellings = identitySpellings\(rawIdentifier\);/);
  assert.match(src, /const verifySpellings = identitySpellings\(rawIdentifier\);/, 'the code is checked against the same account it was issued to');
  // an address typed: the address; a number typed: WhatsApp on it (the proven email only as the fallback)
  assert.match(src, /const dialable = !identifierIsEmail && !isStaffAccount/);
});

test('the sign-up asks for both the email and the number, and finds an existing account by every spelling', () => {
  const src = read('api/routes/auth/registration.js');
  assert.match(src, /email:\s+v => isEmail\(v\) \|\| 'البريد الإلكتروني مطلوب وصحيح'/);
  assert.match(src, /phone:\s+v => isPlausibleNumber\(normalizeWhatsAppNumber\(v\)\)/);
  assert.match(src, /const takenSpellings = identitySpellings\(phone\);/);
  assert.match(src, /نسيت كلمة المرور/, 'the message for a number that has an account says how to get in');
});

test('signing in by a WhatsApp code is off: the routes answer 410, and nothing on the page calls them', () => {
  const route = read('api/routes/auth/whatsappLogin.js');
  assert.match(route, /process\.env\.AUTH_WHATSAPP_LOGIN === '1'/);
  assert.match(route, /router\.use\('\/api\/auth\/whatsapp'/);
  assert.match(route, /res\.status\(410\)\.json\(\{[^}]*code: 'WHATSAPP_LOGIN_OFF'/);
  assert.doesNotMatch(read('client/pages/Auth.tsx'), /whatsapp\/|WaOtp|waMode/i);
});

test('a place a device has not used for a month is given to the new device', () => {
  const src = read('api/lib/customerDevices.js');
  assert.match(src, /const STALE_DEVICE_DAYS = Math\.max\(1, Number\(process\.env\.CUSTOMER_DEVICE_STALE_DAYS\) \|\| 30\);/);
  assert.match(src, /last_seen_at < \? ORDER BY last_seen_at ASC LIMIT 1/);
  assert.match(src, /if \(!stale\) throw deviceLimitError\(\);/, 'a place in use is still refused');
});

test('the page: an email or a number with the password, the code on the channel typed, both ways in at sign-up', () => {
  const page = read('client/pages/Auth.tsx');
  assert.match(page, /type Mode = 'login' \| 'register' \| 'forgot';/);
  assert.match(page, /mysqlAuth\.login\(identifier\.trim\(\), password\)/);
  assert.match(page, /!fullName\.trim\(\) \|\| !email\.trim\(\) \|\| !phone\.trim\(\) \|\| !password\.trim\(\)/, 'name, email, number and password are all required');
  assert.match(page, /هيوصلك الكود على \$\{channelWord\}/, 'the screen says where the code will go before it is sent');
  assert.match(page, /const channelWord = kind === 'phone' \? 'واتساب' : kind === 'email' \? 'الإيميل'/);
  assert.match(page, /\['PHONE_ALREADY_REGISTERED', 'EMAIL_BELONGS_TO_CLIENT', 'STAFF_INVITATION_REQUIRED'\]\.includes\(code\)/, 'a sign-up refusal is shown in its own words');
  assert.equal((page.match(/<h1/g) || []).length, 1, 'one h1');
});

test('a track can name its own months of access, and the two a year and a half are set by migration', () => {
  const migration = read('api/migrations/354_v26_bundle_access_months.sql');
  assert.match(migration, /ALTER TABLE bundles ADD COLUMN IF NOT EXISTS access_months INT NULL/);
  assert.match(migration, /id IN \('b-1776608174758', 'b-1774353052042'\)/);
  assert.match(migration, /SET access_months = 18/);
  const entitlements = read('api/lib/entitlements.js');
  assert.match(entitlements, /SELECT access_months FROM bundles WHERE id=\? AND tenant_id=\? LIMIT 1/);
  assert.match(entitlements, /if \(Number\(trackResult\?\.\[0\]\?\.\[0\]\?\.access_months\) > 0\) accessMonths = Number\(trackResult\[0\]\[0\]\.access_months\);/);
  assert.match(read('api/routes/core/catalog.js'), /access_months=COALESCE\(VALUES\(access_months\), access_months\)/, 'a screen that does not send it cannot wipe it');
});
