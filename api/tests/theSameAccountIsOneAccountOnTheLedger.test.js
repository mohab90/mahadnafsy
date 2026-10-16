'use strict';
/**
 * «في صفحة التحويلات في الحسابات في حساب رقم 1010 وحساب 1079 دول حساب واحد ادمجهم على بعض بالحساب
 * المسجل حاليا على السيستم … كمان بيظهر حسابين رقم 4645 ليه؟ ادمجهم في واحد» (16 Oct 2026).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { groupAccounts, sameAccountName, numbersOf, sheetOf } = require('../lib/transferAccounts');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const account = (name, rows = 1) => ({ name, rows, total: rows * 100 });

test('one number named whole, by its start, by its end, or with another name in front is one account', () => {
  assert.equal(sameAccountName('فودافون كاش 4645', '1094124645'), true, 'the last four of the whole number');
  assert.equal(sameAccountName('فودافون كاش 1010', '1010351079'), true, 'the first four');
  assert.equal(sameAccountName('فودافون كاش 1079', 'حساب 1079'), true);
  assert.equal(sameAccountName('فودافون كاش 4645', 'فودافون كاش  ٤٦٤٥'), true, 'Arabic digits and spaces do not make a second account');
});

test('two rails, or two numbers, are not one account', () => {
  assert.equal(sameAccountName('اورانج كاش 7720', 'انستا باى 01505887720'), false, 'one number ends in the other but it is a different rail');
  assert.equal(sameAccountName('فودافون كاش 2020', '1020202954'), false, '2020 is neither the start nor the end of 1020202954');
  assert.equal(sameAccountName('فودافون كاش 7711', 'فودافون كاش 7722'), false);
  assert.deepEqual(numbersOf('انستا باى 01505887720'), ['1505887720'], 'a leading zero is not part of the number');
});

test('1010 and 1079 — the same imported sheet — and the two 4645s come out as groups, onto the registered name', () => {
  const sheets = new Map([['1010351079', new Set(['فودافون كاش 1010', 'فودافون كاش 1079'])]]);
  const groups = groupAccounts(
    [account('فودافون كاش 1010', 40), account('فودافون كاش 1079', 90), account('فودافون كاش 4645', 30), account('1094124645', 5), account('اورانج كاش 7720', 3), account('انستا باى 01505887720', 9)],
    { sheets, registered: ['فودافون كاش 1079', 'فودافون كاش 4645'] },
  );
  assert.equal(groups.length, 2, 'the other rails stay apart');
  const g1079 = groups.find(group => group.members.some(member => member.name.endsWith('1010')));
  assert.equal(g1079.target, 'فودافون كاش 1079');
  assert.equal(g1079.why, 'نفس ملف التحويلات');
  const g4645 = groups.find(group => group.members.some(member => member.name === '1094124645'));
  assert.equal(g4645.target, 'فودافون كاش 4645');
  assert.deepEqual(g4645.members.map(member => member.registered).sort(), [false, true]);
});

test('with nothing registered the group lands on the name that says what it is', () => {
  const [group] = groupAccounts([account('1094124645', 1), account('فودافون كاش 4645', 1)]);
  assert.equal(group.target, 'فودافون كاش 4645');
});

test('the sheet a row came from is read off its note', () => {
  assert.equal(sheetOf('من ملف التحويلات «1010351079»'), '1010351079');
  assert.equal(sheetOf('العميل: س · من ملف التحويلات «انستا باى 01505887720»'), 'انستا باي 01505887720');
  assert.equal(sheetOf(null), '');
});

test('the merge is the managers\', audited, remembered, and applied to what is entered later', () => {
  const routes = read('api/routes/core/financepay.js');
  assert.match(routes, /'\/api\/admin\/incoming-transfers\/accounts'[\s\S]{0,300}managesTransfers/);
  const merge = routes.slice(routes.indexOf("'/api/admin/incoming-transfers/merge-accounts'"));
  assert.match(merge, /managesTransfers\(req\)/);
  assert.match(merge, /incoming_transfer\.accounts_merged/);
  assert.match(merge, /setTenantSetting\('transfer_account_aliases'/);
  assert.match(routes, /renamed\(aliases, req\.body\?\.method\)/, 'a transfer typed in under an old name goes to the merged account');
  assert.match(routes, /renamed\(aliases, row\?\.method\)/, 'and so does an imported sheet');
  const lib = read('api/lib/transferAccounts.js');
  assert.match(lib, /UPDATE IGNORE incoming_transfers/, 'a number already on the target box is reported, not forced');
  assert.match(read('admin/pages/dashboard/tabs/orders/IncomingTransfers.tsx'), /<TransferAccountsMerge notify=\{notify\} onMerged=\{onMerged\} \/>/);
});
