'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  diagnoseFacebook,
  diagnoseGoogleSheets,
  diagnoseOtp,
  diagnosePayment,
  validateOtpTarget,
} = require('../lib/connectorDiagnostics');
const { safeMetadata } = require('../lib/auditTrail');

test('manual payment diagnostic is local and never probes Paymob', () => {
  const output = diagnosePayment({
    active_provider: 'manual',
    manual: { enabled: true, require_proof_review: true, supported_methods: ['instapay'] },
    paymob: { enabled: true, api_key: 'must-not-leak' },
  });
  assert.equal(output.ok, true);
  assert.equal(output.mode, 'local');
  assert.equal(JSON.stringify(output).includes('must-not-leak'), false);
  assert.equal(output.checks.some(item => item.name === 'paymob_external_probe_suspended' && item.ok), true);
});

test('Facebook diagnostic validates configuration before an outbound call', async () => {
  let calls = 0;
  const incomplete = await diagnoseFacebook({ facebook: { enabled: true } }, async () => { calls++; });
  assert.equal(incomplete.ok, false);
  assert.equal(calls, 0);

  const complete = await diagnoseFacebook({ facebook: {
    enabled: true,
    page_id: 'page-1',
    page_access_token: 'sensitive-token',
    webhook_verify_token: 'verify',
    app_secret: 'secret',
  } }, async url => {
    calls++;
    assert.equal(String(url).includes('sensitive-token'), true);
    return { ok: true, status: 200 };
  });
  assert.equal(complete.ok, true);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(complete).includes('sensitive-token'), false);
});

test('Google Sheets diagnostic uses configured sheet and rejects HTML login pages', async () => {
  const config = { google_sheets: { enabled: true, sheets: [{ sheetId: 'sheet-1', gid: '0' }] } };
  const output = await diagnoseGoogleSheets(config, {}, async () => ({
    ok: true,
    status: 200,
    body: null,
    text: async () => '<!doctype html><title>Sign in</title>',
  }));
  assert.equal(output.ok, false);
  assert.equal(output.checks.at(-1).name, 'sheet_accessible');
});

test('OTP diagnostic is dry-run by default and requires a valid explicit target', async () => {
  const config = { email: { enabled: true, smtp_host: 'smtp.example.com', smtp_user: 'u', smtp_password: 'p' } };
  const dry = await diagnoseOtp('email', '', config);
  assert.equal(dry.ok, true);
  assert.equal(dry.mode, 'dry-run');
  assert.equal(validateOtpTarget('email', 'broken'), false);
  await assert.rejects(() => diagnoseOtp('email', 'broken', config), /Invalid OTP test recipient/);
});

test('OTP real-send result never contains code, recipient or provider details', async () => {
  const to = 'admin@example.com';
  const config = { email: { enabled: true, smtp_host: 'smtp.example.com', smtp_user: 'u', smtp_password: 'p' } };
  const output = await diagnoseOtp('email', to, config, { email: async () => ({ ok: true, raw: 'secret' }) });
  const serialized = JSON.stringify(output);
  assert.equal(output.ok, true);
  assert.equal(output.mode, 'live');
  assert.equal(serialized.includes(to), false);
  assert.equal(serialized.includes('secret'), false);
});

test('audit metadata strips credential and recipient fields recursively', () => {
  const safe = safeMetadata({
    provider: 'sms',
    api_key: 'secret',
    nested: { password: 'secret', to: '01000000000', ok: true },
  });
  assert.deepEqual(safe, { provider: 'sms', nested: { ok: true } });
});
