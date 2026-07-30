'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'analytics', 'financial.js'), 'utf8');

test('recurring-expenses cron only auto-posts frequency=monthly items (CFG-03)', () => {
  // Before this fix, day_of_month + "not run this month" fired for EVERY
  // frequency (weekly/quarterly/yearly included), posting a real monthly
  // expense regardless of the template's actual cadence.
  const cronWindow = route.slice(route.indexOf('Cron: auto-create expenses'), route.indexOf('module.exports') === -1 ? route.length : route.indexOf('module.exports'));
  assert.match(cronWindow, /WHERE deleted_at IS NULL AND is_active=1 AND frequency='monthly'[\s\S]{0,100}day_of_month=\?/);
  assert.match(cronWindow, /WHERE id=\? AND tenant_id=\? AND deleted_at IS NULL AND is_active=1[\s\S]{0,100}frequency='monthly'/);
});

test('recurring-expenses CRUD routes are tenant-scoped', () => {
  assert.match(route, /router\.get\s*\(\s*'\/api\/admin\/recurring-expenses'/);
  assert.match(route, /FROM recurring_expenses[\s\S]{0,120}WHERE tenant_id=\? AND deleted_at IS NULL/);
  assert.match(route, /INSERT INTO recurring_expenses[\s\S]{0,100}\(id,tenant_id/);
  assert.match(route, /UPDATE recurring_expenses[\s\S]{0,300}tenant_id=\?/);
  assert.match(route, /SET deleted_at=NOW\(\), is_active=0[\s\S]{0,100}tenant_id=\?/);
});
