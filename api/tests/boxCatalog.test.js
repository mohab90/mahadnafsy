'use strict';
/**
 * 3 Nov 2026, «فودافون كاش 4645 2,316 SAR مينفعش … عملة الريال لازم تكون على حساب أحمد السعودية وهو مش ظاهر … خلي اي خزنه مضافه في السيسيتم تظهر في الخزن حتى لو رصيدها
 * صفر … واي خزنه مش مضافه جمع فلوسها في اخرى … مضيفش خزن من نفسك … ويسترن بالدولار وتحويل احمد السعودية بالريال الباقي كله بالجنيه».
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CATCH_ALL, boxOf, buildCatalog, currencyOfName, keyOf } = require('../lib/boxCatalog');

const LISTED = [
  'خزنة الدقي - كاش', 'انستا باي 7720', 'انستا باي 6046', 'فيزا الدقي', 'فودافون كاش 2020', 'فودفوان كاس 1010', 'فودافون كاش 2526', 'فودافون كاش 7711',
  'فودافون كاش  7722', 'فودافون كاش  4645', 'محفظة وي 7720', 'اورانج ماني 7720', 'ويسترن يونيون', 'تحويل لأحمد السعودية',
  'تحويل او ايداعي بنكي في مصر', 'تحويل او ايداعي بنكي من خارج مصر',
];
const catalog = buildCatalog(LISTED, new Map());

test('the sixteen boxes are the only boxes, each in the one currency its name says', () => {
  assert.equal(catalog.entries.length, 16, 'the two bank transfers read alike but stay two boxes');
  const currencies = Object.fromEntries(catalog.entries.map(entry => [entry.key, entry.currency]));
  assert.equal(currencies['أحمد السعودية'], 'SAR');
  assert.equal(currencies['ويسترن يونيون'], 'USD');
  assert.equal(catalog.entries.filter(entry => entry.currency === 'EGP').length, 14);
  assert.equal(currencyOfName('تحويل لأحمد السعودية'), 'SAR');
  assert.equal(currencyOfName('ويسترن يونيون'), 'USD');
  assert.equal(currencyOfName('فودافون كاش 4645'), 'EGP');
  assert.ok(catalog.entries.some(entry => entry.key === 'تحويل او ايداعي بنكي في مصر') && catalog.entries.some(entry => entry.key === 'تحويل او ايداعي بنكي من خارج مصر'),
    'the two bank transfers stay two boxes');
});

test('riyals go to the riyal box and dollars to the dollar box, whatever method was typed', () => {
  assert.equal(keyOf('فودافون كاش 4645', 'SAR', catalog), 'أحمد السعودية|SAR', 'a Vodafone wallet never held riyals');
  assert.equal(keyOf('انستا باي 7720', 'SAR', catalog), 'أحمد السعودية|SAR');
  assert.equal(keyOf('تحويل بنكي', 'USD', catalog), 'ويسترن يونيون|USD');
  assert.equal(keyOf('ويسترن', 'USD', catalog), 'ويسترن يونيون|USD');
  // Pounds typed on the riyal or dollar box belong to no listed pound box.
  assert.equal(keyOf('تحويل لأحمد السعودية', 'EGP', catalog), `${CATCH_ALL}|EGP`);
  assert.equal(keyOf('ويسترن يونيون', 'EGP', catalog), `${CATCH_ALL}|EGP`);
});

test('pounds go to the listed box their method is, however it was spelled', () => {
  const box = method => boxOf(method, 'EGP', catalog).box;
  assert.equal(box('نقدي'), 'خزنة الدقي - كاش');
  assert.equal(box('كاش'), 'خزنة الدقي - كاش');
  assert.equal(box('خزنة الدقي'), 'خزنة الدقي - كاش');
  assert.equal(box('فودافون كاش 7722'), 'فودافون كاش 7722');
  assert.equal(box('فودافون كاش  7722'), 'فودافون كاش 7722');
  assert.equal(box('فودفوان كاس 1010'), 'فودافون كاش 1010');
  assert.equal(box('فودافون كاش 4645'), 'فودافون كاش 4645');
  assert.equal(box('انستا باي 6046'), 'انستا باي 6046');
  assert.equal(box('فيزا الدقي'), 'فيزا الدقي');
  assert.equal(box('محفظة وي 7720'), 'وي باي 7720');
  assert.equal(box('اورانج ماني 7720'), 'اورانج كاش 7720');
  assert.equal(box('تحويل او ايداعي بنكي في مصر'), 'تحويل او ايداعي بنكي في مصر');
  assert.equal(box('تحويل او ايداعي بنكي من خارج مصر'), 'تحويل او ايداعي بنكي من خارج مصر');
  assert.equal(box('تحويل بنكي'), 'تحويل او ايداعي بنكي في مصر', 'the old name of the Egyptian transfer');
});

test('anything not on the list is counted under «أخرى», old accounts included, and no box is invented', () => {
  for (const method of ['فودافون كاش 9999', 'فودافون كاش', 'Paymob', 'غير محدد', '', 'فوري', 'فودافون كاش 1079']) {
    assert.deepEqual(boxOf(method, 'EGP', catalog), { box: CATCH_ALL, currency: 'EGP' }, method || '(empty)');
  }
  // A currency with no listed box is not given one.
  const noRiyal = buildCatalog(['خزنة الدقي - كاش', 'ويسترن يونيون'], new Map());
  assert.deepEqual(boxOf('تحويل', 'SAR', noRiyal), { box: CATCH_ALL, currency: 'SAR' });
  // The name a box already carries reads as itself.
  for (const entry of catalog.entries) assert.deepEqual(boxOf(entry.key, entry.currency, catalog, { stored: true }), { box: entry.key, currency: entry.currency }, entry.key);
});

test('with no list the old reading stays: every spelling of a channel is its own box in its own currency', () => {
  const none = buildCatalog([], new Map());
  assert.equal(none.active, false);
  assert.deepEqual(boxOf('فودافون كاش  7722', 'EGP', none), { box: 'فودافون كاش 7722', currency: 'EGP' });
  assert.deepEqual(boxOf('فودافون كاش 4645', 'SAR', none), { box: 'فودافون كاش 4645', currency: 'SAR' });
  assert.deepEqual(boxOf('فودافون كاش 4645', 'SAR', none, { stored: true }), { box: 'فودافون كاش 4645', currency: 'SAR' });
});

test('the box merges still apply to a listed box', () => {
  const merged = buildCatalog(['فودافون كاش 1010'], new Map([['فودافون كاش 1010', 'فودافون كاش 1079']]));
  assert.deepEqual(merged.entries.map(entry => entry.key), ['فودافون كاش 1079']);
  assert.equal(boxOf('فودفوان كاس 1010', 'EGP', merged).box, 'فودافون كاش 1079');
});
