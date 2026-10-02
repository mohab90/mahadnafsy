'use strict';
// «صلح اي مشكله ادامك» — what production's own log showed going wrong on 26 and
// 27 September, and one dead control found on the way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sendRouteError } = require('../lib/helpers');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function fakeRes() {
  return {
    headersSent: false, statusCode: 0, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('an error raised on purpose reaches the desk as itself, not as a server fault', () => {
  // 13 lead saves on 24 September answered «Internal server error» for a lead
  // merged away while someone had it open; the reason was a 404 all along.
  const notFound = Object.assign(new Error('Lead not found'), { statusCode: 404 });
  let res = fakeRes(); sendRouteError(res, notFound);
  assert.deepEqual([res.statusCode, res.body], [404, { error: 'Lead not found' }]);

  const refused = Object.assign(new Error('لا يمكن تعليم الليد كمحوَّل قبل إنشاء العميل'), { statusCode: 409 });
  res = fakeRes(); sendRouteError(res, refused);
  assert.deepEqual([res.statusCode, res.body.error], [409, refused.message]);

  // A real fault still hides its detail.
  res = fakeRes(); sendRouteError(res, new Error('ER_BAD_FIELD_ERROR: secret column'));
  assert.deepEqual([res.statusCode, res.body], [500, { error: 'Internal server error' }]);
});

test('login history can hold the id of the person who signed in', () => {
  // users.id is a UUID and the column was an INT: every successful sign-in was
  // refused ("Incorrect integer value"), 94 times in two days.
  assert.match(read('api/migrations/217_v26_login_history_user_id_is_a_uuid.sql'),
    /ALTER TABLE login_history\s+MODIFY COLUMN user_id VARCHAR\(100\) NULL DEFAULT NULL;/);
});

test('«نقل للأرشيف» on the local tab takes the local tab\'s leads, and only those', () => {
  const route = read('api/routes/admin/leads.js');
  const block = route.slice(route.indexOf("router.post('/api/admin/leads/move-to-archive'"));
  assert.match(block, /const openStatuses = \[\.\.\.LEAD_STATUSES\]\.filter\(isOpenLeadStatus\);/);
  assert.match(block, /COALESCE\(branch,''\) NOT IN \('ONLINE_ABROAD','ONLINE_SAUDI'\) AND COALESCE\(source,''\) NOT LIKE 'دولي%'/);
  assert.match(block, /params\.push\(cairoDayStartUtc\(createdBefore\)\)/);
});

test('«تواصل» on a client row opens that client\'s contact form', () => {
  // It set a row and a draft that no component ever rendered; then it opened
  // the client's page — «ليه في الاونلاين لما بضغط علي زر تواصل بيفتح صفحة
  // العميل». The form opens over the table now.
  const table = read('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx');
  assert.match(table, /title="تواصل" onClick=\{\(\)=>logContact\(row, 'call'\)\}/);
  assert.match(table, /<ClientContactDialog\s/);
  assert.match(read('admin/pages/UnifiedClientPage.tsx'), /addCommunication\?: boolean \} \| null\)\?\.addCommunication\) openContact\(\)/);
  for (const file of ['admin/pages/Dashboard.tsx', 'admin/pages/dashboard/hooks/useSubscriberModals.ts', 'admin/pages/dashboard/tabs/OnlineClientsTab.tsx']) {
    assert.doesNotMatch(read(file), /subContactRow|setSubContactDraft/, `${file} still carries the dead contact state`);
  }
});

test('a role that may not see clients is not sent to fetch them', () => {
  // HR, the accountant and the instructors were refused /staff/subscribers on
  // every page load.
  assert.match(read('admin/pages/dashboard/useStaffOwnData.ts'),
    /hasPermission\(staffRef, 'view_subscribers'\)\s*\?\s*\(async \(\) => \{[\s\S]{0,200}mysqlAdmin\.streamSubscribers\(\{ staff: true \}/);
});
