'use strict';
// HR was granted manage_staff and could not use it: POST /api/admin/staff
// required a super admin, so "أضف موظف" failed for the one role whose job it
// is. Opening the route on the permission is only safe with two guards, and
// these pin both — losing either turns manage_staff into "take over the tenant".
// The server's half — HR creates an employee but no admin, grants nothing it
// lacks, deletes nobody — runs over HTTP in
// tests/integration/staffAndAccounts.integration.test.js. What is left is the screen.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the sales rep can open their own clients tab', () => {
  const shared = fs.readFileSync(
    path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'dashboardShared.tsx'), 'utf8');
  // The sales role holds view_subscribers and not manage_subscribers, and the
  // tab is hardcoded into its nav bar — demanding the latter made a permanently
  // dead button.
  assert.match(shared, /online_clients:\s*'view_subscribers'/);
});
