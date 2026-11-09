'use strict';
/**
 * The collection employees' monthly sheet (api/lib/collectionSheet.js) on MADE-UP rows laid out the way each of the seven real tabs of October 2026 was: every
 * tab has its own columns and no headings, so the reader finds them by what they hold. No real client, phone or amount of the sheet is in this file.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCollectionSheet, moneyKinds, amountOf } = require('../lib/collectionSheet');

const D = day => 46295 + day; // Excel serial of 2026-10-<day>
const RLM = '‎'; const LRI = '⁦'; const PDI = '⁩';
const read = tabs => parseCollectionSheet(tabs, { month: '2026-10' });

// 1: name | phone (a number, the leading zero gone) | «قسط/course» in one cell | amount | date serial | the sender's phone, or a word
const layout1 = { name: 'محصلة أ', rows: [
  ['عميل تجريبي واحد', 1100000001, 'قسط/متكامل', 1250, D(1), 1100000001],
  ['عميل تجريبي اثنين', 1100000002, 'شهادات', 4600, D(2), 1100000099],
  ['عميل تجريبي ثلاثة', '01100000003/01200000004', 'قسط/معالج /شهادة الازهر تخاطب', 3500, D(3), 'انستا'],
  ['عميل تجريبي اربعة', 1100000005, 'كتب متكامل', 540, D(4), 686],
] };
// 2: name | phone | date | method | amount | «قسط course»
const layout2 = { name: 'محصلة ب', rows: [
  ['عميل تجريبي خمسة', '+20 11 00000005', D(1), 'فودافون كاش', 2520, 'قسط لايف كوتش'],
  ['عميل تجريبي ستة', '+249 91 000 0006', D(2), 'انستا باي', 1000, 'كارنيه متكامل'],
  ['عميل تجريبي سبعة', '0 127 000 0007', 46281, 'فودافون كاش', 1235, 'قسط متكامل'],
  ['عميل تجريبي ثمانية', 1100000008, D(5), 'فودافون كاش', 700],
] };
// 3: name | phone | course | TOTAL | PAID | LEFT | «قسط / حجز» | date as «d\m\yyyy» | method — the amount collected is the paid one
const layout3 = { name: 'محصلة ج', rows: [
  ['عميل تجريبي تسعة', '+20 12 00000009', 'متكامل', 1300, 1200, 100, 'قسط', '1\\10\\2026', 'فودافون كاش'],
  ['عميل تجريبي عشرة', '+20 10 00000010', 'علم نفس', 3700, 1850, 1850, 'قسط', '5\\10\\2026', 'فودافون كاش'],
  ['عميل تجريبي احد عشر', '+966 53 000 0011', 'تخاطب', '790 ريال', 3490, 540, 'حجز', '14\\10\\2026', 'الحساب الداخلي'],
  ['عميل تجريبي اثنا عشر', '+20 11 00000012', 'صحه', 1050, 1050, 0, 'قسط', '15\\10\\2026', 'فودافون كاش'],
  ['عميل تجريبي ثلاثة عشر', '+20 11 00000013', 'متكامل', 850, 850, 0, 'قسط شهاده', '15\\10\\2026', 'فودافون كاش'],
] };
// 4: name | «قسط course» | amount | date | method | CLIENT phone (or a name, or «--») | the wallet it came into (the same everywhere) | the sender's phone
const WALLET = 1010000000;
const layout4 = { name: 'محصلة د', rows: [
  ['عميل تجريبي اربعة عشر', 'قسط متكامل', 900, D(2), 'فودافون كاش', 1100000014, WALLET, 1100000014],
  ['عميل تجريبي خمسة عشر', 'بورد معالج', 500, D(3), 'فودافون كاش', 1100000015, WALLET, 1100000115],
  ['عميل تجريبي ستة عشر', 'خارجيه صحه', 1400, D(3), 'انستا باي', 'MAHMOUD TEST', WALLET, 1100000016],
  ['عميل تجريبي سبعة عشر', 'كارنيه صحه 3سنين', 400, D(4), 'فودافون كاش', '--', '--', 249900000017],
  ['عميل تجريبي ثمانية عشر', 'قسط متكامل', 1850, D(5), 'فودافون كاش', 1100000018, WALLET, 1100000018],
  ['عميل تجريبي تسعة عشر', 'قسط صحه', 1000, D(6), 'فودافون كاش', 1100000019, WALLET, 1100000019],
] };
// 5: name | phone (text, with +966) | «قسط course» | amount | date | method | the sender: 0 for a bank transfer
const layout5 = { name: 'محصلة هـ', rows: [
  ['عميل تجريبي عشرون', '966 53 000 0020', 'قسط تخاطب وتربيه', 3474, D(3), 'حساب بنكي', 0],
  ['عميل تجريبي واحد وعشرون', 1100000021, 'حجز متكامل', 500, D(4), 'انستاباي', 1100000021],
  ['عميل تجريبي اثنان وعشرون', 1100000022, 'تكمله حجز متكامل', 300, 46183, 'انستاباي', 1100000022],
  ['عميل تجريبي ثلاثة وعشرون', 1100000023, 'قسط معالج', 1830, D(5), 'انستاباي', 1100000124],
  ['عميل تجريبي اربعة وعشرون', '966 54 000 0024', 'قسط تخاطب وتربيه', 2990, D(6), 'حساب بنكي', 0],
  ['عميل تجريبي خمسة وعشرون', '966 55 000 0025', 'قسط معالج', 7460, D(7), 'حساب بنكي', 0],
] };
// 6: name | phone (with a note around it, two numbers with «\» or «/») | course | amount | date | sender
const layout6 = { name: 'محصلة و', rows: [
  ['عميل تجريبي ستة وعشرون', '1061000027\\+20 11 05065636', 'شهاده الازهر للتشخيص وعلاج', 1400, D(5), 1061000027],
  ['عميل تجريبي سبعة وعشرون', 'دا رقم الزوج 1070000028/1024000029 دا رقم الزوجة', 'علم النفس المتكامل', 1850, D(22), 1150000030],
  ['عميل تجريبي ثمانية وعشرون', 1100000031, 'استشاره', 450, D(1), 1100000031],
  ['عميل تجريبي تسعة وعشرون', '01558282609-010509054780', 'قسط متكامل', 1000, D(7), 1100000032],
  ['عميل تجريبي ثلاثون', 1100000033, 'علم النفس المتكامل', 1850, D(9), 1100000033],
] };
// 7: no phone at all — name | date | «قسط course» | amount
const layout7 = { name: 'محصلة ز', rows: [
  ['عميل تجريبي واحد وثلاثون', D(1), 'قسط ارشاد تربوي', 1000],
  ['عميل تجريبي اثنان وثلاثون', D(3), 'قسط', 800],
  ['عميل تجريبي ثلاثة وثلاثون', D(5), 'خارجية', 1900],
  ['عميل تجريبي اربعة وثلاثون', D(6), 'تكملة بورد', 600],
] };
const ALL = [layout1, layout2, layout3, layout4, layout5, layout6, layout7];
const tabIn = layout => read(ALL).collectors.find(tab => tab.tab === layout.name);

test('layout 1: name, phone, «قسط/course» in one cell, amount, date, the sender — a cell of two numbers keeps both', () => {
  const tab = tabIn(layout1);
  assert.deepEqual(tab.columns, { name: 0, date: 4, phones: [1, 5], wallets: [], types: [2], method: [], amount: 3, total: -1, left: -1 });
  assert.deepEqual(tab.rows.map(row => [row.amount, row.day]), [[1250, '2026-10-01'], [4600, '2026-10-02'], [3500, '2026-10-03'], [540, '2026-10-04']]);
  assert.deepEqual(tab.rows[2].phones, ['01100000003', '01200000004']);
  assert.deepEqual(tab.rows[1].senderPhones, ['1100000099'], 'the sender\'s number is kept apart from the client\'s');
  assert.deepEqual(tab.rows[0].senderPhones, [], 'the same number is not a second one');
  assert.deepEqual(tab.rows[2].senderPhones, [], 'a word in the sender\'s column is no phone');
});

test('layout 2: the date before the method and the amount; +20 and +249 numbers with spaces; an old payment is still a row, said to be outside the month', () => {
  const tab = tabIn(layout2);
  assert.deepEqual(tab.columns, { name: 0, date: 2, phones: [1], wallets: [], types: [5], method: [3], amount: 4, total: -1, left: -1 });
  assert.deepEqual(tab.rows.map(row => row.phones[0]), ['201100000005', '249910000006', '01270000007', '1100000008']);
  assert.deepEqual(tab.rows.map(row => row.method), ['فودافون كاش', 'انستا باي', 'فودافون كاش', 'فودافون كاش']);
  assert.deepEqual([tab.rows[2].day, tab.rows[2].inMonth, tab.rows[2].problems], ['2026-09-16', false, ['التاريخ خارج الشهر']]);
  assert.deepEqual(tab.rows[3].kinds, ['COURSE'], 'no text: a course payment');
});

test('layout 3: total, paid and left — the paid one is the amount; «d\\m\\yyyy» dates; an amount written with a currency word is read', () => {
  const tab = tabIn(layout3);
  assert.deepEqual(tab.columns, { name: 0, date: 7, phones: [1], wallets: [], types: [2, 6], method: [8], amount: 4, total: 3, left: 5 });
  assert.deepEqual(tab.rows.map(row => [row.total, row.amount, row.left]), [[1300, 1200, 100], [3700, 1850, 1850], [790, 3490, 540], [1050, 1050, 0], [850, 850, 0]]);
  assert.deepEqual(tab.rows.map(row => row.day), ['2026-10-01', '2026-10-05', '2026-10-14', '2026-10-15', '2026-10-15']);
  assert.equal(tab.rows[2].method, 'الحساب الداخلي');
  assert.deepEqual(tab.rows[4].kinds, ['CERTIFICATE', 'COURSE'], '«قسط شهاده»');
});

test('layout 4: the wallet the money came into is not a client, a name or «--» in the client\'s column leaves the sender\'s number', () => {
  const tab = tabIn(layout4);
  assert.deepEqual(tab.columns, { name: 0, date: 3, phones: [5, 7], wallets: [6], types: [1], method: [4], amount: 2, total: -1, left: -1 });
  assert.deepEqual(tab.rows.map(row => row.phones), [['1100000014'], ['1100000015'], [], [], ['1100000018'], ['1100000019']]);
  assert.deepEqual(tab.rows[2].senderPhones, ['1100000016'], 'client\'s column holds a name: only the sender\'s number is left');
  assert.deepEqual(tab.rows[3].senderPhones, ['249900000017']);
  assert.deepEqual(tab.rows.map(row => row.kinds), [['COURSE'], ['CERTIFICATE'], ['CERTIFICATE'], ['CARNEH'], ['COURSE'], ['COURSE']]);
});

test('layout 5: bank transfers carry a 0 in the sender\'s column; +966 numbers; a booking and its completion', () => {
  const tab = tabIn(layout5);
  assert.deepEqual(tab.columns, { name: 0, date: 4, phones: [1, 6], wallets: [], types: [2], method: [5], amount: 3, total: -1, left: -1 });
  assert.deepEqual(tab.rows.map(row => row.amount), [3474, 500, 300, 1830, 2990, 7460]);
  assert.deepEqual(tab.rows[0].phones, ['966530000020']);
  assert.deepEqual(tab.rows[0].senderPhones, []);
  assert.equal(tab.rows[2].inMonth, false);
});

test('layout 6: a note around the number, «\\», «/» and a dash between two numbers separate them; Arabic-Indic digits read', () => {
  const tab = tabIn(layout6);
  assert.deepEqual(tab.columns, { name: 0, date: 4, phones: [1, 5], wallets: [], types: [2], method: [], amount: 3, total: -1, left: -1 });
  assert.deepEqual(tab.rows[0].phones, ['1061000027', '201105065636']);
  assert.deepEqual(tab.rows[1].phones, ['1070000028', '1024000029']);
  assert.deepEqual(tab.rows[3].phones, ['01558282609', '010509054780']);
  assert.deepEqual(tab.rows.map(row => row.kinds), [['CERTIFICATE'], ['COURSE'], ['CONSULTATION'], ['COURSE'], ['COURSE']]);
});

test('layout 7: a tab with no phone at all is read as it is — the client is found by the name', () => {
  const tab = tabIn(layout7);
  assert.deepEqual(tab.columns, { name: 0, date: 1, phones: [], wallets: [], types: [2], method: [], amount: 3, total: -1, left: -1 });
  assert.deepEqual(tab.rows.map(row => [row.name, row.phones, row.amount, row.day]).slice(0, 2), [['عميل تجريبي واحد وثلاثون', [], 1000, '2026-10-01'], ['عميل تجريبي اثنان وثلاثون', [], 800, '2026-10-03']]);
  assert.ok(tab.rows.every(row => row.problems.includes('مفيش رقم تليفون')));
  assert.deepEqual(tab.rows.map(row => row.kinds), [['COURSE'], ['COURSE'], ['CERTIFICATE'], ['CERTIFICATE', 'COURSE']]);
});

test('a workbook is every tab as one employee; invisible direction marks are dropped; totals and headings are skipped; what cannot be read is listed', () => {
  const sheet = read(ALL);
  assert.deepEqual(sheet.collectors.map(tab => tab.tab), ALL.map(layout => layout.name));
  assert.equal(sheet.rows, 4 + 4 + 5 + 6 + 6 + 5 + 4);
  assert.deepEqual(sheet.unreadable, []);

  const messy = read([{ name: `${RLM}محصلة ح`, rows: [
    ['الاسم', 'التليفون', 'النوع', 'المبلغ', 'التاريخ'],
    [`${RLM}عميل تجريبي${PDI} ${LRI}واحد`, `${LRI}+20 11 00000041${PDI}`, 'قسط متكامل', 1000, D(2)],
    ['عميل تجريبي اثنين', 1100000042, 'قسط متكامل', null, D(3)],
    [null, 1100000043, 'قسط متكامل', 900, D(4)],
    ['عميل تجريبي ثلاثة', 1100000044, 'قسط متكامل', 1100, D(5)],
    ['الاجمالي', null, null, 3000, null],
  ] }, layout1, layout2]).collectors[0];
  assert.equal(messy.tab, 'محصلة ح', 'the marks are not in the tab\'s name');
  assert.deepEqual(messy.rows.map(row => [row.name, row.phones]), [['عميل تجريبي واحد', ['201100000041']], ['عميل تجريبي ثلاثة', ['1100000044']]]);
  assert.deepEqual(messy.skipped.map(item => [item.rowNumber, item.reason]), [[1, 'header'], [6, 'total']]);
  assert.deepEqual(messy.unreadable.map(item => [item.rowNumber, item.reason]), [[3, 'مفيش مبلغ'], [4, 'مفيش اسم عميل']]);
});

test('what a row\'s text says it is: an instalment, a booking, a certificate (board, external, Azhar, experience), a carnet, books, a consultation', () => {
  const kinds = text => moneyKinds(text);
  assert.deepEqual(kinds('قسط/متكامل'), ['COURSE']);
  assert.deepEqual(kinds('حجز/علم نفس متكامل'), ['COURSE']);
  assert.deepEqual(kinds('تكمله حجز متكامل'), ['COURSE']);
  assert.deepEqual(kinds('اخر قسط متكامل'), ['COURSE']);
  assert.deepEqual(kinds('بورد معالج'), ['CERTIFICATE']);
  assert.deepEqual(kinds('خارجيه سكيما'), ['CERTIFICATE']);
  assert.deepEqual(kinds('ازهر متكامل'), ['CERTIFICATE']);
  assert.deepEqual(kinds('شهاده خبره المعالج'), ['CERTIFICATE']);
  assert.deepEqual(kinds('تجديد شهاده معهد'), ['CERTIFICATE']);
  assert.deepEqual(kinds('3كارنيه'), ['CARNEH']);
  assert.deepEqual(kinds('كتاب كوتشينج'), ['BOOK']);
  assert.deepEqual(kinds('كتب'), ['BOOK']);
  assert.deepEqual(kinds('استشاره'), ['CONSULTATION']);
  assert.deepEqual(kinds('قسط معالج /شهادة الازهر تخاطب'), ['CERTIFICATE', 'COURSE']);
  assert.deepEqual(kinds('شهاده /كارنيه 3سنين'), ['CERTIFICATE', 'CARNEH']);
  assert.deepEqual(kinds('تجديد مظلم ماجله 2شهور'), ['COURSE'], 'a renewal with no other word is course money');
  assert.deepEqual(kinds(''), ['COURSE']);
  assert.deepEqual([amountOf('790 ريال'), amountOf(1200), amountOf('abc')], [{ value: 790, note: 'ريال' }, { value: 1200, note: null }, null]);
});
