'use strict';

// «متابعات السيلز» existed twice — opened from the leads tab and from the
// dashboard — and the two did not agree about whose follow-ups you see:
//
//   the leads tab   scoped on isSalesOnly, so a collection officer, support and
//                   reception each saw every sales rep's follow-up list
//   the dashboard   scoped on isNonAdminStaff to salesOwnLeads, the list the
//                   server already narrowed, and answered an empty array when
//                   currentStaff was null
//
// That second branch mattered more than it looks: currentStaff came from a
// staffMembers array that GET /api/admin/staff only fills for the four roles
// holding view_staff, so for ten roles of sixteen the dashboard's drawer showed
// nothing at all.
//
// One drawer now, with the server-scoped rule, and it reads who is signed in
// from the context rather than from a role name a caller guessed at.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROLE_PERMS } = require('../constants/permissions');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

const DRAWER = 'admin/pages/dashboard/tabs/leads/LeadSalesNotificationsPanel.tsx';

test('there is one follow-up drawer, and both screens open it', () => {
  assert.ok(!exists('admin/pages/dashboard/DashboardSalesFollowupPanel.tsx'),
    'the second copy is back, and the two will disagree again');

  for (const rel of ['admin/pages/Dashboard.tsx', 'admin/pages/dashboard/tabs/leads/LeadModalsHost.tsx']) {
    assert.match(codeOnly(read(rel)), /<LeadSalesNotificationsPanel/, `${rel} does not open the shared drawer`);
  }

  // Both hand it the same two lists, so the component can apply one rule.
  for (const rel of ['admin/pages/Dashboard.tsx', 'admin/pages/dashboard/tabs/leads/LeadModalsHost.tsx']) {
    const source = codeOnly(read(rel));
    assert.match(source, /salesOwnLeads=\{/, `${rel} does not pass the server-scoped list`);
  }
});

test('it scopes on what the server narrowed, not on a role name', () => {
  const drawer = codeOnly(read(DRAWER));

  // The surviving rule.
  assert.match(drawer, /const isNonAdminStaff = !isAdmin && !!currentStaff;/);
  assert.match(drawer, /const scopedLeads = \(isNonAdminStaff \? salesOwnLeads : leads\)/);

  // Not the one that only recognised sales.
  assert.ok(!drawer.includes("isSalesOnly && currentStaff"),
    'scoping on isSalesOnly shows every rep\'s follow-ups to collection, support and reception');
  // And not the one that answered nothing when it could not identify you.
  assert.ok(!drawer.includes(': [];'),
    'an unrecognised role gets an empty drawer rather than their own list');

  // Who it is comes from the context, which is the one place that knows.
  assert.match(drawer, /const \{ isAdmin \} = useSiteData\(\);/);

  // The premise: view_staff really is a minority, which is why a screen must
  // not depend on the staff list to learn who is using it.
  const holders = Object.entries(ROLE_PERMS)
    .filter(([, perms]) => perms !== '*' && perms.includes('view_staff'))
    .map(([role]) => role);
  assert.deepEqual(holders.sort(), ['daqqi_manager', 'hr', 'online_manager', 'sales_collection_manager']);
  const total = Object.keys(ROLE_PERMS).length;
  assert.ok(holders.length * 3 < total, `expected view_staff to be a minority of ${total} roles`);
});
