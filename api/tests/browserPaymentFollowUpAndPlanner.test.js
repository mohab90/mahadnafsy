'use strict';
// More of the browser's own code, run for real (esbuild from the admin's dependencies, react-dom/server for the one component):
//   - the rows a payment dialog's «الإضافات» turn into (admin/lib/extraPaymentEntries.ts), with the price rules each kind of row follows;
//   - the Arabic reason a refused save shows (admin/lib/apiErrorText.ts);
//   - who is due a follow-up and the filters over it (admin/lib/clientFollowUp.ts) and who is at risk (admin/lib/clientsAtRisk.ts);
//   - the home page's payment calculator drawn in each currency (client/components/home/PaymentPlanner.tsx).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROOT, bundle } = require('./support/repo');

const entries = bundle('admin/lib/extraPaymentEntries.ts');
const errors = bundle('admin/lib/apiErrorText.ts');
const follow = bundle('admin/lib/clientFollowUp.ts');
const risk = bundle('admin/lib/clientsAtRisk.ts');
const skip = entries ? false : 'the admin dependencies are not installed';

// ── the payment dialog's added rows ─────────────────────────────────────────

const courses = [
  { id: 'c1', title: 'Course one', titleAr: 'الكورس الأول', price: { EGP: 4000, SAR: 0, USD: 90 } },
  { id: 'c2', title: 'Course two', price: { EGP: 0, SAR: 0, USD: 0 } },
];
const bundles = [{ id: 'b1', title: 'Full track', price: { EGP: 9000, SAR: 0, USD: 0 } }];
const staff = { id: 'st-1', name: 'Mona' };
const draft = (extraItems, over = {}) => ({ currency: 'EGP', paymentMethod: 'Vodafone Cash', date: '2026-10-05', extraItems, ...over });
const build = (extraItems, over, noteParts = ['paid at the desk']) => entries.extraPaymentEntries(draft(extraItems, over), { courses, bundles, staff, noteParts, now: 1000 });

test('an extra row with no amount, or a course row with no course chosen, records nothing', { skip }, () => {
  assert.deepEqual(build([{ type: 'book', amount: 0 }, { type: 'book', amount: '' }, { type: 'book', amount: -5 }, { type: 'book', amount: 'abc' }]), []);
  assert.deepEqual(build([{ type: 'course', amount: 500, courseId: '' }]), []);
  assert.deepEqual(build(undefined), []);
});

test('a book, a certificate or a consultation is its own payment, never an instalment, in the dialog\'s currency, by the signed-in staff member', { skip }, () => {
  const [book, cert] = build([{ type: 'book', amount: '250.5', label: 'Book' }, { type: 'certificate', amount: 700, certType: 'AIN_SHAMS', label: 'Certificate' }], { currency: 'SAR' });
  assert.deepEqual([book.paymentType, book.amount, book.currency, book.isInstallment, book.status], ['book', 250.5, 'SAR', false, 'paid']);
  assert.equal(book.note, 'Book | paid at the desk');
  assert.deepEqual([book.staffId, book.staffName, book.source, book.at, book.paymentMethod], ['st-1', 'Mona', 'staff', '2026-10-05', 'Vodafone Cash']);
  assert.equal(cert.certType, 'AIN_SHAMS');
  assert.equal(book.certType, undefined, 'only a certificate carries a certificate type');
  assert.equal(book.id, 'pay-1000-xtra-0');
  assert.equal(cert.id, 'pay-1000-xtra-1', 'every row has its own id');
});

test('a course the client already holds is an instalment on it, with a price only when the desk changed it', { skip }, () => {
  const [plain, repriced, inTrack] = build([
    { type: 'course', amount: 1000, courseId: 'c1' },
    { type: 'course', amount: 1000, courseId: 'c1', customExpected: '3500' },
    { type: 'course', amount: 2000, courseId: 'bundle:b1' },
  ]);
  assert.deepEqual([plain.paymentType, plain.isInstallment, plain.courseId, plain.courseExpected], ['course', true, 'c1', undefined]);
  assert.equal(repriced.courseExpected, 3500);
  assert.deepEqual([inTrack.bundleId, inTrack.courseId, inTrack.isInstallment], ['b1', undefined, true]);
  assert.match(inTrack.note, /مسار تعليمي: Full track/);
});

