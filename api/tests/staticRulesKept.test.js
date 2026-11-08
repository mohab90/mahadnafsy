'use strict';
/**
 * The few rules that stay as readings of the source, because no call can reach them: each is a thing that must NOT be written (a statement, a
 * dependency, a mutable loop), and a behaviour test can only show the absence of a bug it already has a case for. Everything else that used to
 * be pinned here by regular expression is a behaviour test (see docs/BEHAVIOUR_TESTS_AR.md for where each rule went).
 *
 * Add to this file only a rule of that kind, with the reason. Tenant scoping of a query is not one: the quality gate holds it
 * (tools/tenant-scope-scan.mjs, «tenant-scope violations», baseline 0).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./support/repo');

test('drip delivery goes through the outbox in the enrolment\'s own transaction, once per step', () => {
  const service = read('api/lib/dripCampaigns.js');
  assert.match(service, /outbox\.enqueue\([\s\S]*\}, conn\)/);
  assert.match(service, /const dedupeKey = `drip:\$\{enrollment\.tenant_id\}:\$\{enrollment\.id\}:\$\{enrollment\.current_step\}`/);
  assert.doesNotMatch(read('api/routes/analytics/campaigns.js'), /setInterval\(/, 'a route does not start its own timer');
});

test('a lead is never created by an upsert that could land on another institute\'s lead, and no route deletes a lead row', () => {
  const { leadsRouteSource } = require('./_authRouteSource');
  const route = leadsRouteSource();
  assert.doesNotMatch(route, /INSERT INTO leads[\s\S]{0,900}ON DUPLICATE KEY UPDATE name=/);
  assert.doesNotMatch(route, /DELETE FROM leads/, 'a lead is hidden (hidden=1), never deleted');
});

test('payments are never taken from a subscriber save: the CRM JSON carries no payment history', () => {
  const subscribers = read('api/routes/admin/subscribers.js');
  assert.match(subscribers, /Payments are never accepted through subscriber CRM JSON/);
  assert.doesNotMatch(subscribers, /\[payment-sync\]/);
});
