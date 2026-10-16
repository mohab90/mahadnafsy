'use strict';
/**
 * «في صفحة العملاء المحتملين في المصادر في كمية كبيرة مكررة وملهاش لزمة» (16 Oct 2026).
 * The filter listed every spelling of a source — «فيسبوك», «Facebook», «facebook », «FB» — as its own line.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { leadTableFilter } = require('../lib/leadTableFilter');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const { sourceKey, groupSources } = (() => {
  const js = require('node:module').stripTypeScriptTypes(read('shared/leadSources.ts')).replace(/^export /gm, '');
  const module_ = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', `${js}\nmodule.exports = { sourceKey, groupSources };`)(module_, module_.exports);
  return module_.exports;
})();

test('spellings of one source are one source', () => {
  const facebook = ['فيسبوك', 'Facebook', 'facebook ', 'FB', 'فيس بوك', 'Face-book', 'FACEBOOK'];
  assert.equal(new Set(facebook.map(sourceKey)).size, 1, 'one key for the facebook spellings');
  assert.equal(sourceKey('واتساب'), sourceKey('WhatsApp'));
  assert.equal(sourceKey('إنستغرام'), sourceKey('instagram'));
  assert.equal(sourceKey('جوجل'), sourceKey('Google'));
  assert.equal(sourceKey('الموقع'), sourceKey('website'));
  assert.equal(sourceKey('  '), '');
});

test('a different word stays a different source', () => {
  assert.notEqual(sourceKey('فيسبوك'), sourceKey('فيسبوك ليدز'), 'a sheet named after it is its own source');
  assert.notEqual(sourceKey('الصحة النفسية'), sourceKey('فيسبوك'));
  assert.notEqual(sourceKey('دفعة قديمة'), sourceKey('دفعة جديدة'));
  assert.notEqual(sourceKey('Leads 1'), sourceKey('Leads 2'));
});

test('the groups are one line per source, with the CRM\'s own spelling and the biggest first', () => {
  const groups = groupSources({ فيسبوك: 1, Facebook: 2, 'facebook ': 1, FB: 1, واتساب: 9, 'دفعة قديمة': 3 }, ['فيسبوك', 'واتساب']);
  assert.deepEqual(groups.map(group => [group.name, group.total]), [['واتساب', 9], ['فيسبوك', 5], ['دفعة قديمة', 3]]);
  assert.equal(groups[1].variants.length, 4);
});

test('picking one line filters on all its spellings, on the server and in the browser', () => {
  const where = leadTableFilter({ salesSource: 'فيسبوك||Facebook||FB' }, { today: '2026-10-16', salesOnly: true });
  const text = JSON.stringify(where);
  assert.match(text, /l\.source IN \(\?,\?,\?\)/);
  assert.ok(['فيسبوك', 'Facebook', 'FB'].every(name => text.includes(name)));
  const single = JSON.stringify(leadTableFilter({ salesSource: 'واتساب' }, { today: '2026-10-16', salesOnly: true }));
  assert.match(single, /l\.source = \?/, 'one spelling still filters on equality');

  const hook = read('admin/pages/dashboard/tabs/leads/useLeadFilteringData.ts');
  assert.match(hook, /salesSourceFilter\.split\('\|\|'\)\.includes\(lead\.source \|\| ''\)/);
  const bar = read('admin/pages/dashboard/tabs/leads/LeadFilterBar.tsx');
  assert.match(bar, /groupSources\(/);
  assert.match(bar, /group\.variants\.map\(variant => variant\.name\)\.join\('\|\|'\)/);
});

test('managers can make the spellings one source for good, and adding a second spelling is refused', () => {
  const write = read('api/routes/admin/leads/write.js');
  const route = write.slice(write.indexOf("'/api/admin/leads/merge-sources'"));
  assert.match(route, /\['admin', 'manager'\]\.includes/);
  assert.match(route, /UPDATE leads SET source=\? WHERE tenant_id=\? AND source IN \(\?\)/);
  assert.match(route, /lead\.sources_merged/);
  const modal = read('admin/pages/dashboard/tabs/CrmSettingsModal.tsx');
  assert.match(modal, /sourceKey\(existing\) === sourceKey\(s\)/);
  assert.match(modal, /\/admin\/leads\/merge-sources/);
});
