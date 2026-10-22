'use strict';

// «عند زر حجز او دفع قسط اوقات بيظهر ايرور … لازم يظهر سبب الايرور ايه … بالعربي»
// (13 Oct 2026). A refused booking or instalment says why, in Arabic: the server
// in its own words where it can, the screen translating the rest — without
// rewriting the message sign-in and the 401/409 handling read.

const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentModalSource } = require('./_adminSplitSource');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

function loadReason() {
  const ADMIN_MODULES = path.join(__dirname, '../../admin/node_modules');
  let esbuild;
  try { esbuild = require(path.join(ADMIN_MODULES, 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    stdin: { contents: "export { arabicReason } from './lib/apiErrorText';", resolveDir: path.join(__dirname, '../../admin'), loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', nodePaths: [ADMIN_MODULES],
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports.arabicReason;
}
const arabicReason = loadReason();

test('an Arabic reason from the server is shown as it is', { skip: !arabicReason }, () => {
  const message = 'العميل مسجل من قبل بنفس رقم التليفون: «أحمد» (كود C1)';
  assert.equal(arabicReason(new Error(message)), message);
});

test('«Internal server error» and a bare HTTP status are said in Arabic with what to do', { skip: !arabicReason }, () => {
  for (const raw of ['Internal server error', 'HTTP 500', 'HTTP 409', 'HTTP 403', 'Lead not found', 'Course does not belong to tenant']) {
    const said = arabicReason(new Error(raw));
    assert.match(said, /[؀-ۿ]/, `${raw} → ${said}`);
    assert.doesNotMatch(said, /Internal server error|Lead not found/);
  }
  assert.match(arabicReason(new Error('HTTP 409')), /مسجل من قبل|تعارض/);
});

test('an unreachable server and a timeout are told apart from a refusal', { skip: !arabicReason }, () => {
  assert.match(arabicReason(new TypeError('Failed to fetch')), /مفيش اتصال/);
  assert.match(arabicReason(new Error('The user aborted a request')), /اتأخر|راجع ملف العميل/);
});

test('nothing thrown still leaves a reason', { skip: !arabicReason }, () => {
  assert.equal(arabicReason(undefined), 'تعذّر إتمام العملية');
  assert.equal(arabicReason(new Error('weird'), 'تعذر حفظ الدفعة'), 'تعذر حفظ الدفعة (weird)');
});

test('the payment hooks send the reason under the key the toast reads, and the dialog translates', () => {
  for (const file of ['admin/pages/unified-client/useUnifiedClientPayments.ts', 'admin/pages/unified-client/useUnifiedClientLifecycleActions.ts']) {
    assert.match(read(file), /reason: arabicReason\(error\)/, file);
  }
  assert.match(paymentModalSource(), /setSubmitError\(arabicReason\(error, /);
  assert.match(read('admin/pages/Dashboard.tsx'), /arabicReason\(String\(detail\.reason\), ''\)/);
});

test('the booking route no longer answers a rep in English', () => {
  const route = read('api/routes/subscriber-payments.js');
  // Every error the booking/payment route returns carries Arabic text.
  const plain = [...route.matchAll(/res\.status\(\d+\)\.json\(\{\s*error:\s*'([^']*)'/g)].map(m => m[1])
    .filter(text => !/[؀-ۿ\\]/.test(text));
  assert.deepEqual(plain.filter(text => text !== 'Internal server error'), []);
});

test('a duplicate booking names the client who already has the number', () => {
  const route = read('api/routes/subscriber-payments.js');
  assert.match(route, /existingName: existing\.name/);
  assert.match(route, /المسئول عنه \$\{existing\.owner_name\}/);
});