test('a new booking carries its price: the desk\'s own, else the catalogue less a percentage, else the catalogue — rounded to a whole pound', { skip }, () => {
  const book = item => build([{ type: 'course', amount: 500, newBooking: true, courseId: 'c1', ...item }])[0];
  assert.equal(book({}).courseExpected, 4000);
  assert.equal(book({ discountPct: 15 }).courseExpected, 3400);
  assert.equal(book({ discountPct: 33 }).courseExpected, 2680);
  assert.equal(book({ discountPct: 12.5 }).courseExpected, 3500);
  assert.equal(book({ customExpected: 2999.5, discountPct: 50 }).courseExpected, 2999.5, 'a typed price beats a percentage');
  assert.equal(book({}).isInstallment, false);
  assert.equal(book({ courseId: 'bundle:b1' }).courseExpected, 9000);
  assert.equal(book({ courseId: 'bundle:b1' }).bundleId, 'b1');
});

test('a new booking with no price in the dialog\'s currency is refused by name, not recorded for nothing', { skip }, () => {
  assert.throws(() => build([{ type: 'course', amount: 500, newBooking: true, courseId: 'c2' }]), /Course two.*EGP/s);
  assert.throws(() => build([{ type: 'course', amount: 500, newBooking: true, courseId: 'c1' }], { currency: 'SAR' }), /الكورس الأول.*SAR/s);
  // …unless the desk typed the agreed price.
  const [ok] = build([{ type: 'course', amount: 500, newBooking: true, courseId: 'c2', customExpected: 1200 }]);
  assert.equal(ok.courseExpected, 1200);
});

test('a refused save is explained in Arabic: the server\'s own Arabic first, then what the English text means, then the status', { skip }, () => {
  const reason = errors.arabicReason;
  assert.equal(reason(new Error('العميل ده مخفي — رجّعه الأول')), 'العميل ده مخفي — رجّعه الأول');
  assert.match(reason(new Error('Internal server error')), /خطأ في السيرفر/);
  assert.match(reason(new Error('Subscriber not found')), /مش موجود/);
  assert.match(reason(new Error('Subscriber is outside your financial scope')), /خارج نطاق صلاحياتك/);
  assert.match(reason(new Error('Failed to fetch')), /مفيش اتصال/);
  assert.match(reason(new Error('The operation timed out')), /اتأخر في الرد/);
  assert.match(reason(new Error('HTTP 409')), /تعارض/);
  assert.match(reason(new Error('Request failed with 429')), /محاولات كثيرة/);
  assert.match(reason(new TypeError('x')), /مفيش اتصال/, 'a TypeError from fetch is a network failure');
  assert.match(reason('permission denied: manage_payments'), /صلاحياتك/);
  assert.equal(reason(undefined), 'تعذّر إتمام العملية');
  assert.equal(reason(new Error('weird thing'), 'فشل الحفظ'), 'فشل الحفظ (weird thing)');
  assert.equal(reason({}), 'تعذّر إتمام العملية');
});

