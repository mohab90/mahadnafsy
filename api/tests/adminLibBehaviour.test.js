'use strict';
/**
 * Admin and shared modules called for real (bundled with the admin's esbuild; see support/repo.js `bundle`), where these rules were regular expressions
 * over the files' source: the panel holds the same two full-access roles as the server; «collected» is one predicate; an old tab address still lands on the
 * screen that holds it; a deleted certificate type stays deleted; the experience ladder the HR filter and the server's SQL share.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bundle } = require('./support/repo');

const permissions = bundle('admin/constants/permissions.ts');
const money = bundle('admin/lib/money.ts');
const aliases = bundle('admin/pages/dashboard/tabUrlAliases.ts');
const catalog = bundle('admin/lib/certificateCatalog.ts');
const labels = bundle('admin/pages/dashboard/tabs/hr-sections/applicantLabels.ts');
const skip = !permissions && 'admin dependencies are not installed here';

test('the server and the panel hold the same two roles as full access', { skip }, () => {
  const server = require('../constants/permissions').FULL_ACCESS_ROLES;
  assert.deepEqual([...server].sort(), ['admin', 'manager']);
  assert.deepEqual([...permissions.FULL_ACCESS_ROLES].sort(), [...server].sort());
});

test('a payment is collected when it is paid, or when it carries no status at all (rows older than the column)', { skip }, () => {
  const { isCollected } = money;
  assert.equal(isCollected({ status: 'paid' }), true);
  assert.equal(isCollected({}), true);
  assert.equal(isCollected({ status: null }), true);
  assert.equal(isCollected(undefined), true);
  for (const status of ['refunded', 'pending', 'failed']) assert.equal(isCollected({ status }), false, status);
});

test('عملائي has its own address, and the old addresses still land on it', { skip }, () => {
  assert.equal(aliases.urlForTab('online_clients'), 'my_clients');
  assert.equal(aliases.urlForTab('leads'), 'leads', 'a tab with no alias is its own address');
  for (const old of ['my_clients', 'subscribers', 'online_clients']) assert.equal(aliases.tabForUrl(old), 'online_clients', old);
  assert.equal(aliases.tabForUrl('analytics'), 'kpi_dashboard', 'a page since merged into a hub');
  assert.equal(aliases.tabForUrl('something_else'), 'something_else', 'an unknown segment is left as it is');
  assert.equal(aliases.tabForUrl(undefined), undefined);
});

test('a deleted certificate stays deleted: the saved map is the list, the defaults only seed an empty one', { skip }, () => {
  const { certificateTypes, DEFAULT_CERT_TYPES } = catalog;
  assert.deepEqual(certificateTypes({}), DEFAULT_CERT_TYPES);
  const saved = { institute: { label: 'شهادة المعهد', egyptianEGP: 1, residentEGP: 1, residentSAR: 1, foreignUSD: 1 }, azhar: { egyptianEGP: 1, residentEGP: 1, residentSAR: 1, foreignUSD: 1 } };
  const types = certificateTypes(saved);
  assert.deepEqual(types.map(type => type.key), ['institute', 'azhar'], 'the other six defaults were deleted and do not come back');
  assert.equal(types.find(type => type.key === 'azhar').label, 'azhar', 'a custom type with no name is named by its code');
});

test('the experience ladder: a minimum is that band and every band above it', { skip }, () => {
  assert.deepEqual(labels.EXPERIENCE_ORDER, ['none', 'under_1', '1-3', '3-5', '5-10', '10plus']);
  assert.equal(labels.matchesMinExperience('5-10', '3-5'), true);
  assert.equal(labels.matchesMinExperience('1-3', '3-5'), false);
  assert.equal(labels.matchesMinExperience('3-5', '3-5'), true);
});
