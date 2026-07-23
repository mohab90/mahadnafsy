'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'payments-admin.js'), 'utf8');

test('commissions/monthly is tenant-scoped (previously leaked every tenant\'s commission data to any authenticated admin)', () => {
  assert.match(route, /WHERE c\.tenant_id = \? AND DATE_FORMAT/);
  assert.match(route, /const params = \[req\.tenantId, from\];/);
});

test('the broken, unscoped, zero-caller export/orders route was removed rather than patched over', () => {
  assert.doesNotMatch(route, /router\.get\('\/api\/admin\/export\/orders'/);
  assert.doesNotMatch(route, /o\.order_number/);
  assert.doesNotMatch(route, /o\.user_id/);
  assert.doesNotMatch(route, /s\.enrolled_course_ids/);
});
