'use strict';
// HR was granted manage_staff and could not use it: POST /api/admin/staff
// required a super admin, so "أضف موظف" failed for the one role whose job it
// is. Opening the route on the permission is only safe with two guards, and
// these pin both — losing either turns manage_staff into "take over the tenant".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'staff.js'), 'utf8');

test('creating staff is gated on manage_staff, not on being the owner', () => {
  assert.match(route, /router\.post\('\/api\/admin\/staff',[^)]*requirePermission\('manage_staff'\)/);
  assert.doesNotMatch(route, /router\.post\('\/api\/admin\/staff', requireAuth, requireSuperAdmin/);
});

test('a non-owner cannot mint a role above their own', () => {
  assert.match(route, /PRIVILEGED_ROLES\s*=\s*\['ADMIN', 'MANAGER'\]/);
  assert.match(route, /!req\.isSuperAdmin && PRIVILEGED_ROLES\.includes\(role\)/);
});

test('a non-owner cannot grant a permission they do not hold', () => {
  assert.match(route, /resolvePermissions\(req\.staffRecord\)/);
  assert.match(route, /overreach/);
});

test('deleting staff and setting passwords stay with the owner', () => {
  // Opening creation is a considered widening; these are not part of it.
  assert.match(route, /router\.delete\('\/api\/admin\/staff\/:id', requireAuth, requireSuperAdmin/);
});

test('the sales rep can open their own clients tab', () => {
  const shared = fs.readFileSync(
    path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'dashboardShared.tsx'), 'utf8');
  // The sales role holds view_subscribers and not manage_subscribers, and the
  // tab is hardcoded into its nav bar — demanding the latter made a permanently
  // dead button.
  assert.match(shared, /online_clients:\s*'view_subscribers'/);
});
