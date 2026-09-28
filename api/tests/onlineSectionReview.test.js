'use strict';

// The online section's review, 28 September:
//   «فلتر علي مكتمل الدفع بيظهر العملاء اللى مدفعتش اي حاجه» — the balance
//     behind the filter counted only courses with a payment or a saved price,
//     at a catalogue price of nothing;
//   «عميل بيظهر كورسات الداخليه لمسار» — a track known only from its
//     enrolment showed as the courses inside it;
//   «إجمالي العملاء 1491 … محلي 1469 سعودي 4 دولي 4» — the list held Dokki and
//     Tagamoa clients the markets never counted;
//   «متخلص السيستم يقبل عميل دفع بدون رقم تليفون حقيقي».

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The admin's own helper, bundled on the spot, so the rule is run rather than
// read. Skipped where the admin's packages are not installed.
function loadOnlineUtils() {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'admin/pages/dashboard/tabs/onlineClientsUtils.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    // shared/ sits beside admin/, so its React comes from the admin's packages.
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')],
    // What Vite fills in; the API client reads it at load.
    define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
const utils = loadOnlineUtils();
const courses = [
  { id: 'c1', title: 'الصحة النفسية', price: { EGP: 3000, SAR: 300, USD: 80 } },
  { id: 'c2', title: 'الإرشاد', price: { EGP: 2000, SAR: 200, USD: 60 } },
  { id: 'c3', title: 'التربية', price: { EGP: 1500, SAR: 150, USD: 40 } },
];
const bundles = [{ id: 'b1', title: 'دبلومة', price: { EGP: 4600, SAR: 460, USD: 120 }, courses: [{ id: 'c2' }, { id: 'c3' }] }];
const client = extra => ({ id: 's', name: 'x', phone: '01012345678', branch: 'ONLINE_EGYPT', paymentHistory: [], enrolledCourseIds: [], ...extra });
const paid = (amount, extra = {}) => ({ id: `p${amount}`, amount, currency: 'EGP', status: 'paid', paymentType: 'course', at: '2026-09-01', ...extra });

test('enrolled with nothing paid is not «مكتمل الدفع»', { skip: !utils }, () => {
  const balance = utils.subscriberBalance(client({ enrolledCourseIds: ['c1'] }), courses, bundles);
  assert.equal(balance.remainingEgp, 3000, 'the catalogue price is owed');
  assert.equal(utils.isFullyPaid(balance), false);
});

test('paid in full is «مكتمل الدفع»; paid in part is not', { skip: !utils }, () => {
  const full = utils.subscriberBalance(client({ enrolledCourseIds: ['c1'], paymentHistory: [paid(3000, { courseId: 'c1' })] }), courses, bundles);
  assert.equal(utils.isFullyPaid(full), true);
  const part = utils.subscriberBalance(client({ enrolledCourseIds: ['c1'], paymentHistory: [paid(1000, { courseId: 'c1' })] }), courses, bundles);
  assert.equal(part.remainingEgp, 2000);
  assert.equal(utils.isFullyPaid(part), false);
});

test('a client holding nothing is neither paid up nor owing', { skip: !utils }, () => {
  const balance = utils.subscriberBalance(client({}), courses, bundles);
  assert.deepEqual([balance.items, balance.remainingEgp, utils.isFullyPaid(balance)], [0, 0, false]);
});

test('a track known only from its enrolment is the track, not its courses', { skip: !utils }, () => {
  const balance = utils.subscriberBalance(client({ enrolledCourseIds: ['c2', 'c3'], enrolledBundleIds: ['b1'] }), courses, bundles);
  assert.equal(balance.items, 1, 'one item: the track');
  assert.equal(balance.remainingEgp, 4600, 'owed at the track price, not the two courses added up');
});

test('the online list is online clients only, and its numbers are the markets\' sum', { skip: !utils }, () => {
  assert.equal(utils.isOnlineClient(client({ branch: 'DAQQI' })), false);
  assert.equal(utils.isOnlineClient(client({ branch: 'TAGAMOA' })), false);
  assert.equal(utils.isOnlineClient(client({ branch: 'ONLINE_SAUDI' })), true);
  const tab = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  assert.match(tab, /: branchScopedMasterList\.filter\(isOnlineClient\);/);
  assert.match(tab, /if \(collOnlineRemainingFilter === 'paid' && !isFullyPaid\(balanceOf\(s\)\)\) return false;/);
  assert.match(tab, /if \(collOnlineCourseFilter && !holdsItem\(s, collOnlineCourseFilter\)\) return false;/);
});

test('every admin list sends the tracks a client was enrolled in', () => {
  const lists = read('api/routes/admin/stafflists.js');
  assert.equal(lists.split('enrolledBundleIds: enrollmentProjection[r.id]?.bundleIds || [],').length - 1, 5);
  assert.match(lists, /SELECT subscriber_id,course_id,bundle_id,access_type,lecture_limit FROM enrollments/);
  assert.match(read('api/routes/admin/subscribers.js'), /\.\.\.crm, enrolledCourseIds, enrolledBundleIds, courseAccess,/);
  assert.match(read('admin/lib/agreedPrice.ts'), /\(subscriber\.enrolledBundleIds \|\| \[\]\)\.forEach\(id => \{ if \(id\) keys\.add\(`bundle:\$\{id\}`\); \}\);/);
});

test('no payment is recorded for a client without a real phone', () => {
  const { isRealPhone } = require('../lib/phoneNumber');
  for (const good of ['01012345678', '+20 101 234 5678', '966501234567', '14155552671']) assert.equal(isRealPhone(good), true, good);
  for (const bad of ['', null, '12345', '0223456789', '01000000000', '01111111111']) assert.equal(isRealPhone(bad), false, String(bad));
  const payments = read('api/routes/subscriber-payments.js');
  assert.match(payments, /if \(!isRealPhone\(subRow\.phone\)\) \{\s+return res\.status\(400\)\.json\(\{/);
  assert.match(read('api/routes/installments.js'), /if \(!isRealPhone\(plan\.subscriber_phone\)\) \{/);
  assert.match(read('api/routes/auth.js'), /if \(firstPayment && Number\(firstPayment\.amount\) > 0\) \{\s+\/\/ No money against a client who cannot be reached[^\n]*\n\s+if \(!isRealPhone\(phone\)\)/);
});

test('the archive sits inside «قاعدة العملاء»; a refund starts from a payment', () => {
  const db = read('admin/pages/dashboard/tabs/ClientDbTab.tsx');
  assert.match(db, /\.\.\.\(canSeeArchive \? \[\['archive', '🗄️ الأرشيف'\]\] as const : \[\]\)/);
  assert.match(db, /view === 'archive' \? <ArchivedClientsTab notify=\{notify\} \/>/);
  const tab = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  assert.match(tab, /await mysqlAdmin\.createRefundByAdmin\(\{\s+subscriber_id: convertRow\.id, payment_id: payment\.id,/);
  const bar = read('admin/pages/dashboard/tabs/online-clients-sections/ViewTabsBar.tsx');
  assert.match(bar, /label: 'النشطين'/);
  assert.doesNotMatch(bar, /[^.\w]confirm\(/, 'distribution asks through confirmDialog');
  assert.match(bar, /<Settings size=\{15\} \/>/, 'settings is an icon');
});
