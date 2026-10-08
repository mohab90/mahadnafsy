'use strict';

// «ليه اصلا اسم هنا مش بيظهر وبيظهر الايميل؟ … اسم الموظف اللى يظهر مش الايميل
// ابدا» (8 Oct 2026): «فتح كورس · بواسطة hana@mahadnafsy.com».

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_EMAILS = 'owner@example.test';
const { signerName, staffDirectory, staffNames } = require('../lib/staffNames');

const db = {
  async query() {
    return [[
      { id: 'st-hana', name: 'هنا', email: 'hana@example.test' },
      { id: 'st-walid', name: 'وليد', email: 'walid@example.test' },
    ]];
  },
};

test('an id or an address reads as the name; the owner as الإدارة; nobody\'s address never shows', async () => {
  const names = await staffNames('t', ['st-hana', 'Walid@Example.test', 'owner@example.test', 'left@example.test', 'هنا', 'system'], db);
  assert.equal(names.get('st-hana'), 'هنا');
  assert.equal(names.get('Walid@Example.test'), 'وليد');
  assert.equal(names.get('owner@example.test'), 'الإدارة');
  assert.equal(names.get('left@example.test'), 'موظف سابق');
  assert.equal(names.get('هنا'), 'هنا', 'already a name');
  assert.equal(names.get('system'), 'النظام');
  for (const shown of names.values()) assert.doesNotMatch(shown, /@/);
});

test('the directory resolves a long list without a query each', async () => {
  let queries = 0;
  const counting = { query: async (...args) => { queries += 1; return db.query(...args); } };
  const resolve = await staffDirectory('t-dir', counting);
  assert.equal(resolve('hana@example.test'), 'هنا');
  assert.equal(resolve('owner@example.test'), 'الإدارة');
  await staffDirectory('t-dir', counting);
  assert.equal(queries, 1, 'read once a minute');
});

test('a row being written is signed with a name', () => {
  assert.equal(signerName({ staffRecord: { name: 'هنا' }, user: { email: 'hana@example.test' } }), 'هنا');
  assert.equal(signerName({ isSuperAdmin: true, user: { email: 'owner@example.test' } }), 'الإدارة');
  assert.doesNotMatch(signerName({ user: { email: 'x@example.test' } }), /@/);
});
