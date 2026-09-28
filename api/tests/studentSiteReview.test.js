'use strict';

// The student site's review, 28 September.
//   - «ادفع قسطا» and every balance in /my-account summed pound payments only —
//     pending and refunded ones too — against a price found on the first cash
//     payment: a riyal client had paid nothing, a track had no row, and the
//     price the desk agreed never showed.
//   - A customer who signed up by WhatsApp has no email, and checkout demanded
//     an «@» the server no longer asks for: they could not buy anything.
//   - Checkout kept no real phone, against «متخلص السيستم يقبل عميل دفع بدون رقم
//     تليفون حقيقي».
//   - A locked lecture sent an enrolled student to buy the course again.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function loadClientModule(rel) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, rel)], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
const itemBalance = loadClientModule('client/lib/itemBalance.ts');

test('a course inside a track shows the track\'s balance; its own balance wins', { skip: !itemBalance }, () => {
  const balances = [
    { item: 'bundle:b1', courseId: null, bundleId: 'b1', title: 'دبلومة', currency: 'SAR', expected: 460, paid: 200, priorPaid: 0, remaining: 260 },
    { item: 'c9', courseId: 'c9', bundleId: null, title: 'كورس', currency: 'EGP', expected: 900, paid: 900, priorPaid: 0, remaining: 0 },
  ];
  const bundles = [{ id: 'b1', courses: [{ id: 'c1' }, { id: 'c2' }, { id: 'c9' }] }];
  const byCourse = itemBalance.balancesByCourse(balances, bundles);
  assert.equal(byCourse.c1.remaining, 260);
  assert.equal(byCourse.c1.trackTitle, 'دبلومة');
  assert.equal(byCourse.c1.currency, 'SAR');
  assert.equal(byCourse.c9.remaining, 0, 'bought on its own too');
  assert.equal(itemBalance.moneySuffix('SAR'), 'ر.س');
});

test('the account page reads the server\'s balances', () => {
  const route = read('api/routes/public.js');
  assert.match(route, /const balanceMap = await itemBalances\(pool, \{ tenantId: req\.tenantId, subscriberId: sub\.id \}\);/);
  assert.match(route, /res\.json\(\{ \.\.\.mapped, enrolledCoursesData, balances \}\);/);
  const page = read('client/pages/UserDashboard.tsx');
  assert.match(page, /const coursePayMap = balancesByCourse\(balances, bundles\);/);
  assert.doesNotMatch(page, /if \(p\.currency === 'EGP'\) coursePayMap/);
  assert.match(page, /أرغب في دفع قسط بمبلغ \$\{amt\.toLocaleString\('ar-EG-u-nu-latn'\)\} \$\{moneySuffix\(installModal\.currency\)\}/);
  assert.match(read('client/components/student-dashboard/StudentPaymentsTab.tsx'), /\{balances\.map\(balance => \{/);
  // Only enrolments still active are owed for.
  assert.match(read('api/lib/agreedPrice.js'), /FROM enrollments WHERE tenant_id=\? AND subscriber_id=\? AND status='active'/);
});

test('checkout takes a WhatsApp-only customer, and keeps a real phone', () => {
  const page = read('client/pages/Checkout.tsx');
  assert.match(page, /const emailOk = customerEmail\.trim\(\) \? customerEmail\.includes\('@'\) : !authUser\?\.email;/);
  assert.match(page, /const canPay = !!customerName\.trim\(\) && emailOk && customerPhone\.replace\(\/\\D\/g, ''\)\.length >= 9/);
  const route = read('api/routes/lead-capture-crm.js');
  assert.match(route, /if \(!isRealPhone\(String\(customerPhone \|\| identity\?\.phone \|\| ''\)\.trim\(\)\)\) \{/);
});

test('a locked lecture sends an enrolled student to their balance, not to buy again', () => {
  assert.match(read('client/pages/CourseDetails.tsx'),
    /onLockedLectureClick=\{\(\) => navigate\(isEnrolled \? '\/my-account\?section=payments' : `\/checkout\?type=course&id=\$\{course\.id\}`\)\}/);
});
