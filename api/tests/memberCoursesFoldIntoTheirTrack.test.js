'use strict';

// «في عملاء الاونلاين أو الدقي مثال كورس التخاطب ودبلومة التخاطب والتربية الخاصة، ودا غلط تماماً. مادام اتحول للمسار مينفعش تعرض الكورس الصغير. امسح بقى أي كورس
// صغير بيظهر لأي عميل في كل السيستم مادام نفس الكورس داخل المسار» (28 Oct 2026).
//
// A course inside a track the client holds is not an item beside it. Its price is the track's, and what was paid for it is the client's money all
// the same — counted toward the track, so nothing a client paid disappears with the row. The table (admin/lib/agreedPrice.ts) and the server's
// filters (lib/staffClientsView.js) apply the same rule, so a filter and a row cannot disagree.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-member-courses-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function adminClientItems() {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({ entryPoints: [path.join(ROOT, 'admin', 'lib', 'agreedPrice.ts')], bundle: true, write: false, format: 'cjs', platform: 'node' });
  const module_ = { exports: {} };
  new Function('module', 'exports', out.outputFiles[0].text)(module_, module_.exports);
  return module_.exports.clientItems;
}

const SLP = 'course-slp';        // أخصائي التخاطب
const SPECIAL = 'course-special'; // اخصائي التربية الخاصة
const OTHER = 'course-other';
const courses = [
  { id: SLP, title: 'أخصائي التخاطب', price: { EGP: 2800 } },
  { id: SPECIAL, title: 'اخصائي التربية الخاصة', price: { EGP: 2800 } },
  { id: OTHER, title: 'علم النفس الإيجابي', price: { EGP: 3800 } },
];
const bundles = [{ id: 'b1', title: 'دبلومة التخاطب والتربية الخاصة', price: { EGP: 4600 }, courses: [{ id: SLP }, { id: SPECIAL }] }];
const catalogue = {
  courses: new Map(courses.map(course => [course.id, course])),
  bundles: new Map([['b1', { ...bundles[0], courseIds: [SLP, SPECIAL] }]]),
};
const pay = (courseId, amount, extra = {}) => ({ id: `p-${courseId}-${amount}`, courseId, amount, currency: 'EGP', status: 'paid', paymentType: 'course', ...extra });

test('a client of the track does not also have its small courses listed — in the table', () => {
  const clientItems = adminClientItems();
  if (!clientItems) return;
  // the shape the sheets and old bookings leave: the track, plus a saved price and a payment on each member course
  const client = {
    enrolledBundleIds: ['b1'], enrolledCourseIds: [SLP, SPECIAL, OTHER],
    customPrices: { 'bundle:b1': 4600, [SLP]: 2800, [SPECIAL]: 2800 },
    paymentHistory: [pay(SLP, 1000), { id: 'p-b', bundleId: 'b1', amount: 1500, currency: 'EGP', status: 'paid', paymentType: 'course' }],
    priorPaid: { [SPECIAL]: 700 },
  };
  const items = clientItems(client, courses, bundles, 'EGP');
  assert.deepEqual(items.map(item => item.item).sort(), ['bundle:b1', OTHER].sort(), 'the track, and a course that is not in it');
  const track = items.find(item => item.item === 'bundle:b1');
  assert.equal(track.expected, 4600, 'its price is the track\'s, not the sum');
  assert.equal(track.paid, 1500 + 1000 + 700, 'what was paid for its small courses counts toward it');
  assert.equal(track.remaining, 4600 - 3200);
  assert.equal(items.find(item => item.item === OTHER).paid, 0);
});

test('money in another currency is not mixed into the track, and a client without the track keeps the course', () => {
  const clientItems = adminClientItems();
  if (!clientItems) return;
  const mixed = {
    enrolledBundleIds: ['b1'], enrolledCourseIds: [SLP],
    paymentHistory: [{ id: 'p1', bundleId: 'b1', amount: 1000, currency: 'EGP', status: 'paid', paymentType: 'course' }, pay(SLP, 300, { currency: 'SAR' })],
  };
  const items = clientItems(mixed, courses, bundles, 'EGP');
  assert.deepEqual(items.map(item => item.item), ['bundle:b1']);
  assert.equal(items[0].paid, 1000, 'riyals are not added to pounds');
  const single = { enrolledCourseIds: [SLP], customPrices: { [SLP]: 2800 }, paymentHistory: [pay(SLP, 500)] };
  const alone = clientItems(single, courses, bundles, 'EGP');
  assert.deepEqual(alone.map(item => [item.item, item.paid, item.remaining]), [[SLP, 500, 2300]], 'a course that is not inside a track of the client stays what it was');
  // one holding a pending payment on a member course: it travels with the track, still pending
  const pending = { enrolledBundleIds: ['b1'], paymentHistory: [pay(SLP, 400, { status: 'pending' })] };
  const withPending = clientItems(pending, courses, bundles, 'EGP');
  assert.deepEqual(withPending.map(item => [item.item, item.pending, item.paid]), [['bundle:b1', 400, 0]]);
});

test('the server\'s filters read the same items: the member course is not an item, and its money counts toward the track', () => {
  const { balanceOf } = require('../lib/staffClientsView');
  const client = {
    branch: 'ONLINE_EGYPT', enrolledBundleIds: ['b1'], enrolledCourseIds: [SLP, SPECIAL],
    customPrices: { 'bundle:b1': 4600, [SLP]: 2800, [SPECIAL]: 2800 },
    paymentHistory: [pay(SLP, 1000), { id: 'p-b', bundleId: 'b1', amount: 1500, currency: 'EGP', status: 'paid', paymentType: 'course' }],
    priorPaid: { [SPECIAL]: 700 },
  };
  const balance = balanceOf(client, catalogue);
  assert.equal(balance.items, 1, 'one item, the track');
  assert.equal(balance.remainingEgp, 4600 - 3200);
  assert.equal(balance.paidAnything, true);
  const withOther = balanceOf({ ...client, enrolledCourseIds: [SLP, SPECIAL, OTHER] }, catalogue);
  assert.equal(withOther.items, 2, 'a course outside the track is still an item');
});
