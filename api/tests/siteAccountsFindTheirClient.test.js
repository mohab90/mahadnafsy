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

test('migration 352 makes a client\'s number comparable by its digits, indexed', () => {
  const sql = read('migrations/352_v26_subscriber_phone_digits.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS phone_digits VARCHAR\(64\) AS \(REGEXP_REPLACE\(phone,'\[\^0-9\]',''\)\) VIRTUAL/);
  assert.match(sql, /ADD INDEX IF NOT EXISTS idx_subs_tenant_phone_digits \(tenant_id, phone_digits\)/);
});

test('the resolver matches the number by digits, and adopts a record whose account has vanished', async () => {
  const source = read('lib/subscriberIdentity.js');
  assert.match(source, /s\.phone_digits IN \(\$\{placeholders\}\)/);
  assert.doesNotMatch(source, /s\.phone IN \(/, 'the exact-spelling list is gone');
  // Email and number alike: a record held by another LIVE account is not taken, one whose account no longer exists is.
  assert.equal((source.match(/NOT EXISTS \(SELECT 1 FROM users lu WHERE lu\.id = s\.firebase_uid/g) || []).length, 2);
  assert.match(source, /NOT EXISTS \(SELECT 1 FROM users lu WHERE lu\.id = firebase_uid AND lu\.tenant_id = subscribers\.tenant_id\)\)`/, 'and the link is written back');

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
  assert.match(tool, /const APPLY = process\.argv\.includes\('--apply'\);/);
  assert.match(tool, /const NAMES = process\.argv\.includes\('--include-name-match'\);/);
  assert.match(tool, /if \(NAMES\) claim\('name', account, nameMatches\[0\]\);\s+else links\.name\.push\(\{ account, client: nameMatches\[0\], pending: true \}\);/, 'a name is a judgement: listed unless asked for');
  assert.match(tool, /Number\(account\.email_unverified\) === 1 \? '' :/, 'an email still waiting to be proven matches nobody');
  assert.match(tool, /fs\.writeFileSync\(backup,/);
  assert.doesNotMatch(tool, /\b(DELETE|DROP|TRUNCATE)\b/);
  assert.doesNotMatch(tool, /INSERT INTO/);
  assert.match(tool, /AND \(firebase_uid IS NULL OR firebase_uid = ''/, 'a record taken in the meantime is left alone');
});
