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



test('a lead is never created by an upsert that could land on another institute\'s lead, and no route deletes a lead row', () => {
  const { leadsRouteSource } = require('./_authRouteSource');
  const route = leadsRouteSource();
  assert.doesNotMatch(route, /INSERT INTO leads[\s\S]{0,900}ON DUPLICATE KEY UPDATE name=/);
  assert.doesNotMatch(route, /DELETE FROM leads/, 'a lead is hidden (hidden=1), never deleted');
});


