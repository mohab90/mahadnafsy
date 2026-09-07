'use strict';
// A safety control that is dangerous to switch on is not a control.
//
// EMAIL_OUTBOUND_CATEGORIES exists so the institute can stop marketing mail
// leaving without stopping the mail people need. It is unset on production,
// which means "everything sends" — so the control has never actually been used.
//
// And it could not have been. isEmailCategoryAllowed refuses any send that
// carries no category the moment the variable is set to anything at all, and
// only one of seventeen call sites passed one. Setting it to stop marketing
// would have silenced the password-reset code and the login OTP with it, and
// locked every customer out of their own account.
//
// Each path now names what it is, so the variable can be set to the
// transactional categories alone and do what it was built for.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// The gate itself, lifted out and run rather than described.
function loadGate() {
  const source = read('lib/email.js');
  const fn = source.slice(source.indexOf('function isEmailCategoryAllowed'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  // eslint-disable-next-line no-new-func
  return new Function('process', `${body}\nreturn isEmailCategoryAllowed;`);
}

const withEnv = value => loadGate()({ env: value === undefined ? {} : { EMAIL_OUTBOUND_CATEGORIES: value } });

test('unset still means everything sends, so nothing changes until it is used', () => {
  const allowed = withEnv(undefined);
  for (const category of ['otp', 'payment', 'broadcast', undefined]) {
    assert.equal(allowed(category), true, `${category} should send while the control is unused`);
  }
});

test('setting it refuses a send that does not say what it is', () => {
  // This is the trap: an uncategorised send is refused, not waved through.
  const allowed = withEnv('otp,payment');
  assert.equal(allowed(undefined), false);
  assert.equal(allowed(''), false);
  assert.equal(allowed('otp'), true);
  assert.equal(allowed('broadcast'), false);
});

test('the transactional setting keeps sign-in and receipts working', () => {
  // What the institute would actually set to stop marketing mail.
  const allowed = withEnv('otp,payment,channel_test,staff_alert');
  for (const category of ['otp', 'payment', 'channel_test', 'staff_alert']) {
    assert.equal(allowed(category), true, `${category} must survive`);
  }
  for (const category of ['broadcast', 'crm', 'reminder', 'welcome', 'automation']) {
    assert.equal(allowed(category), false, `${category} must be stopped`);
  }
});

test('the security-critical paths name themselves', () => {
  // Each of these would go silent under any setting if it stayed uncategorised.
  assert.match(codeOnly(read('lib/otpProvider.js')),
    /sendEmail\(email, subject, html, \{ tenantId, category: 'otp' \}\)/,
    'the login code');
  assert.match(codeOnly(read('routes/auth.js')),
    /sendEmailBase\(to, subject, html, \{ tenantId: req\.tenantId, category: 'otp' \}\)/,
    'the password-reset code');
  assert.match(codeOnly(read('routes/subscriber-payments.js')),
    /category: 'payment'/, 'the payment receipt');
  assert.match(codeOnly(read('routes/public-orders.js')),
    /\{ tenantId, category: 'payment' \}/, 'the order confirmation');
  assert.match(codeOnly(read('routes/config.js')),
    /category: 'channel_test'/, 'the button that proves the channel works');
});

test('the staff alerts are separable from customer mail', () => {
  const source = codeOnly(read('routes/admin-utils.js'));
  assert.equal((source.match(/category: 'staff_alert'/g) || []).length, 4,
    'all four internal notifications must be categorised');
});

test('WhatsApp already had this and is the model being matched', () => {
  // Production sets WHATSAPP_OUTBOUND_CATEGORIES=otp,inbox_reply,channel_test,
  // which is why that channel is genuinely restricted today and email is not.
  const whatsapp = codeOnly(read('lib/whatsapp.js'));
  assert.match(whatsapp, /WHATSAPP_OUTBOUND_CATEGORIES/);
  assert.match(whatsapp, /OUTBOUND_ALLOW_ALL/);
});
