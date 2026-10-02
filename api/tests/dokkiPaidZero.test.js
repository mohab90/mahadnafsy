'use strict';
/**
 * «عملاء الدقي — المدفوع 0 وده مش حقيقي».
 *
 * The Dokki front desk records money as PENDING until accounts approve it (the
 * person recording may not be the one approving — subscriber-payments.js), and
 * the clients table counts collected money only. So a client who had handed over
 * cash read «المدفوع 0» for as long as the approval waited, which for a whole
 * desk was every row. A pending payment is still not "paid", so it stays out of
 * the balance — but it is shown beside the zero instead of vanishing.
 *
 * Runs the admin's own helper (bundled with its esbuild); skipped where the
 * admin's packages are not installed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
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
const agreed = load('admin/lib/agreedPrice.ts');
const courses = [{ id: 'c1', title: 'دبلومة', price: { EGP: 5000 } }];
const dokki = extra => ({ id: 's', name: 'x', branch: 'DAQQI', paymentHistory: [], enrolledCourseIds: ['c1'], ...extra });
const row = (amount, extra = {}) => ({ id: `p${amount}${extra.status || ''}`, amount, currency: 'EGP', paymentType: 'course', courseId: 'c1', at: '2026-09-01', ...extra });

test('cash taken at the Dokki desk and not yet approved shows beside the zero', { skip: !agreed }, () => {
  const [item] = agreed.clientItems(dokki({ paymentHistory: [row(2000, { status: 'pending' })] }), courses, []);
  assert.equal(item.paid, 0, 'it is not collected yet, so the balance does not move');
  assert.equal(item.remaining, 5000);
  assert.equal(item.pending, 2000, 'but the desk can see the money is recorded and waiting');
});

test('approved money counts as paid and leaves nothing pending', { skip: !agreed }, () => {
  const [item] = agreed.clientItems(dokki({ paymentHistory: [row(2000, { status: 'paid' }), row(500, { status: 'pending' })] }), courses, []);
  assert.equal(item.paid, 2000);
  assert.equal(item.pending, 500);
  assert.equal(item.remaining, 3000);
});

test('a refunded payment is neither paid nor pending', { skip: !agreed }, () => {
  const [item] = agreed.clientItems(dokki({ paymentHistory: [row(2000, { status: 'refunded' })] }), courses, []);
  assert.equal(item.paid, 0);
  assert.equal(item.pending, 0);
});

test('a row typed «other» that names the course is that course\'s money', { skip: !agreed }, () => {
  const [item] = agreed.clientItems(dokki({ paymentHistory: [row(1500, { status: 'paid', paymentType: 'other' })] }), courses, []);
  assert.equal(item.paid, 1500);
});

test('a certificate or book payment never counts toward the course', { skip: !agreed }, () => {
  const [item] = agreed.clientItems(dokki({ paymentHistory: [row(300, { status: 'paid', paymentType: 'certificate' })] }), courses, []);
  assert.equal(item.paid, 0);
});
