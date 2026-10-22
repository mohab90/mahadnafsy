'use strict';
/**
 * Two things a save or a sign-up used to drop, against a real MariaDB:
 *
 * - «إعدادات SMS»: the panel never shows the stored API key and sends one only
 *   when it is retyped, but the route wrote whatever came — so saving the
 *   sender name or the on/off switch blanked the key.
 * - A WhatsApp sign-up from a referral link (/auth?ref=CODE) credited nobody;
 *   only the email form passed the code on.
 *
 * Runs only with DB_* (or TEST_DB_*); the WhatsApp provider is replaced so
 * nothing is sent.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-client-it';
process.env.DEFAULT_TENANT_ID = T;
process.env.ADMIN_EMAILS = 'owner@client-it.test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'integration-test-otp-secret-0123456789';
process.env.WA_OTP_RETRY_DELAY_MS = '0';
process.env.DISABLE_BACKGROUND_JOBS = 'true';

const sent = [];
const whatsappPath = path.join(__dirname, '..', '..', 'lib', 'whatsapp.js');
const real = ENABLED ? require(whatsappPath) : {};
require.cache[whatsappPath] = {
  id: whatsappPath, filename: whatsappPath, loaded: true,
  exports: {
    ...real,
    sendWhatsApp: async (to, message) => {
      sent.push({ to, code: (message.match(/\d{6}/) || [])[0] });
      return { ok: true, idMessage: `msg-${sent.length}` };
    },
  },
};

let pool; let server; let base;
const REF = 'CLITREF1';

async function clean() {
  for (const table of ['sms_settings', 'referral_codes', 'otp_codes', 'leads', 'users']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query('INSERT IGNORE INTO client_code_counter (id, next_value) VALUES (1, 10001)');
  await pool.query('INSERT INTO referral_codes (id, subscriber_id, code, tenant_id) VALUES (?, ?, ?, ?)', ['clit-ref-1', 'clit-sub-1', REF, T]);

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = T;
    req.user = { uid: 'u-owner', email: 'owner@client-it.test', tenant_id: T, mfa_verified: true };
    next();
  });
  app.use(require('../../routes/misc/messaging'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!ENABLED) return;
  if (server) await new Promise(resolve => server.close(resolve));
  await clean();
  await pool.end();
  setTimeout(() => process.exit(), 300).unref();
});

const putSms = async body => {
  const response = await fetch(`${base}/api/admin/sms-settings`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json().catch(() => ({}))));
};
const storedSms = async () => (await pool.query('SELECT provider, api_key, sender_id, is_active FROM sms_settings WHERE tenant_id=?', [T]))[0][0];

test('saving the SMS sender or switch without retyping the key keeps the key', { skip }, async () => {
  await putSms({ provider: 'vonage', sender_id: 'MAHAD', is_active: false, api_key: 'real-key-123' });
  assert.equal((await storedSms()).api_key, 'real-key-123');

  // What the panel sends when only the sender and the switch changed.
  await putSms({ provider: 'vonage', sender_id: 'MahadNafsy', is_active: true });
  const row = await storedSms();
  assert.equal(row.api_key, 'real-key-123', 'the key survived a save that did not mention it');
  assert.equal(row.sender_id, 'MahadNafsy');
  assert.equal(Number(row.is_active), 1);

  // A retyped key still replaces it.
  await putSms({ provider: 'infobip', sender_id: 'MahadNafsy', is_active: true, api_key: 'new-key-456' });
  assert.equal((await storedSms()).api_key, 'new-key-456');
});

test('a WhatsApp sign-up from a referral link credits the code; signing in again does not', { skip }, async () => {
  const otp = require('../../lib/whatsappOtp');
  const uses = async () => Number((await pool.query('SELECT uses FROM referral_codes WHERE id=?', ['clit-ref-1']))[0][0].uses);
  const phone = '01022223333';
  const codeFor = () => [...sent].reverse().find(s => s.to.endsWith(phone.slice(-9)))?.code;

  await otp.requestLoginCode({ tenantId: T, phone });
  const first = await otp.verifyLoginCode({ tenantId: T, phone, code: codeFor(), name: 'سارة', ref: REF.toLowerCase() });
  assert.equal(first.created, true);
  assert.equal(await uses(), 1, 'the new account is counted on the referrer\'s code');

  // The same person signing in again later from the same link is not a referral.
  await pool.query('UPDATE otp_codes SET created_at = DATE_SUB(created_at, INTERVAL 5 MINUTE) WHERE tenant_id=?', [T]);
  await otp.requestLoginCode({ tenantId: T, phone });
  const again = await otp.verifyLoginCode({ tenantId: T, phone, code: codeFor(), ref: REF });
  assert.equal(again.created, false);
  assert.equal(await uses(), 1);
});
