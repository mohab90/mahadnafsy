'use strict';
/**
 * 2 Nov 2026, the owner's two rules («دا محتاج يبقى كونسبت أساسي في السيستم»):
 *
 *  1. A track is paid ONCE. The courses inside it are access to the videos, not debts: a client who finished paying the track owes nothing on any
 *     of its courses, and the booking dialog must not list them with a price and a «متبقي» of their own.
 *  2. A certificate, a carnet, a book, a consultation is its own service. It names the client's course («الكورس المرتبط») without paying for it: its
 *     money and the price it recorded are never the course's.
 *
 * The dialog read one rule and the clients table another («من برة متبقي رقم ومن عند زر حجز ودفع متبقي رقم تاني»); both now read
 * admin/lib/agreedPrice.ts clientItems, and the server's copy of the table (api/lib/staffClientsView.js) is held to the same answers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { balanceOf } = require('../lib/staffClientsView');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function load(entry) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

const price = egp => ({ EGP: egp, SAR: 0, USD: 0 });
const courses = [
  { id: 'A', title: 'أ', price: price(1500) }, { id: 'B', title: 'ب', price: price(1500) }, { id: 'C', title: 'ج', price: price(1500) },
  { id: 'Z', title: 'منفرد', price: price(2000) },
];
const track = { id: 'X', title: 'المسار', price: price(3000), courses: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] };
const pay = (over) => ({ id: `p${Math.random()}`, amount: 0, currency: 'EGP', status: 'paid', paymentType: 'course', ...over });

const serverCatalogue = {
  courses: new Map(courses.map(course => [course.id, { price: course.price }])),
  bundles: new Map([['X', { price: track.price, courseIds: ['A', 'B', 'C'] }]]),
};

test('a track paid in full is one line with nothing left, and no course of it is a line of its own', () => {
  const holdings = load('admin/components/payment-modal/clientHoldings.ts');
  const client = {
    enrolledCourseIds: ['A', 'B', 'C'], enrolledBundleIds: ['X'],
    paymentHistory: [pay({ amount: 3000, bundleId: 'X' })],
  };
  if (holdings) {
    const result = holdings.clientHoldings({ id: 's', name: 'ع', ...client }, courses, [track], 'EGP');
    assert.equal(result.enrolledOptions.length, 1, 'one line: the track');
    assert.equal(result.enrolledOptions[0].cid, 'bundle:X');
    assert.equal(result.enrolledOptions[0].isBnd, true);
    assert.equal(result.enrolledOptions[0].paid, 3000);
    assert.equal(result.enrolledOptions[0].remaining, 0);
    assert.equal(result.moneyFor('A').cid, 'bundle:X', 'a course inside the track is the track\'s line');
    for (const id of ['A', 'B', 'C', 'bundle:X']) assert.ok(result.heldCids.has(id), id);
  }
  // the clients table, server side: the same nothing left
  assert.equal(balanceOf({ ...client, branch: 'ONLINE_EGYPT' }, serverCatalogue).remainingEgp, 0);
});

test('money recorded against the courses of a track counts toward the track, and a client holding every course holds the track', () => {
  const client = {
    enrolledCourseIds: ['A', 'B', 'C'], enrolledBundleIds: [],
    paymentHistory: [pay({ amount: 1500, courseId: 'A' }), pay({ amount: 1000, courseId: 'B' })],
  };
  const holdings = load('admin/components/payment-modal/clientHoldings.ts');
  if (holdings) {
    const result = holdings.clientHoldings({ id: 's', name: 'ع', ...client }, courses, [track], 'EGP');
    assert.equal(result.enrolledOptions.length, 1);
    assert.equal(result.enrolledOptions[0].cid, 'bundle:X');
    assert.equal(result.enrolledOptions[0].px, 3000);
    assert.equal(result.enrolledOptions[0].paid, 2500);
    assert.equal(result.enrolledOptions[0].remaining, 500);
  }
  assert.equal(balanceOf({ ...client, branch: 'ONLINE_EGYPT' }, serverCatalogue).remainingEgp, 500, 'the table says the same 500');
});

test('a certificate or a carnet that names the course is not the course\'s money, nor its price', () => {
  const client = {
    enrolledCourseIds: ['Z'], enrolledBundleIds: [],
    paymentHistory: [
      pay({ amount: 1500, courseId: 'Z', courseExpected: 2000 }),
      pay({ amount: 1000, courseId: 'Z', paymentType: 'carneh', courseExpected: 1000 }),
      pay({ amount: 900, courseId: 'Z', paymentType: 'certificate', courseExpected: 900 }),
    ],
  };
  const holdings = load('admin/components/payment-modal/clientHoldings.ts');
  if (holdings) {
    const result = holdings.clientHoldings({ id: 's', name: 'ع', ...client }, courses, [track], 'EGP');
    const line = result.enrolledOptions.find(option => option.cid === 'Z');
    assert.equal(line.paid, 1500, 'the carnet and the certificate are not paid towards the course');
    assert.equal(line.px, 2000, 'and the price they recorded is not the course\'s agreed price');
    assert.equal(line.remaining, 500);
    assert.equal(result.moneyFor('Z').paid, 1500);
  }
  assert.equal(balanceOf({ ...client, branch: 'ONLINE_EGYPT' }, serverCatalogue).remainingEgp, 500);
});

test('the dialog takes its money from that one function and the Dokki desk\'s round counts course money only', () => {
  const source = read('admin/components/payment-modal/clientHoldings.ts');
  assert.match(source, /import \{ agreedPriceFor, clientItems, isCoursePayment, paidFor \} from '\.\.\/\.\.\/lib\/agreedPrice';/);
  assert.match(source, /const items = clientItems\(\{/);
  assert.doesNotMatch(source, /autoDetectedBundles/, 'no second rule about what a track is');
  assert.match(read('admin/components/PaymentModal.tsx'), /const alreadyPaid = moneyFor\(d\.courseId\)\?\.paid \?\? 0;/);
  assert.match(read('admin/components/payment-modal/usePaymentModalModel.tsx'), /const prevPaid = itemService \? 0 : \(moneyFor\(d\.courseId\)\?\.paid \?\? 0\);/);
  const desk = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  assert.equal((desk.match(/&& isCoursePayment\(p\)/g) || []).length, 2);
});

test('a track paid by a payment proof or an instalment (typed «bundle») is paid on the screens as well as on the client\'s page', () => {
  const holdings = load('admin/components/payment-modal/clientHoldings.ts');
  const client = {
    enrolledCourseIds: ['A', 'B', 'C'], enrolledBundleIds: ['X'],
    paymentHistory: [pay({ amount: 2000, bundleId: 'X', paymentType: 'bundle', courseExpected: 3000 })],
  };
  if (holdings) {
    const result = holdings.clientHoldings({ id: 's', name: 'ع', ...client }, courses, [track], 'EGP');
    assert.equal(result.enrolledOptions[0].paid, 2000, 'the browser counts it');
    assert.equal(result.enrolledOptions[0].remaining, 1000);
  }
  assert.equal(balanceOf({ ...client, branch: 'ONLINE_EGYPT' }, serverCatalogue).remainingEgp, 1000, 'the server table counts it too');
});
