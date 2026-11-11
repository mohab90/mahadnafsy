'use strict';
/**
 * 11 Nov 2026, the owner: «مش بيظهر كل الخزن المضافة» and «فودافون كاش مصري ظاهر فيه بالريال». The box catalogue read a box as the PROVIDER its name contains, and sent every
 * riyal to the first riyal box listed. These are the pure rules; the screens on a database are in integration/boxListEveryConfiguredBox.integration.test.js.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { CATCH_ALL, boxOf, buildCatalog, currencyOfName, keyOf } = require('../lib/boxCatalog');
const { buildReport } = require('../tools/box-currency-audit.cjs');

test('a box keeps the name it was typed under unless the spelling rules found its specific name', () => {
  const catalog = buildCatalog(['فودافون كاش مصري', 'فودافون كاش السعودية', 'بنك الراجحي', 'فودافون كاش 4645', 'تحويل لأحمد السعودية', 'خزنة الدقي', 'انستا باي'], new Map());
  assert.deepEqual(catalog.entries.map(entry => entry.key),
    ['فودافون كاش مصري', 'فودافون كاش السعودية', 'بنك الراجحي', 'فودافون كاش 4645', 'أحمد السعودية', 'خزنة الدقي - كاش', 'انستا باي']);
  assert.deepEqual(catalog.entries.map(entry => entry.currency), ['EGP', 'SAR', 'SAR', 'EGP', 'SAR', 'EGP', 'EGP']);
});

test('the currency of a box comes from its name: Saudi banks by name, Latin «sar» and «usd» only as words', () => {
  for (const name of ['بنك الراجحي', 'Al Rajhi', 'STC Pay', 'فودافون كاش السعودية', 'Bank SAR']) assert.equal(currencyOfName(name), 'SAR', name);
  for (const name of ['ويسترن يونيون', 'Western Union', 'حساب USD']) assert.equal(currencyOfName(name), 'USD', name);
  for (const name of ['فودافون كاش مصري', 'Nasar wallet', 'Mussard', 'انستا باي 7720']) assert.equal(currencyOfName(name), 'EGP', name);
});

test('riyals go to the listed riyal box their method names; with one riyal box it is that one; with several and no name, «أخرى» — never the first one listed', () => {
  const several = buildCatalog(['فودافون كاش 4645', 'فودافون كاش السعودية', 'تحويل لأحمد السعودية', 'بنك الراجحي'], new Map());
  assert.equal(keyOf('بنك الراجحي', 'SAR', several), 'بنك الراجحي|SAR');
  assert.equal(keyOf('فودافون كاش السعودية', 'SAR', several), 'فودافون كاش السعودية|SAR');
  assert.equal(keyOf('تحويل لأحمد السعودية', 'SAR', several), 'أحمد السعودية|SAR');
  assert.equal(keyOf('فودافون كاش 4645', 'SAR', several), `${CATCH_ALL}|SAR`, 'the Egyptian wallet is never a riyal box');
  const one = buildCatalog(['فودافون كاش 4645', 'تحويل لأحمد السعودية'], new Map());
  assert.equal(keyOf('فودافون كاش 4645', 'SAR', one), 'أحمد السعودية|SAR');
  assert.equal(keyOf(CATCH_ALL, 'SAR', one, { stored: true }), `${CATCH_ALL}|SAR`, 'the catch-all read back as a stored box stays itself');
  assert.deepEqual(boxOf('أي حاجة', 'SAR', buildCatalog(['خزنة الدقي - كاش'], new Map())), { box: CATCH_ALL, currency: 'SAR' }, 'no riyal box at all');
});

test('the audit tool flags riyals on an Egyptian wallet, unlisted names and unlisted stored balances, and says which listed names are one box', () => {
  const report = buildReport({
    listed: ['فودافون كاش 4645', 'فودافون كاش 1010', 'فودافون كاش 1079', 'بنك الراجحي'], aliases: [{ alias: 'فودافون كاش 1010', target: 'فودافون كاش 1079' }],
    payments: [{ method: 'فودافون كاش 4645', currency: 'SAR', rows: 2, amount: '200' }, { method: 'بنك قديم', currency: 'EGP', rows: 1, amount: '77' }, { method: 'بنك الراجحي', currency: 'SAR', rows: 1, amount: 5 }],
    expenses: [], withdrawals: [], openings: [{ method: 'تحويل بنكي', currency: 'EGP', opening_amount: 5 }],
  });
  const codes = report.flags.map(item => item.code).sort();
  assert.deepEqual(codes, ['CURRENCY_MISMATCH', 'SAME_BOX_AS', 'STORED_UNLISTED', 'UNLISTED']);
  const mismatch = report.flags.find(item => item.code === 'CURRENCY_MISMATCH');
  assert.deepEqual([mismatch.method, mismatch.currency, mismatch.amount], ['فودافون كاش 4645', 'SAR', 200]);
  assert.equal(report.payments.find(row => row.method === 'بنك الراجحي').box, 'بنك الراجحي');
});

test('the audit tool refuses to start without explicit database settings', () => {
  const env = { ...process.env };
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) delete env[key];
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'box-currency-audit.cjs')], { env, encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /refusing to run without explicit database settings/);
});
