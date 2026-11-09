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
const { codeOnlyKeepingUrls: codeOnly } = require('./support/repo');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

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




