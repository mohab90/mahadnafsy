'use strict';
/**
 * Two dashboard keys rendered a component another key already rendered with the
 * same props, so the same page answered to two URLs. The two that remain paired
 * are not duplicates and this pins that distinction, so the next cleanup does
 * not take a real screen with it. Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const REMOVED = ['staff_management', 'staff_applications'];
const FILES = [
  'admin/pages/dashboard/navigation.tsx',
  'admin/pages/dashboard/dashboardShared.tsx',
  'admin/pages/dashboard/dashboardTabGroups.ts',
  'admin/pages/dashboard/GeneralDashboardTabs.tsx',
  'admin/pages/dashboard/tabs/BranchWorkspacesTab.tsx',
];

test('the two duplicate keys are gone from every place that named them', () => {
  // staff_management rendered HrTab with no props, exactly as 'hr' does;
  // staff_applications rendered JoinUsAdminTab with initialType 'all', exactly
  // as 'join_us' does.
  for (const file of FILES) {
    const code = codeOnly(read(file));
    for (const key of REMOVED) {
      assert.ok(!code.includes(key), `${file} still names ${key}`);
    }
  }
});

test('nothing navigates to a key that no longer routes', () => {
  const profile = read('admin/pages/StaffProfile.tsx');
  assert.ok(!profile.includes('/dashboard/staff_management'),
    'the staff profile had three links into the removed key');
  assert.equal((profile.match(/\/dashboard\/hr/g) || []).length, 3,
    'all three now point at the key that survives');
});

test('the two keys that share a component are kept, because they are not duplicates', () => {
  const tabs = read('admin/pages/dashboard/GeneralDashboardTabs.tsx');
  // Same component, different props: one filters to instructor applications.
  assert.ok(tabs.includes("activeTab === 'lecturer_applications'"));
  assert.ok(tabs.includes('initialType="instructor"'));
  // And one scopes the finance screen to a branch.
  assert.ok(tabs.includes("{ key: 'daqqi_accounting', Component: FinancialTab, branchFilter: 'daqqi'"));
  // Both are real menu entries, unlike the two that were removed.
  const nav = read('admin/pages/dashboard/DashboardNavigation.tsx');
  assert.ok(nav.includes("key: 'daqqi_accounting'"));
});