test('a follow-up is due by the contact the team set or an instalment that has fallen due, and the more urgent decides the status', { skip }, () => {
  const TODAY = '2026-10-10';
  const row = over => ({ id: 's', communications: [], installmentPlans: [], ...over });
  assert.deepEqual(follow.followUpOf(row({}), TODAY), { date: null, status: 'none', reasons: [], contactDate: null, installmentDate: null });
  assert.equal(follow.followUpOf(row({ nextFollowUpDate: '2026-10-09' }), TODAY).status, 'overdue');
  assert.equal(follow.followUpOf(row({ nextFollowUpDate: '2026-10-10' }), TODAY).status, 'today');
  assert.equal(follow.followUpOf(row({ nextFollowUpDate: '2026-10-11' }), TODAY).status, 'tomorrow');
  assert.equal(follow.followUpOf(row({ nextFollowUpDate: '2026-10-17' }), TODAY).status, 'week');
  assert.equal(follow.followUpOf(row({ nextFollowUpDate: '2026-10-18' }), TODAY).status, 'later');
  assert.equal(follow.followUpOf(row({ nextFollowUpDate: '2026-12-31' }), '2026-12-31').status, 'today');
  assert.equal(follow.followUpOf(row({ nextFollowUpDate: '2027-01-01' }), '2026-12-31').status, 'tomorrow', 'tomorrow across a year end');

  const lastContact = row({ communications: [{ date: '2026-09-01', nextFollowUp: '2026-09-02' }, { date: '2026-10-01', nextFollowUp: '2026-10-12' }] });
  assert.equal(follow.followUpOf(lastContact, TODAY).contactDate, '2026-10-12', 'the latest communication sets the next contact');

  const plans = dueDate => row({ installmentPlans: [{ entries: [{ dueDate, paidAt: null }, { dueDate: '2026-01-01', paidAt: '2026-01-02' }] }] });
  const dueInstalment = follow.followUpOf(plans('2026-10-05'), TODAY);
  assert.deepEqual([dueInstalment.status, dueInstalment.reasons, dueInstalment.installmentDate], ['overdue', ['installment'], '2026-10-05']);
  assert.deepEqual(follow.followUpOf(plans('2026-11-05'), TODAY).reasons, [], 'an instalment next month is not a follow-up yet');
  const both = follow.followUpOf(row({ nextFollowUpDate: '2026-10-15', installmentPlans: [{ entries: [{ dueDate: '2026-10-08' }] }] }), TODAY);
  assert.deepEqual([both.date, both.status, both.reasons], ['2026-10-08', 'overdue', ['contact', 'installment']], 'the earlier of the two decides');
});

test('the follow-up filters select exactly the statuses they promise', { skip }, () => {
  const statuses = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none'];
  const matching = filter => statuses.filter(status => follow.matchesFollowFilter({ status }, filter));
  assert.deepEqual(matching(''), statuses);
  assert.deepEqual(matching('due'), ['overdue', 'today']);
  assert.deepEqual(matching('week'), ['today', 'tomorrow', 'week']);
  assert.deepEqual(matching('none'), ['none']);
  assert.deepEqual(matching('overdue'), ['overdue']);
  assert.deepEqual(matching('tomorrow'), ['tomorrow']);
  assert.deepEqual(follow.FOLLOW_FILTERS.map(([key]) => key), ['', 'due', 'overdue', 'today', 'tomorrow', 'week', 'none']);
});

test('a client is at risk on any two of: a low rating, two missed lectures, money owed', { skip }, () => {
  assert.equal(risk.riskOf({}).atRisk, false);
  assert.equal(risk.riskOf({ latestRating: 3 }).atRisk, false, 'one reason is not a risk');
  assert.equal(risk.riskOf({ latestRating: 3, owed: 1500 }).atRisk, true);
  assert.equal(risk.riskOf({ sessions: 6, attended: 4, owed: 0.5 }).atRisk, true);
  assert.equal(risk.riskOf({ sessions: 6, attended: 5, owed: 100 }).atRisk, false, 'one missed lecture is not two');
  assert.equal(risk.riskOf({ latestRating: 5, sessions: 10, attended: 0 }).atRisk, false, 'a rating of exactly 5 is not low');
  assert.equal(risk.riskOf({ latestRating: 4, sessions: 10, attended: 7 }).atRisk, true);
  assert.deepEqual(risk.riskOf({ latestRating: 2, sessions: 5, attended: 2, owed: 1234.6 }).reasons, ['تقييمه 2/10', 'غاب 3 محاضرات', 'عليه 1,235 ج.م']);
  assert.deepEqual(risk.riskOf({ sessions: 1, attended: 3 }).reasons, [], 'attending more than the sessions held is not a negative miss');
});

