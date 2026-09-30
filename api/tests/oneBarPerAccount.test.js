'use strict';

// «على حساب مدير الدقي باسم نشوى بيظهر منيو فوق … المفروض دي تتشال» and «خلي
// نمط التصميم واحد لكل الموظفين باختلاف صلاحيتهم». The Dokki manager and the
// sales and collection manager got the whole panel's groups on top of their
// own bar; every bar is now drawn the way the management bar is.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const nav = fs.readFileSync(path.join(__dirname, '..', '..', 'admin/pages/dashboard/DashboardNavigation.tsx'), 'utf8');

test('an account with a bar of its own sees that bar and not the management one', () => {
  assert.ok(nav.includes('const hasRoleBar = isSalesOnly || isCollectionRole || (isReceptionDaqqi && !isDaqqiManager)'));
  assert.ok(nav.includes('|| ((isDaqqiManager || isSalesCollectionManager || isOnlineManager) && !isAdmin);'),
    'the Dokki manager and the sales and collection manager are among them');
  assert.ok(nav.includes('{!hasRoleBar && ('), 'the management bar is drawn only without one');
});

test('every bar is drawn one way', () => {
  const roleBar = nav.slice(nav.indexOf('function CompactRoleNav('), nav.indexOf('export function DashboardNavigation('));
  assert.ok(roleBar.includes('<BrandMark />'), 'the institute\'s mark, as on the management bar');
  assert.ok(roleBar.includes('className={barButtonClass(activeTab === tab.key)}'), 'the management bar\'s buttons');
  assert.ok(nav.includes('className={barButtonClass(hasActive || isOpen)}'), 'which the management bar uses too');
  for (const leftover of ['activeButtonClass', 'avatarClass', 'roleBadge', 'bg-purple-600', 'shadow-emerald-200', 'shadow-indigo-200']) {
    assert.ok(!nav.includes(leftover), `a bar still has its own colours: ${leftover}`);
  }
});
