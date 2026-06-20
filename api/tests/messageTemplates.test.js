'use strict';
/**
 * Unit tests for the WhatsApp message-template engine ({{var}} rendering +
 * custom-over-default resolution). Run: npm run test:unit
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { renderTemplate, setTemplates, TEMPLATE_DEFAULTS } = require('../lib/messageTemplates');

beforeEach(() => setTemplates({}));

test('renders default template with variable substitution', () => {
  const out = renderTemplate('pending_payment_reminder', { amount: 500, currency: 'EGP', date: '2026-06-10' });
  assert.match(out, /500 EGP/);
  assert.match(out, /2026-06-10/);
  assert.ok(!out.includes('{{'), 'no unfilled placeholders remain');
});

test('custom template overrides the default', () => {
  setTemplates({ lead_retargeting: 'أهلاً {{name}} — عرض خاص' });
  assert.equal(renderTemplate('lead_retargeting', { name: 'محمد' }), 'أهلاً محمد — عرض خاص');
});

test('missing variable renders as empty (whitespace-tolerant)', () => {
  setTemplates({ lead_retargeting: 'مرحبا {{ name }}!' });
  assert.equal(renderTemplate('lead_retargeting', {}), 'مرحبا !');
});

test('setTemplates ignores unknown keys and non-string values', () => {
  setTemplates({ not_a_real_key: 'x', lead_retargeting: 123 });
  // unknown key never rendered; numeric value rejected → default kept
  assert.equal(renderTemplate('lead_retargeting', { name: 'A' }), TEMPLATE_DEFAULTS.lead_retargeting.replace('{{name}}', 'A'));
});

test('all four templates have defaults', () => {
  for (const key of ['installment_reminder', 'pending_payment_reminder', 'daqqi_session_reminder', 'lead_retargeting']) {
    assert.equal(typeof TEMPLATE_DEFAULTS[key], 'string');
  }
});
