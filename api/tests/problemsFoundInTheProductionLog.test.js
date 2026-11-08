'use strict';
const { leadsRouteSource } = require('./_authRouteSource');
// «صلح اي مشكله ادامك» — what production's own log showed going wrong on 26 and
// 27 September, and one dead control found on the way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sendRouteError } = require('../lib/helpers');
const { ROOT, read } = require('./support/repo');


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

test('«نقل للأرشيف» on the local tab takes the local tab\'s leads, and only those', () => {
  const route = leadsRouteSource();
  const block = route.slice(route.indexOf("router.post('/api/admin/leads/move-to-archive'"));
  assert.match(block, /const openStatuses = \[\.\.\.LEAD_STATUSES\]\.filter\(isOpenLeadStatus\);/);
  assert.match(block, /COALESCE\(branch,''\) NOT IN \('ONLINE_ABROAD','ONLINE_SAUDI'\) AND COALESCE\(source,''\) NOT LIKE 'دولي%'/);
  assert.match(block, /params\.push\(cairoDayStartUtc\(createdBefore\)\)/);
});




