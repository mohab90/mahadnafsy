'use strict';
/**
 * «في حسابات التحصيل وحسابات الدقي عند اضافه مشترك جديد بيظهر حجز ودفع ودا غلط المفروض يظهر زر مشترك جديد
 * زي اللى بيظهر عند الادارة … بنفس تفاصيله سواء في الاونلاين او الدقي» (16 Oct 2026) — answered: the same form,
 * without the login, for the collection accounts and the Dokki desk.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const tab = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
const form = read('admin/pages/dashboard/tabs/NewSubscriberModal.tsx');

test('one «مشترك جديد» form opens from every account; the booking screen no longer does', () => {
  assert.equal((tab.match(/<NewSubscriberModal/g) || []).length, 1, 'one use, for all three accounts');
  assert.doesNotMatch(tab, /<PaymentModal/, 'the collection and Dokki accounts do not open «عميل جديد + حجز» any more');
  assert.match(tab, /variant=\{isCollectionStaff \|\| isDaqqiClientsTab \? 'booking' : 'account'\}/);
  assert.match(form, /🌐 مشترك أونلاين جديد/);
  assert.match(form, /🧾 مشترك جديد/);
});

test('the collection and Dokki forms have the management\'s details, except the login', () => {
  for (const detail of ['الاسم الكامل', 'رقم الهاتف', 'سعر مخصص', 'خصم %', 'دفعة أولى', 'طريقة الدفع', 'تاريخ الدفع', 'رقم الإيصال', 'رقم المحوِّل', 'ملاحظات']) {
    assert.ok(form.includes(detail), `${detail} is on the form`);
  }
  // The login, and each course's access, belong to the account variant alone.
  assert.match(form, /\{account && \(\s*<div className="grid grid-cols-2 gap-3 mt-2">[\s\S]{0,400}type="email"/);
  assert.match(form, /\{account && \(\s*<div className="flex items-center gap-2">\s*<span className="text-\[11px\] text-gray-500">الصلاحية:/);
  // A collection officer does not set a price.
  assert.match(form, /\{!lockPrice && \(/);
  assert.match(tab, /lockPrice=\{isCollectionStaff && !isDaqqiClientsTab\}/);
});

test('the management still creates the login account; the other two book through the booking endpoint', () => {
  assert.match(tab, /const submitNewAccount = async[\s\S]*?mysqlAdmin\.createAccount\(/);
  const booking = tab.slice(tab.indexOf('const submitNewBooking = async'), tab.indexOf('const [daqqiSettingsOpen'));
  assert.match(booking, /handleNewDaqqiClient\(draft\)/);
  assert.match(booking, /handleNewCollectionClient\(draft\)/, 'a collection officer\'s customer still waits for the manager');
  assert.match(booking, /lockedPrice/, 'a locked desk sends no price of its own');
  assert.match(tab, /createClientWithPayment\(draft/);
});

test('a course is recorded with its first payment — a booking form refuses a course with no money', () => {
  assert.match(form, /!account && hasCourse && !paying/);
  assert.match(form, /A client is reached by phone/);
  assert.match(form, /draft\.courses\.slice\(0, 1\)/, 'one course; the next is booked from «حجز \/ دفعة»');
});
