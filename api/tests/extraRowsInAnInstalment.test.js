'use strict';

// «لو العميل هيدفع قسط وعاوز اضيف خدمة اخرى واختار ان العميل هيحجز كورس جديد
// مش بيظهر غير الكورسات اللي هو حجزها» (13 Oct 2026). Inside an instalment, a
// course the client does not hold is offered and BOOKED new, with its price; the
// client's page records every added row instead of dropping them silently.

const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentModalSource } = require('./_adminSplitSource');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

function load() {
  const ADMIN_MODULES = path.join(__dirname, '../../admin/node_modules');
  let esbuild;
  try { esbuild = require(path.join(ADMIN_MODULES, 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    stdin: { contents: "export { extraPaymentEntries } from './lib/extraPaymentEntries';", resolveDir: path.join(__dirname, '../../admin'), loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', nodePaths: [ADMIN_MODULES],
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports.extraPaymentEntries;
}
const extraPaymentEntries = load();

const courses = [
  { id: 'c-held', title: 'Held', titleAr: 'كورس محجوز', price: { EGP: 4000 } },
  { id: 'c-new', title: 'New', titleAr: 'كورس جديد', price: { EGP: 3000 } },
  { id: 'c-free', title: 'NoPrice', titleAr: 'بلا سعر', price: {} },
];
const bundles = [{ id: 'b1', title: 'المسار', price: { EGP: 9000 }, courses: [{ id: 'c-new' }] }];
const draft = extra => ({ currency: 'EGP', paymentMethod: 'vodafone', date: '2026-10-13', extraItems: extra });
const deps = { courses, bundles, staff: { id: 's1', name: 'منى' }, noteParts: ['قسط أكتوبر', 'TX1'], now: 1 };

test('a held course is an instalment, a course the client lacks is a new booking at its price', { skip: !extraPaymentEntries }, () => {
  const [installment, booking] = extraPaymentEntries(draft([
    { type: 'course', label: '', amount: '1000', courseId: 'c-held', newBooking: false },
    { type: 'course', label: '', amount: '500', courseId: 'c-new', newBooking: true },
  ]), deps);
  assert.equal(installment.isInstallment, true);
  assert.equal(installment.courseId, 'c-held');
  assert.equal(installment.courseExpected, undefined, 'an instalment takes the agreed price');
  assert.equal(booking.isInstallment, false);
  assert.equal(booking.courseId, 'c-new');
  assert.equal(booking.courseExpected, 3000, "a new booking carries the course's price");
  assert.equal(booking.staffId, 's1');
});

test("the desk's own price or a discount beats the catalogue, a track books as a bundle", { skip: !extraPaymentEntries }, () => {
  const [custom, discounted, track] = extraPaymentEntries(draft([
    { type: 'course', label: '', amount: '500', courseId: 'c-new', newBooking: true, customExpected: '2500' },
    { type: 'course', label: '', amount: '500', courseId: 'c-new', newBooking: true, discountPct: '10' },
    { type: 'course', label: '', amount: '900', courseId: 'bundle:b1', newBooking: true },
  ]), deps);
  assert.equal(custom.courseExpected, 2500);
  assert.equal(discounted.courseExpected, 2700);
  assert.equal(track.bundleId, 'b1');
  assert.equal(track.courseId, undefined);
  assert.equal(track.courseExpected, 9000);
});

test('a new booking with no price stops the save, in Arabic, before any money is recorded', { skip: !extraPaymentEntries }, () => {
  assert.throws(() => extraPaymentEntries(draft([
    { type: 'course', label: '', amount: '500', courseId: 'c-free', newBooking: true },
  ]), deps), /سعر «بلا سعر».*غير مُعرّف/);
});

test('a certificate, a carnet or a book is its own payment, never an instalment', { skip: !extraPaymentEntries }, () => {
  const entries = extraPaymentEntries(draft([
    { type: 'certificate', label: 'شهادة البورد', amount: '300', certType: 'board' },
    { type: 'carneh', label: 'كارنيه', amount: '100' },
    { type: 'book', label: 'كتاب', amount: '0' },
  ]), deps);
  assert.equal(entries.length, 2, 'a row with no amount is skipped');
  assert.deepEqual(entries.map(e => [e.paymentType, e.isInstallment]), [['certificate', false], ['carneh', false]]);
  assert.equal(entries[0].certType, 'board');
  assert.match(entries[0].note, /شهادة البورد \| قسط أكتوبر \| TX1/);
});

test('the dialog offers the courses the client lacks and flags them as new bookings', () => {
  const modal = paymentModalSource();
  assert.match(modal, /<optgroup label="🆕 حجز كورس جديد">/);
  assert.match(modal, /newBooking: d\.bookingType === 'installment' && !!e\.target\.value && !heldCids\.has\(e\.target\.value\)/);
});

test("the client's page records the added rows, and the dashboard path books them new", () => {
  const hook = read('admin/pages/unified-client/useUnifiedClientPayments.ts');
  assert.match(hook, /extraPaymentEntries\(draft, \{/);
  assert.match(hook, /for \(const \[position, extra\] of extras\.entries\(\)\)/);
  const handlers = read('admin/pages/dashboard/dashboardPaymentHandlers.ts');
  assert.match(handlers, /isInstallment: !item\.newBooking/);
  assert.match(handlers, /courseExpected: item\.newBooking \? bookedPrice/);
});
