'use strict';

// «لما التحصيل بيحاول يرفع دفع كبيرة تكون مثلا قسط في 3 كورسات محتاجين في الرفع
// نحدد المبلغ لكام كورس» (7 Oct 2026). The dialog let the desk add a course to
// an instalment, and the handler recorded the first course alone: the courses
// added were dropped without a word. Each is its own instalment now.
//
// Runs the admin's own handler (bundled with its esbuild); skipped where the
// admin's packages are not installed.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
function load(entry) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' }, jsx: 'automatic',
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
const handlers = load('admin/pages/dashboard/dashboardPaymentHandlers.ts');

const client = { id: 'sub-1', name: 'منى', branch: 'ONLINE_EGYPT', enrolledCourseIds: ['c-1', 'c-2', 'c-3'], paymentHistory: [], courseAccess: {} };
const draft = {
  paymentType: 'course', bookingType: 'installment', currency: 'EGP', courseId: 'c-1', amount: '1500',
  customExpected: '', discountPct: '', note: '', paymentMethod: 'instapay', date: '2026-10-07', transactionId: '', fromAccountNumber: '',
  extraItems: [
    { type: 'course', label: '', amount: '1000', courseId: 'c-2' },
    { type: 'course', label: '', amount: '500', courseId: 'bundle:b-9' },
    { type: 'carneh', label: 'كارنيه', amount: '150' },
  ],
};

test('one instalment over three courses records three instalments, each on its course', { skip: !handlers }, async () => {
  const recorded = [];
  await handlers.handleSubPaymentFn(draft, {
    subPayRow: client, subscribers: [client], bundles: [{ id: 'b-9', title: 'مسار', courses: [{ id: 'c-3' }], price: { EGP: 9000 } }],
    courses: [], content: {},
    recordSubscriberPayment: async (_id, payment) => { recorded.push(payment); return { status: 'paid' }; },
    reloadSubscribers: async () => {}, notify: () => {}, currentStaff: { id: 'st-1', name: 'Fatma' },
  });
  const instalments = recorded.filter(payment => payment.paymentType === 'course');
  assert.deepEqual(instalments.map(payment => [payment.courseId || `bundle:${payment.bundleId}`, payment.amount, payment.isInstallment]), [
    ['c-1', 1500, true], ['c-2', 1000, true], ['bundle:b-9', 500, true],
  ]);
  assert.equal(recorded.filter(payment => payment.paymentType === 'carneh').length, 1, 'and the carnet beside them');
  assert.equal(new Set(recorded.map(payment => payment.id)).size, recorded.length, 'each a payment of its own');
});
