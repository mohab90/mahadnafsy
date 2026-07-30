'use strict';
/**
 * Unit tests for lib/email htmlEmail — the branded template every lifecycle email
 * is wrapped in. Pure function, no SMTP/DB. Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { htmlEmail, assertRecipientAccepted } = require('../lib/email');

test('htmlEmail wraps content in the branded RTL template', () => {
  const out = htmlEmail('عنوان الاختبار', '<p>محتوى الرسالة</p>');
  assert.equal(typeof out, 'string');
  assert.ok(out.includes('عنوان الاختبار'), 'includes the title');
  assert.ok(out.includes('<p>محتوى الرسالة</p>'), 'includes the body html');
  assert.ok(out.includes('معهد الدراسات النفسية'), 'includes the brand header');
  assert.ok(out.includes('dir="rtl"'), 'is rendered RTL');
});

test('htmlEmail honours a custom brand color override', () => {
  const out = htmlEmail('t', '<p>b</p>', { brandColor: '#123456' });
  assert.ok(out.includes('#123456'), 'uses the overridden brand color');
});

test('SMTP delivery is successful only when the intended recipient is accepted', () => {
  const info = { accepted: ['student@example.com'], rejected: [], messageId: 'm-1' };
  assert.equal(assertRecipientAccepted('STUDENT@example.com', info), info);
  assert.throws(
    () => assertRecipientAccepted('student@example.com', { accepted: [], rejected: ['student@example.com'] }),
    error => error.code === 'EMAIL_RECIPIENT_NOT_ACCEPTED'
  );
  assert.throws(
    () => assertRecipientAccepted('student@example.com', { messageId: 'ambiguous' }),
    /did not accept/
  );
});
