'use strict';
/** «كل عميل جديد لازم يروح لموظف تحصيل جديد، ولازم يكون فى فلتر المسئول اسمه بدون مسئول تحصيل» (15 Oct 2026). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { sanitizeCollectionConfig } = require('../lib/collectionDistribution');
const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

test('the new-client officer is kept by the settings, and only as an id', () => {
  assert.equal(sanitizeCollectionConfig({ members: [], newClientOfficerId: ' st-1 ' }).newClientOfficerId, 'st-1');
  assert.equal(sanitizeCollectionConfig({}).newClientOfficerId, '');
  assert.equal(sanitizeCollectionConfig({ newClientOfficerId: 'x'.repeat(200) }).newClientOfficerId.length, 64);
});

test('the four paths that make a client all ask the one picker, which honours him first', () => {
  for (const file of ['api/routes/subscriber-payments.js', 'api/routes/admin/subscribers.js', 'api/routes/admin/leads/convert.js']) {
    assert.match(read(file), /pickCollectionOfficer/, file);
  }
  const lib = read('api/lib/collectionDistribution.js');
  assert.ok(lib.indexOf('config.newClientOfficerId') < lib.indexOf('loadCollectionPicker(db, tenantId);\n  const officer'), 'ahead of the rotation');
});

test('the settings screen picks him and the table can show who has no collection officer', () => {
  assert.match(read('admin/pages/dashboard/tabs/online-clients-sections/CollectionSettingsModal.tsx'), /موظف «التحصيل الجديد»/);
  assert.match(read('admin/pages/dashboard/tabs/online-clients-sections/FiltersToolbar.tsx'), /بدون مسئول تحصيل/);
  assert.match(read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx'), /collOnlineCollectionFilter === NO_COLLECTOR/);
});
