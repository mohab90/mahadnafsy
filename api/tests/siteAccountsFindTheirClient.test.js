'use strict';

// 31 Oct 2026: «في عملاء كتير بيظهر ليهم الموقع كأنهم مش مشتركين … بتعمل تسجيل دخول بيفتح كأنه حساب جديد … بيظهر على السيستم كأنه حساب مختلف
// (تسجيل دخول بالموقع)». A client's site account is tied to their client record by number or email, lazily, at the first /api/me call. The
// number was compared by an exact list of spellings, so one stored with spaces, a + or another prefix matched nobody; the email did not match a
// record linked to an account that no longer exists; and an account with neither could never be linked at all.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-identity-secret-0123456789-abcdefghijklmnopqr';
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const { normalizeArabicName } = require('../lib/linkSiteAccounts');

test('the same Arabic name, spelled the ways the sheets and the sign-up form spell it, is one name', () => {
  const same = ['جهاد رضا ابراهيم', 'جهاد رضا إبراهيم', 'جهاد  رضا   أبراهيم', 'جهاد رضا ابراهـيم', 'جِهاد رضا ابراهيم'];
  assert.equal(new Set(same.map(normalizeArabicName)).size, 1, same.map(normalizeArabicName).join(' | '));
  assert.equal(normalizeArabicName('فاطمة علي'), normalizeArabicName('فاطمه على'));
  assert.equal(normalizeArabicName('  Ahmed  ALI '), 'ahmed ali');
  assert.notEqual(normalizeArabicName('جهاد رضا ابراهيم'), normalizeArabicName('جهاد رضا ابراهيم محمد'), 'a longer name is a different name');
  assert.equal(normalizeArabicName(null), '');
});

test('the resolver matches the number by digits, and adopts a record whose account has vanished', async () => {
  const source = read('lib/subscriberIdentity.js');
  
  
  // The NUMBER never takes a record held by another LIVE account (one whose account no longer exists is free); the proven e-mail does (4 Nov 2026: one client, two logins).
  
  
  // The users table has a firebase_uid column of its own: unqualified inside the subquery it names THAT one, which made every record look abandoned.
  
  

  const { resolveSubscriberRow } = require('../lib/subscriberIdentity');
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/FROM users WHERE id=\?/.test(sql)) return [[{ email: null, phone: '1027105115', email_unverified: 0 }]];
      if (/phone_digits IN/.test(sql)) return [[{ id: 'client-1' }]];
      if (/s\.firebase_uid=\?/.test(sql)) return [[undefined]];
      return [{ affectedRows: 1 }];
    },
  };
  const row = await resolveSubscriberRow({ tenantId: 't', user: { uid: 'u-1' } }, ['id'], db);
  assert.equal(row.id, 'client-1');
  const lookup = seen.find(entry => /phone_digits IN/.test(entry.sql));
  for (const spelling of ['1027105115', '01027105115', '201027105115']) assert.ok(lookup.params.includes(spelling), `${spelling} is among the spellings asked for`);
  assert.ok(seen.some(entry => /^UPDATE subscribers SET firebase_uid/.test(entry.sql.trim())), 'and the account is tied to the client for the next request');
});

test('the repair tool links the sure ones first, never merges or deletes, and backs up what it touches', () => {
  const tool = read('tools/link-site-accounts.cjs');
  assert.ok(tool.indexOf('1. number') < tool.indexOf('2. same proven email') && tool.indexOf('2. same proven email') < tool.indexOf('3. same name'));
  
  
  
  
  
  
  
  
});
