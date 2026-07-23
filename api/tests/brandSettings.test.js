'use strict';
/**
 * Behavioral tests for lib/brandSettings.js#getBrandSettings — the shared
 * source for branding on emails/certificates/public pages (ARC-07). The SaaS
 * setup wizard's logo uploader (routes/branding-assets.js) saves into the
 * 'sys_general' tenant-settings section, while this previously only read
 * 'content' — a tenant onboarded purely through the wizard never saw their
 * own logo appear anywhere. Uses a mock connection, no real DB.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { getBrandSettings, DEFAULT_BRAND } = require('../lib/brandSettings');

function mockDb(bySection) {
  return {
    async query(_sql, params) {
      const section = params[1];
      const row = bySection[section];
      return [row ? [{ config_json: JSON.stringify(row) }] : []];
    },
  };
}

test('getBrandSettings: sys_general.brand_logo_url overrides content institute.logo when both are set', async () => {
  const db = mockDb({
    content: { 'institute.name': 'Test Institute', 'institute.logo': 'https://old-content-logo.example/logo.png' },
    sys_general: { brand_logo_url: 'https://wizard-uploaded-logo.example/logo.png' },
  });
  const brand = await getBrandSettings('tenant-brand-test-1', db);
  assert.equal(brand.logoUrl, 'https://wizard-uploaded-logo.example/logo.png', 'the newer SaaS wizard upload must win over the legacy content key');
  assert.equal(brand.instituteName, 'Test Institute', 'other content-derived fields must be unaffected');
});

test('getBrandSettings: falls back to content institute.logo when sys_general has no logo saved', async () => {
  const db = mockDb({
    content: { 'institute.logo': 'https://old-content-logo.example/logo.png' },
    sys_general: {},
  });
  const brand = await getBrandSettings('tenant-brand-test-2', db);
  assert.equal(brand.logoUrl, 'https://old-content-logo.example/logo.png');
});

test('getBrandSettings: falls back to DEFAULT_BRAND.logoUrl when neither section has one', async () => {
  const db = mockDb({ content: {}, sys_general: {} });
  const brand = await getBrandSettings('tenant-brand-test-3', db);
  assert.equal(brand.logoUrl, DEFAULT_BRAND.logoUrl);
});