// ── the home page's payment calculator ─────────────────────────────────────

function loadPlanner() {
  let esbuild; let React; let server;
  const nm = path.join(ROOT, 'admin', 'node_modules');
  try {
    esbuild = require(path.join(nm, 'esbuild'));
    React = require(path.join(nm, 'react'));
    server = require(path.join(nm, 'react-dom', 'server'));
  } catch { return null; }
  const planner = path.join(ROOT, 'client', 'components', 'home', 'PaymentPlanner');
  const out = esbuild.buildSync({
    stdin: {
      contents: `export { default as PaymentPlanner } from ${JSON.stringify(planner)}; export { MemoryRouter } from 'react-router-dom';`,
      resolveDir: path.join(ROOT, 'client'), loader: 'ts',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'transform', logLevel: 'silent',
    nodePaths: [nm], define: { 'import.meta.env': '{}' }, external: ['react', 'react-dom'],
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, id => (id === 'react' ? React : require(path.join(nm, id))));
  const { PaymentPlanner, MemoryRouter } = module.exports;
  return props => server.renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(PaymentPlanner, props)));
}

const planner = loadPlanner();
const plannerSkip = planner ? false : 'the client dependencies are not installed';
const catalogue = [
  { id: 'a', title: ' Popular ', students: 900, price: { EGP: 10000, SAR: 2000, USD: 0 }, shortDescription: '<p>About <b>it</b></p>' },
  { id: 'b', title: 'Niche', students: 10, price: { EGP: 6000, SAR: 0, USD: 0 } },
  { id: 'free', title: 'Not priced here', students: 5000, price: { EGP: 0, SAR: 0, USD: 0 } },
];
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the calculator opens on the most popular priced course and shows the cash price under the default discount', { skip: plannerSkip }, () => {
  const html = planner({ content: {}, courses: catalogue, currency: 'EGP' });
  const page = text(html);
  assert.match(page, /Popular/);
  assert.match(page, /8,500 ج\.م/, '10,000 less the 15% cash discount');
  assert.match(page, /10,000 ج\.م/, 'the list price is struck through beside it');
  assert.match(page, /خصم 15%/);
  assert.match(page, /خصم 7%/);
  assert.match(page, /About it/, 'the description is shown without its markup');
  assert.doesNotMatch(html, /Not priced here/, 'a course with no price in this currency is not offered');
  assert.match(html, /href="\/enroll\?course=a"/);
});

test('the calculator follows the currency and the discounts marketing set, and says nothing for an empty catalogue', { skip: plannerSkip }, () => {
  const sar = text(planner({ content: {}, courses: catalogue, currency: 'SAR' }));
  assert.match(sar, /1,700 ر\.س/, '2,000 less 15%');
  assert.doesNotMatch(sar, /Niche/, 'a course with no riyal price is not offered in riyals');
  const custom = text(planner({ content: { 'enroll.cashDiscountPercent': '20', 'enroll.installDiscountPercent': '10' }, courses: catalogue, currency: 'EGP' }));
  assert.match(custom, /8,000 ج\.م/);
  assert.match(custom, /خصم 20%/);
  assert.match(custom, /خصم 10%/);
  const typo = text(planner({ content: { 'enroll.cashDiscountPercent': '150' }, courses: catalogue, currency: 'EGP' }));
  assert.match(typo, /8,500 ج\.م/, 'an impossible discount is ignored');
  const chosen = text(planner({ content: {}, courses: catalogue, currency: 'EGP', initialCourseId: 'b' }));
  assert.match(chosen, /5,100 ج\.م/, 'the course the page was opened for');
  assert.doesNotMatch(text(planner({ content: {}, courses: catalogue, currency: 'USD' })), /احسب قسطك/, 'no priced course, no calculator');
});
