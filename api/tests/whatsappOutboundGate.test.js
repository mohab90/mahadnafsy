'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

// Every category in use. Adding a send means adding its category here, which is
// the point: the list is the inventory of what this system can put on a number.
const KNOWN_CATEGORIES = new Set([
  'otp',           // sign-in and password-reset codes — the only one on by default
  'welcome',       // signup / account-created greetings
  'reminder',      // installments, pending payments, Dokki sessions, follow-ups
  'automation',    // automation engine campaigns
  'broadcast',     // queued sends and admin bulk messaging
  'payment',       // payment confirmations and proof outcomes
  'crm',           // per-client staff-triggered notices
  'staff_alert',   // messages to staff, not customers
  'inbox_reply',   // a staff reply inside the messaging inbox
  'channel_test',  // the "اختبار" button on a channel
]);

const senderFiles = () => {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.js')) out.push(rel);
    }
  };
  walk('lib');
  walk('routes');
  return out.filter(f => f !== 'lib/whatsapp.js');
};

test('the gate refuses anything that does not name an allowed category', () => {
  const source = read('lib/whatsapp.js');
  // Enforced inside sendWhatsApp, not at the call sites: the per-feature toggles
  // in settings never covered most senders, which is how disabled welcome
  // messages kept going out.
  assert.match(source, /function isCategoryAllowed/);
  assert.match(source, /WHATSAPP_OUTBOUND_CATEGORIES\s*\?\?\s*'otp'/,
    'the default allowlist must be otp alone');
  assert.match(source, /if \(!isCategoryAllowed\(opts\.category\)\) \{/);
  assert.match(source, /return \{ ok: false, reason: 'category_disabled'/);
  // A missing category is a refusal, so a send added later fails closed.
  assert.match(source, /if \(!name\) return false;/);
});

test('the refusal happens before the provider and before any budget is claimed', () => {
  const source = read('lib/whatsapp.js');
  // Scoped to the body of sendWhatsApp — searching the whole file would find the
  // _sendMeta/_sendGreenApi definitions, which sit above it.
  const bodyStart = source.indexOf('async function sendWhatsApp(');
  assert.ok(bodyStart > -1);
  const body = source.slice(bodyStart);

  const gateAt = body.indexOf('isCategoryAllowed(opts.category)');
  assert.ok(gateAt > -1, 'the gate must be inside sendWhatsApp');
  for (const later of ['toDialable(phone)', 'claimSendBudget', 'await _sendMeta(', 'await _sendGreenApi(']) {
    const at = body.indexOf(later);
    assert.ok(at > -1, `${later} not found in sendWhatsApp`);
    assert.ok(at > gateAt,
      `${later} must run after the category gate, so a blocked send costs the account nothing`);
  }
});

test('a blocked send is not mistaken for a broken channel', () => {
  const source = read('lib/whatsapp.js');
  // markChannelError lives past the gate, so a refusal can never park a channel
  // in `error` and take OTP down with it.
  assert.ok(source.indexOf('markChannelError') > source.indexOf("reason: 'category_disabled'"));
  assert.match(source, /reason === 'category_disabled'[\s\S]{0,200}رسائل التحقق/);
});

test('every sendWhatsApp call names a category, and every category is a known one', () => {
  const offenders = [];
  const used = new Set();

  for (const file of senderFiles()) {
    const source = read(file);
    let index = source.indexOf('sendWhatsApp(');
    while (index !== -1) {
      // Skip the import and any mention inside a comment line.
      const lineStart = source.lastIndexOf('\n', index) + 1;
      const line = source.slice(lineStart, source.indexOf('\n', index));
      if (/require\(|^\s*(\/\/|\*)/.test(line)) {
        index = source.indexOf('sendWhatsApp(', index + 1);
        continue;
      }
      // Read to the end of the call by balancing parentheses.
      let depth = 0;
      let end = index + 'sendWhatsApp'.length;
      for (; end < source.length; end++) {
        if (source[end] === '(') depth++;
        else if (source[end] === ')') { depth--; if (depth === 0) { end++; break; } }
      }
      const call = source.slice(index, end);
      const match = call.match(/category:\s*'([a-z_]+)'/);
      if (!match) offenders.push(`${file}:${source.slice(0, index).split('\n').length}`);
      else used.add(match[1]);
      index = source.indexOf('sendWhatsApp(', end);
    }
  }

  assert.deepEqual(offenders, [],
    'these sends would be refused by the gate because they name no category');
  for (const category of used) {
    assert.ok(KNOWN_CATEGORIES.has(category), `unknown category in use: ${category}`);
  }
  assert.ok(used.has('otp'), 'the OTP path must still be tagged otp or sign-in breaks');
});

test('only the codes are tagged otp — nothing else rides the exemption', () => {
  const otpBearing = [];
  for (const file of senderFiles()) {
    if (/category:\s*'otp'/.test(read(file))) otpBearing.push(file);
  }
  assert.deepEqual(otpBearing.sort(), ['lib/whatsappOtp.js', 'routes/auth.js'],
    'otp is the one category that sends while everything else is stopped; '
    + 'only the sign-in code and the password-reset code may carry it');
});

test('the welcome message the desk switched off is actually gated now', () => {
  const auth = read('routes/auth.js');
  // It was fired on every signup with no check of any kind, which is why turning
  // "رسائل الترحيب" off in the admin panel changed nothing.
  assert.match(auth, /نرحب بك في معهد مهاد للدراسات النفسية[\s\S]{0,200}category: 'welcome'/);
});
