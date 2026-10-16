'use strict';
/**
 * «جدول الدقى اللى بيظهر فى حسابات السيلز ياريت يكون بنفس تصميم جدول الدقى العادى ولكن بفلتر اتوماتك
 * على الجديد او اللى لسه بدأ محاضرة او 2 فقط … كمان يقدر يشوفه بشكل التقويم» (14 Oct 2026).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

test('the sales schedule draws the desk\'s header, table columns and two-week calendar', () => {
  const sales = read('admin/pages/dashboard/tabs/SalesDaqqiScheduleTab.tsx');
  assert.match(sales, /<DaqqiScheduleHeader view=\{view\} setView=\{setView\} hideCreateRound/);
  assert.match(sales, /'الكود', 'الكورس', 'الميعاد', 'القاعة', 'المحاضر والريسبشن'/);
  assert.match(sales, /الأسبوع الحالي/);
  assert.match(sales, /الأسبوع القادم/);
  assert.match(sales, /فلتر تلقائي/);
});

test('nothing about who is in a course or any money reaches the sales schedule', () => {
  const sales = read('admin/pages/dashboard/tabs/SalesDaqqiScheduleTab.tsx');
  assert.doesNotMatch(sales, /attendees|المحصّل|المتبقي|paymentHistory/);
  const route = read('api/routes/daqqi-rounds.js');
  const handler = route.slice(route.indexOf("'/api/admin/daqqi-rounds/sales-schedule'"), route.indexOf("router.get('/api/admin/daqqi-rounds',"));
  assert.doesNotMatch(handler, /attendee|payments/i);
  assert.match(handler, /\.filter\(round => round\.lecture <= 2\)/);
});
