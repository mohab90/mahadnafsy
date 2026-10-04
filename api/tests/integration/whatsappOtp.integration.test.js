'use strict';
/**
 * WhatsApp sign-in against a real MariaDB: the code's whole life, from request
 * to account and lead. Runs only with DB_* (or TEST_DB_*) credentials; the
 * WhatsApp provider is replaced so nothing is sent.
 *
 *   DB_HOST=127.0.0.1 DB_USER=… DB_PASSWORD=… DB_NAME=… node --test tests/integration/whatsappOtp.integration.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'integration-test-otp-secret-0123456789';

// The provider: records what would have gone out, or fails when told to.
const sent = [];
let failNext = null;
const whatsappPath = path.join(__dirname, '..', '..', 'lib', 'whatsapp.js');
const real = ENABLED ? require(whatsappPath) : {};
require.cache[whatsappPath] = {
  id: whatsappPath, filename: whatsappPath, loaded: true,
  exports: {
    ...real,
    sendWhatsApp: async (to, message) => {
      if (failNext) { const reason = failNext; failNext = null; return { ok: false, reason }; }
      sent.push({ to, code: (message.match(/\d{6}/) || [])[0] });
      return { ok: true, idMessage: `msg-${sent.length}` };
    },
  },
};

const TENANT = 'tenant-otp-it';
let otp; let pool;
const codeFor = phone => [...sent].reverse().find(s => s.to.endsWith(phone.slice(-9)))?.code;

// Rows a run left behind (an interrupted run, a failed delete) must not
// break the next one: cleared before as well as after.
async function clean() {
  for (const table of ['otp_codes', 'leads', 'users', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]);
}

before(async () => {
  if (!ENABLED) return;
  otp = require('../../lib/whatsappOtp');
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query('INSERT IGNORE INTO client_code_counter (id, next_value) VALUES (1, 10001)');
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

const skip = !ENABLED && 'no DB_* configured';

test('a new number: one code for a double tap, the account and its lead on verification', { skip }, async () => {
  const phone = '01011112222';
  const [first, second] = await Promise.all([
    otp.requestLoginCode({ tenantId: TENANT, phone }),
    otp.requestLoginCode({ tenantId: TENANT, phone }),
  ]);
  assert.ok(first.ok && second.ok);
  const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM otp_codes WHERE tenant_id=? AND phone='1011112222'", [TENANT]);
  assert.equal(Number(n), 1, 'two taps in the same instant issue one code');
  assert.equal(sent.filter(s => s.to.endsWith('1011112222')).length, 1);

  // A resend inside the cooldown keeps the first code alive.
  const again = await otp.requestLoginCode({ tenantId: TENANT, phone: '+20 101 111 2222' });
  assert.equal(again.cooldown, true);
  const code = codeFor(phone);

  await assert.rejects(otp.verifyLoginCode({ tenantId: TENANT, phone, code: code === '000000' ? '111111' : '000000' }), /غير صحيح/);
  const done = await otp.verifyLoginCode({ tenantId: TENANT, phone: '00201011112222', code, name: 'منى' });
  assert.equal(done.created, true);
  const [[lead]] = await pool.query("SELECT name, phone, source, status FROM leads WHERE tenant_id=? AND phone='1011112222'", [TENANT]);
  assert.deepEqual({ ...lead }, { name: 'منى', phone: '1011112222', source: 'تسجيل دخول', status: 'new' }, 'a WhatsApp signup reaches the sales team');

  // Used once.
  await assert.rejects(otp.verifyLoginCode({ tenantId: TENANT, phone, code }), /منتهي/);
});

test('the same number signing in again: no second account, no second lead', { skip }, async () => {
  const phone = '01011112222';
  await pool.query("UPDATE otp_codes SET created_at = DATE_SUB(created_at, INTERVAL 5 MINUTE) WHERE tenant_id=?", [TENANT]);
  await otp.requestLoginCode({ tenantId: TENANT, phone });
  const done = await otp.verifyLoginCode({ tenantId: TENANT, phone, code: codeFor(phone) });
  assert.equal(done.created, false);
  const [[counts]] = await pool.query(
    "SELECT (SELECT COUNT(*) FROM users WHERE tenant_id=? AND phone='1011112222') u, (SELECT COUNT(*) FROM leads WHERE tenant_id=? AND phone='1011112222') l",
    [TENANT, TENANT]);
  assert.deepEqual([Number(counts.u), Number(counts.l)], [1, 1]);
});

test('wrong codes run out; an expired code and another number\'s code do not open the account', { skip }, async () => {
  const phone = '01033334444';
  await otp.requestLoginCode({ tenantId: TENANT, phone });
  const code = codeFor(phone);
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < otp.MAX_ATTEMPTS; i++) await assert.rejects(otp.verifyLoginCode({ tenantId: TENANT, phone, code: wrong }), /غير صحيح/);
  await assert.rejects(otp.verifyLoginCode({ tenantId: TENANT, phone, code }), /تجاوز عدد المحاولات/, 'the right code after too many wrong ones is refused');

  await pool.query("UPDATE otp_codes SET created_at = DATE_SUB(created_at, INTERVAL 5 MINUTE) WHERE tenant_id=?", [TENANT]);
  await otp.requestLoginCode({ tenantId: TENANT, phone });
  await assert.rejects(otp.verifyLoginCode({ tenantId: TENANT, phone: '01055556666', code: codeFor(phone) }), /منتهي/, 'a code is for its own number');
  await pool.query("UPDATE otp_codes SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE tenant_id=? AND phone='1033334444'", [TENANT]);
  await assert.rejects(otp.verifyLoginCode({ tenantId: TENANT, phone, code: codeFor(phone) }), /منتهي/);
});

test('a provider outage: the code dies, the customer is told, and it does not count', { skip }, async () => {
  const phone = '01077778888';
  failNext = 'timeout';
  await assert.rejects(otp.requestLoginCode({ tenantId: TENANT, phone }), error => error.statusCode === 503);
  const [[row]] = await pool.query("SELECT used, delivery_status FROM otp_codes WHERE tenant_id=? AND phone='1077778888'", [TENANT]);
  assert.deepEqual([Number(row.used), row.delivery_status], [1, 'failed']);
  // No cooldown after a code that never left.
  const retry = await otp.requestLoginCode({ tenantId: TENANT, phone });
  assert.equal(retry.delivered, true);
});

test('an implausible number is refused before anything is written', { skip }, async () => {
  await assert.rejects(otp.requestLoginCode({ tenantId: TENANT, phone: '12345' }), error => error.statusCode === 400);
});
