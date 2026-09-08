'use strict';
/**
 * The OTP senders carried their own phone normalisation, and it was the one
 * lib/phoneNumber.js was written to replace: digits, then strip leading zeros.
 * That turns 01012345678 — the form customers type and the form the lead
 * captures store — into 1012345678, which is nobody. Every sign-in code sent
 * over WhatsApp or SMS to a locally-stored number was addressed into thin air,
 * and the provider's rejection was logged and swallowed. Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sendGreenApiWhatsApp, sendSmsOtp } = require('../lib/otpProvider');

function stubFetch(response, captured = {}) {
  const original = global.fetch;
  global.fetch = async (url, options = {}) => {
    captured.url = String(url);
    captured.body = typeof options.body === 'string' && options.body.startsWith('{')
      ? JSON.parse(options.body)
      : String(options.body || '');
    return { ok: true, status: 200, json: async () => response };
  };
  return () => { global.fetch = original; };
}

test('a WhatsApp code goes to the international address, not the number minus its zero', async () => {
  const captured = {};
  const restore = stubFetch({ idMessage: 'M1' }, captured);
  try {
    const result = await sendGreenApiWhatsApp({
      phone: '01012345678', message: 'code', instanceId: 'i', apiToken: 't',
    });
    assert.equal(result.ok, true);
    assert.equal(captured.body.chatId, '201012345678@c.us');
  } finally { restore(); }
});

test('a number that cannot be dialled is refused instead of sent to a stranger', async () => {
  const captured = {};
  const restore = stubFetch({ idMessage: 'M1' }, captured);
  try {
    const result = await sendGreenApiWhatsApp({
      phone: '0223456789', message: 'code', instanceId: 'i', apiToken: 't',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'undialable_phone');
    assert.equal(captured.url, undefined, 'nothing is sent');
  } finally { restore(); }
});

test('Vonage receives E.164 without the plus', async () => {
  const captured = {};
  const restore = stubFetch({ messages: [{ status: '0' }] }, captured);
  try {
    const result = await sendSmsOtp({
      phone: '01012345678', message: 'code',
      settings: { sms: { enabled: true, provider: 'vonage', api_key: 'k', api_secret: 's' } },
    });
    assert.equal(result.ok, true);
    assert.match(captured.body, /to=201012345678(&|$)/);
  } finally { restore(); }
});

test('Twilio receives E.164 with the plus', async () => {
  const captured = {};
  const restore = stubFetch({ sid: 'SM1' }, captured);
  try {
    const result = await sendSmsOtp({
      phone: '01012345678', message: 'code',
      settings: { sms: { enabled: true, provider: 'twilio', account_sid: 'AC', auth_token: 't', from_number: '+1555' } },
    });
    assert.equal(result.ok, true);
    assert.match(captured.body, /To=%2B201012345678(&|$)/);
  } finally { restore(); }
});
