'use strict';
/**
 * The owner's monthly sales sheet (api/lib/salesSheet.js) on MADE-UP rows laid out the way each of the six real tabs of October 2026 was: every tab has its
 * own columns and no headings, so the reader has to find them by what they hold. No real client, phone or id is in this file.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSalesSheet, parsePhones, parseDayMonth, serialToDay, dayToSerial, courseSimilarity } = require('../lib/salesSheet');

const D = day => 46295 + day; // Excel serial of 2026-10-<day>
const MARK = 'النص التانى';
const read = tabs => parseSalesSheet(tabs, { month: '2026-10' });
const only = (tabs, index = 0) => read(tabs).reps[index];
// The six layouts read together, as the real workbook is: a course is written the same in every tab and a name is not, which is how the two are told apart.
const WORKBOOK = () => read([layoutA, layoutB, layoutC, layoutD, layoutE, layoutF]).reps;
const tabIn = layout => WORKBOOK().find(rep => rep.tab === layout.name);

// A: name | phone (a number: its leading zero is gone; two numbers as text) | course | date serial | price | deposit | branch
const layoutA = { name: 'ريب أ', rows: [
  ['عميل تجريبي اول', 1100000001, 'علم نفس متكامل', D(3), 4600, 900, 'اون لاين محلي'],
  ['عميل تجريبي ثاني', '01100000002\\01200000003', 'معالج 8 شهور', D(10), 6320, 3000, 'اون لاين محلي'],
  [null, MARK, null, null, null, null, null],
  ['عميل تجريبي ثالث', 249900000004, 'صحة نفسية', D(12), 2390, 2390, 'اون لاين محلي'],
  ['عميل تجريبي رابع', 1100000005, 'علم نفس اكلينكي', D(13), 4140, 900, 'الدقي'],
  ['عميل تجريبي خامس', 1100000006, 'علم نفس متكامل', D(20), 4600, 900, 'الدقي'],
] };

// B: name | course | branch | branch again | date serial | deposit | price | a code column (720, 7722, «فرع») | phone (a number)
const layoutB = { name: 'ريب ب', rows: [
  ['عميلة تجريبية اولى', 'متكامل', 'اونلاين', 'اونلاين', D(5), 600, 2500, 7722, 1100000011],
  ['عميلة تجريبية ثانية', 'اكلينكي', 'اونلاين', 'اونلاين', D(8), 800, 4140, 720, 1100000012],
  ['عميلة تجريبية ثالثة', 'معالج سنه', 'دقي', 'دقي', D(9), 1600, 13320, 7722, 1100000013],
  ['عميلة تجريبية رابعة', 'صحه', 'دقي', 'دقي', D(10), 700, 2800, 'فرع', 1100000014],
  [null, MARK, null, null, null, null, null, null, null],
  ['عميلة تجريبية خامسة', 'كوتشينج', 'اونلاين', 'اونلاين', D(18), 900, 3400, 720, 1100000015],
] };

// C: name | «d\m» text date | phone (numbers, two as text) | course | deposit BEFORE price | price | branch | branch again | payment method (even «الدقي» now and then)
const layoutC = { name: 'ريب ج', rows: [
  ['شخص تجريبي اول', '1\\10', 61400000021, 'التخاطب والتربيه الخاصه', 5225, 5225, 'اونلاين', 'اونلاين', 'فودافون'],
  [null, null, null, MARK, null, null, null, null, null],
  ['شخص تجريبي ثاني', '13\\10', 1100000022, 'تلاعب وتحصين نفسي', 800, 2400, 'الدقي', 'الدقي', 'انستا'],
  ['شخص تجريبي ثالث', '25\\10', '01100000023\\96600000099', 'علم النفس المتكامل', 4370, 4370, 'اونلاين', 'اونلاين', 'الدقي'],
  ['شخص تجريبي رابع', '31\\10', 1100000024, 'لايف كوتشنج', 800, 3420, 'اونلاين', 'اونلاين', 'انستا'],
] };

// D: name | phone (text with «/» and a 00 prefix) | course | date serial | deposit | discount note | price (NET of the discount) | branch
const layoutD = { name: 'ريب د', rows: [
  ['فلان تجريبي اول', 1100000031, 'صحة نفسية', D(4), 700, 'الخصم الثابت', 2800, 'الدقي', null],
  ['فلان تجريبي ثاني', '00249900000032/01100000033', 'تخاطب وتربية خاصه', D(10), 900, 'خصم التدوير 10%', 4950, 'الدقي', null],
  [null, MARK, null, null, null, null, null, null, null],
  ['فلان تجريبي ثالث', 1100000034, 'تربية خاصه', D(22), 2660, 'خصم الكاش 5%', 2660, 'اون لاين محلي'],
  ['فلان تجريبي ثالث', 1100000034, 'علم نفس اكلينكي', D(26), 900, 'خصم التدوير 10%', 4950, 'اون لاين محلي'],
] };

// E: name | phone written in pieces («0 11 …») | course | branch (one blank) | deposit | price | date serial last
const layoutE = { name: 'ريب هـ', rows: [
  ['كيان تجريبي اول', 1100000041, 'متكامل', 'الدقي', 900, 4140, D(11)],
  [null, MARK, null, null, null, null, null],
  ['كيان تجريبي ثاني', '0 11 00000042', 'معالج نفسي محترف', 'الدقي', 1800, 12800, D(24)],
  ['كيان تجريبي ثالث', 1100000043, 'صحه نفسيه', null, 700, 2800, D(18)],
] };

// F: name | phone | course | branch | price | deposit | national id | date serial
const layoutF = { name: 'ريب و', rows: [
  ['اسم تجريبي اول', 1100000051, 'متكامل', 'الدقي', 4600, 900, 30000000000001, D(4)],
  ['اسم تجريبي ثاني', 1100000052, 'الصحه النفسيه', 'اونلاين', 2520, 700, 30000000000002, D(13)],
  ['اسم تجريبي ثالث', 393700000053, 'معالج نفسي محترف', 'اونلاين', 10140, 1700, 29000000000003, D(14)],
  [null, null, MARK, null, null, null, null, null],
  ['اسم تجريبي رابع', 10100000054, 'معالج نفسي محترف', 'الدقي', 11520, 1800, 10337396, D(16)],
] };

test('layout A: name, phone, course, date, price, deposit, branch — a phone number lost its zero, a cell holds two numbers, the marker splits the rounds', () => {
  const tab = tabIn(layoutA);
  assert.deepEqual(tab.columns, { name: 0, phone: 1, course: 2, date: 3, price: 4, deposit: 5, branch: 6, discount: -1, nationalId: -1 });
  assert.equal(tab.rows.length, 5);
  assert.deepEqual(tab.rows.map(row => row.rowNumber), [1, 2, 4, 5, 6], 'the marker row is not a booking');
  assert.deepEqual(tab.rows[1].phones, ['01100000002', '01200000003'], 'both numbers of the cell are kept');
  assert.deepEqual(tab.rows[2].phones, ['249900000004']);
  assert.deepEqual([tab.rows[0].day, tab.rows[0].price, tab.rows[0].deposit, tab.rows[0].branch, tab.rows[3].branch], ['2026-10-03', 4600, 900, 'ONLINE', 'DOKKI']);
  assert.deepEqual(tab.rows.map(row => row.round), [1, 1, 2, 2, 2]);
  assert.deepEqual(tab.rows.map(row => row.roundByDate), [1, 1, 1, 1, 2]);
  assert.deepEqual(tab.rows.map(row => row.roundConflict), [false, false, true, true, false], 'after the marker but dated the 12th and the 13th');
});

test('layout B: course before the dates, the branch written twice, a code column that is neither the price nor the deposit, the phone last', () => {
  const tab = tabIn(layoutB);
  assert.deepEqual(tab.columns, { name: 0, phone: 8, course: 1, date: 4, price: 6, deposit: 5, branch: 2, discount: -1, nationalId: -1 });
  assert.deepEqual(tab.rows.map(row => [row.course, row.price, row.deposit]), [['متكامل', 2500, 600], ['اكلينكي', 4140, 800], ['معالج سنه', 13320, 1600], ['صحه', 2800, 700], ['كوتشينج', 3400, 900]]);
  assert.deepEqual(tab.rows.map(row => row.round), [1, 1, 1, 1, 2]);
  assert.equal(tab.rows[0].phones[0], '1100000011');
});

test('layout C: «13\\10» text dates, the deposit column before the price, a payment-method column that says «الدقي» now and then is not the branch', () => {
  const tab = tabIn(layoutC);
  assert.deepEqual(tab.columns, { name: 0, phone: 2, course: 3, date: 1, price: 5, deposit: 4, branch: 6, discount: -1, nationalId: -1 });
  assert.deepEqual(tab.rows.map(row => row.day), ['2026-10-01', '2026-10-13', '2026-10-25', '2026-10-31']);
  assert.deepEqual(tab.rows.map(row => [row.price, row.deposit]), [[5225, 5225], [2400, 800], [4370, 4370], [3420, 800]]);
  assert.deepEqual(tab.rows[2].phones, ['01100000023', '96600000099']);
  assert.deepEqual(tab.rows.map(row => row.branch), ['ONLINE', 'DOKKI', 'ONLINE', 'ONLINE']);
  assert.deepEqual(tab.rows.map(row => row.round), [1, 2, 2, 2]);
  assert.equal(tab.rows[1].roundConflict, true, 'the 13th sits after the marker');
});

test('layout D: a discount note between the deposit and the price, «a/b» numbers with a 00 prefix, one client booked twice for two courses', () => {
  const tab = tabIn(layoutD);
  assert.deepEqual(tab.columns, { name: 0, phone: 1, course: 2, date: 3, price: 6, deposit: 4, branch: 7, discount: 5, nationalId: -1 });
  assert.deepEqual(tab.rows[1].phones, ['00249900000032', '01100000033']);
  assert.equal(tab.rows[1].price, 4950, 'the price is the one after the discount');
  assert.equal(tab.rows[1].discount, 'خصم التدوير 10%');
  assert.deepEqual(tab.rows.slice(2).map(row => [row.name, row.course, row.price]), [['فلان تجريبي ثالث', 'تربية خاصه', 2660], ['فلان تجريبي ثالث', 'علم نفس اكلينكي', 4950]]);
  assert.deepEqual(tab.rows.map(row => row.round), [1, 1, 2, 2]);
});

test('layout E: a number written in pieces is one number; a blank branch is unknown; the date is the last column', () => {
  const tab = tabIn(layoutE);
  assert.deepEqual(tab.columns, { name: 0, phone: 1, course: 2, date: 6, price: 5, deposit: 4, branch: 3, discount: -1, nationalId: -1 });
  assert.deepEqual(tab.rows.map(row => row.phones), [['1100000041'], ['01100000042'], ['1100000043']]);
  assert.equal(tab.rows[2].branch, null);
  assert.deepEqual(tab.rows.map(row => row.round), [1, 2, 2]);
});

test('layout F: the national id is not a phone, even a short one in the same column; the marker may sit in any column', () => {
  const tab = tabIn(layoutF);
  assert.deepEqual(tab.columns, { name: 0, phone: 1, course: 2, date: 7, price: 4, deposit: 5, branch: 3, discount: -1, nationalId: 6 });
  assert.deepEqual(tab.rows.map(row => row.nationalId), ['30000000000001', '30000000000002', '29000000000003', '10337396']);
  assert.deepEqual(tab.rows.map(row => row.phones), [['1100000051'], ['1100000052'], ['393700000053'], ['10100000054']]);
  assert.deepEqual(tab.rows.map(row => row.round), [1, 1, 1, 2]);
  assert.equal(tab.marker, 4);
});

test('a workbook is every tab as one rep; the totals add up and nothing was lost', () => {
  const sheet = read([layoutA, layoutB, layoutC, layoutD, layoutE, layoutF]);
  assert.deepEqual(sheet.reps.map(rep => rep.tab), ['ريب أ', 'ريب ب', 'ريب ج', 'ريب د', 'ريب هـ', 'ريب و']);
  assert.equal(sheet.rows, 5 + 5 + 4 + 4 + 3 + 4);
  assert.deepEqual(sheet.unreadable, []);
  assert.deepEqual([sheet.from, sheet.to], ['2026-10-01', '2026-10-31']);
});

test('what cannot be read is listed with its row, a total row and a heading row are skipped, a row dated outside the month is read and said', () => {
  const tab = only([{ name: 'ريب ز', rows: [
    ['الاسم', 'التليفون', 'الكورس', 'التاريخ', 'السعر', 'العربون', 'الفرع'],
    ['عميل تجريبي اول', 1100000061, 'علم نفس متكامل', D(2), 4600, 900, 'الدقي'],
    ['عميل تجريبي ثاني', 1100000062, 'علم نفس متكامل', D(5), null, 900, 'الدقي'],
    [null, 1100000063, 'علم نفس متكامل', D(6), 4600, 900, 'الدقي'],
    ['عميل تجريبي ثالث', 1100000064, 'علم نفس متكامل', 46340, 4600, 900, 'الدقي'],
    ['عميل تجريبي رابع', null, 'علم نفس متكامل', D(7), 4600, 900, 'الدقي'],
    ['عميل تجريبي خامس', 1100000066, 'علم نفس متكامل', D(8), 4600, 900, 'الدقي'],
    ['الاجمالي', null, null, null, 18400, 3600, null],
  ] }]);
  assert.deepEqual(tab.skipped.map(item => [item.rowNumber, item.reason]), [[1, 'header'], [8, 'total']]);
  assert.deepEqual(tab.unreadable.map(item => [item.rowNumber, item.reason]), [[3, 'مفيش سعر'], [4, 'مفيش اسم عميل']]);
  assert.deepEqual(tab.rows.map(row => row.rowNumber), [2, 5, 6, 7]);
  const outside = tab.rows.find(row => row.rowNumber === 5);
  assert.deepEqual(outside.problems, ['التاريخ خارج الشهر']);
  assert.deepEqual(tab.rows.find(row => row.rowNumber === 6).problems, ['مفيش رقم تليفون']);
});

test('a tab with no marker takes its rounds from the dates; Arabic-Indic digits are read', () => {
  const tab = only([{ name: 'ريب ح', rows: [
    ['عميل تجريبي اول', '٠١١٠٠٠٠٠٠٧١', 'علم نفس متكامل', D(15), 4600, 900, 'الدقي'],
    ['عميل تجريبي ثاني', 1100000072, 'علم نفس متكامل', D(16), 4600, 900, 'الدقي'],
  ] }]);
  assert.deepEqual(tab.rows.map(row => [row.round, row.roundByMarker, row.roundConflict]), [[1, null, false], [2, null, false]]);
  assert.deepEqual(tab.rows[0].phones, ['01100000071']);
});

test('phones, dates and course names on their own', () => {
  assert.deepEqual(parsePhones('01100000001 01200000002'), ['01100000001', '01200000002'], 'two numbers apart by a space');
  assert.deepEqual(parsePhones('0 11 00000001'), ['01100000001'], 'one number written in pieces');
  assert.deepEqual(parsePhones('0110000000 1 / 12345'), ['01100000001'], 'a short run is not a number');
  assert.deepEqual(parsePhones(720), []);
  assert.deepEqual(parseDayMonth('3\\10', 2026), { day: 3, month: 10, year: 2026 });
  assert.deepEqual(parseDayMonth('03/10/26', 2026), { day: 3, month: 10, year: 2026 });
  assert.equal(parseDayMonth('13', 2026), null);
  assert.equal(serialToDay(46298), '2026-10-03');
  assert.equal(dayToSerial('2026-10-01'), 46296);
  assert.ok(courseSimilarity('متكامل', 'دبلومة علم النفس المتكامل') === 1);
  assert.ok(courseSimilarity('كوتشينج', 'لايف كوتشنج') === 1, 'spelling of the rep');
  assert.ok(courseSimilarity('صحه', 'الصحة النفسية') === 1);
  assert.ok(courseSimilarity('علم نفس اكلينكي', 'علم النفس المتكامل') === 0);
  assert.ok(courseSimilarity('صحة نفسية', 'علم نفس متكامل') === 0, 'sharing «نفس» is not sharing a course');
});
