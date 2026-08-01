'use strict';
// A WhatsApp blast cannot be recalled, so the parts that decide *what* is sent
// and *to whom* are pinned here. Audience building needs a database and is
// covered by the route; template rendering is pure and is where a mistake
// reaches every recipient at once.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  renderTemplate, templateVariables, MIN_THROTTLE, MAX_THROTTLE, MAX_RECIPIENTS,
} = require('../lib/whatsappCampaigns');

test('placeholders are filled from the recipient', () => {
  assert.equal(
    renderTemplate('أهلاً {{name}}، كودك {{clientCode}}', { name: 'أحمد', clientCode: 'DQ-0007' }),
    'أهلاً أحمد، كودك DQ-0007'
  );
});

test('a missing value collapses instead of leaving literal braces', () => {
  // "أهلاً {{name}}" arriving on a customer's phone is worse than "أهلاً".
  assert.equal(renderTemplate('أهلاً {{name}}', {}), 'أهلاً');
  assert.equal(renderTemplate('أهلاً {{name}}', { name: null }), 'أهلاً');
  assert.equal(renderTemplate('أهلاً {{name}}', { name: undefined }), 'أهلاً');
});

test('an unknown placeholder does not survive into the message', () => {
  const out = renderTemplate('مرحباً {{nope}} بك', {});
  assert.ok(!out.includes('{{'), `placeholder leaked: ${out}`);
  assert.ok(!out.includes('nope'), `placeholder name leaked: ${out}`);
});

test('whitespace inside the braces is tolerated', () => {
  assert.equal(renderTemplate('{{ name }}', { name: 'سارة' }), 'سارة');
});

test('the same placeholder repeats correctly', () => {
  assert.equal(renderTemplate('{{name}} و {{name}}', { name: 'علي' }), 'علي و علي');
});

test('a template with no placeholders passes through unchanged', () => {
  assert.equal(renderTemplate('عرض خاص لفترة محدودة', {}), 'عرض خاص لفترة محدودة');
});

test('empty and non-string templates render to an empty string', () => {
  // queueCampaign skips empty renders — a blank WhatsApp message is worse than
  // no message, so this must be reliably falsy rather than " ".
  for (const bad of ['', null, undefined, '   ']) {
    assert.equal(renderTemplate(bad, { name: 'x' }), '');
  }
});

test('a value containing braces cannot inject another placeholder', () => {
  // The substitution must not re-scan its own output, or a customer named
  // "{{clientCode}}" would receive somebody else's data.
  const out = renderTemplate('أهلاً {{name}}', { name: '{{clientCode}}', clientCode: 'SECRET' });
  assert.equal(out, 'أهلاً {{clientCode}}');
  assert.ok(!out.includes('SECRET'), 'a recipient value must never be re-expanded');
});

test('templateVariables lists each placeholder once, in order', () => {
  assert.deepEqual(
    templateVariables('{{name}} {{clientCode}} {{name}} {{status}}'),
    ['name', 'clientCode', 'status']
  );
  assert.deepEqual(templateVariables('لا يوجد متغيرات'), []);
  assert.deepEqual(templateVariables(''), []);
});

test('throttle bounds keep a campaign inside provider-safe pacing', () => {
  assert.ok(MIN_THROTTLE >= 1, 'a zero rate would never send');
  assert.ok(MAX_THROTTLE <= 600, 'above ~10/second a number gets banned');
  assert.ok(MIN_THROTTLE < MAX_THROTTLE);
});

test('the recipient cap is bounded', () => {
  // The cap bounds both the blast radius of a mistake and the memory held
  // while the audience is assembled.
  assert.ok(MAX_RECIPIENTS > 0 && MAX_RECIPIENTS <= 100000);
});
