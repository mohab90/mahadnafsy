'use strict';

// «التزم بالمنيو الرئيسية والهدف بتاعنا — بدل زر الاستشارات يبقى زر الحجز».
// The new home page keeps the site's menu, drops the consultation / «هل لديك
// استفسار؟ تواصل معنا» calls to action in favour of booking, puts the
// certificate check straight under «لماذا نختار…», keeps it apart from the
// payment band, and reads everything it shows from the real catalogue.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const home = read('client/pages/Home.tsx');

const goals = () => {
  const js = require('node:module').stripTypeScriptTypes(read('shared/homeGoals.ts')).replace(/^export /gm, '');
  const module_ = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', `${js}\nmodule.exports = { goalsFromCourses, recommendedCourse };`)(module_, module_.exports);
  return module_.exports;
};

const course = (id, category, students, egp = 1000) => ({ id, category, students, price: { EGP: egp, SAR: 0, USD: 0 } });

test('the main menu is untouched', () => {
  const header = read('client/components/Header.tsx');
  for (const label of ['الرئيسية', 'عن المعهد', 'الكورسات', 'المسارات والباقات', 'الخبراء والمدربين', 'استشارات', 'المجتمع']) {
    assert.ok(header.includes(`>${label}</Link>`), `${label} is still in the menu`);
  }
});

test('the home page asks for a booking, not a consultation or a contact', () => {
  // The consultation banner only appears when marketing opts in (consultation.show_on_home === 'true').
  const shown = home.replace(/\{content\['consultation\.show_on_home'\] === 'true' && \([\s\S]*?\n      \)\}\n/, '');
  assert.ok(shown.length < home.length, 'the opt-in block was located');
  assert.doesNotMatch(shown, /to="\/consultations"/, 'a consultation button is back on the home page');
  assert.doesNotMatch(home, /هل لديك استفسار/);
  assert.doesNotMatch(home, /احجز استشارة/);
  assert.match(home, /<Link to="\/enroll"[^>]*>[\s\S]{0,80}احجز مكانك الآن/);
  assert.match(home, /جاهز تبدأ مسارك المهني/);
  assert.match(home, /offerIsShown\(content\)/, 'the 24-hour strip still follows the marketing switch');
  assert.match(home, /<a href="#offer"[^>]*>احجز الآن<\/a>/);
});

test('the sections follow one order: why → certificate check → payment → paths', () => {
  const at = marker => {
    const i = home.indexOf(marker);
    assert.ok(i > 0, `${marker} is on the page`);
    return i;
  };
  const why = at('<WhyChooseSection');
  const cert = at('<CertificateCheck');
  const pay = at('<PaymentBand');
  const paths = at('<PathsSection');
  assert.ok(why < cert && cert < pay && pay < paths, 'why, then the certificate check, then the payment band, then the paths');
  // The check is inside the same section as the reasons, the payment band is its own section.
  const section = home.slice(home.lastIndexOf('<section', why), home.indexOf('</section>', cert));
  assert.ok(section.includes('<CertificateCheck'), 'the certificate check sits directly under the reasons');
  assert.ok(!section.includes('<PaymentBand'), 'and the payment band is separate from it');
});

test('the payment band is full width, short, and reads the marketing rates', () => {
  const band = read('client/components/home/PaymentBand.tsx');
  assert.match(band, /<section id="pay"[^>]*w-full/);
  assert.match(band, /enrollmentRates\(content\)/, 'the percentages marketing sets');
  assert.match(band, /amountDueNow\(base, 'cash', rates\)/);
  assert.match(band, /installmentTotal\(base, rates\)/);
  assert.doesNotMatch(band, /\b15\s*%|\b7\s*%/, 'no hard-coded rate');
  assert.doesNotMatch(band, /py-(1[2-9]|[2-9]\d)\b/, 'a short band');
});

test('the certificate check opens the public verification page', () => {
  const check = read('client/components/home/CertificateCheck.tsx');
  assert.match(check, /\/certificate\/\$\{encodeURIComponent\(clean\)\}/);
  assert.match(read('client/App.tsx'), /path="\/certificate\/:code"/);
});

test('the paths are drawn from the published bundles, with the saving worked out, not typed', () => {
  const paths = read('client/components/home/PathsSection.tsx');
  assert.match(paths, /discountPercent\(bundle\.originalPrice/);
  assert.match(paths, /\/enroll\?bundle=/);
  assert.match(read('client/pages/Enrollment.tsx'), /searchParams\.get\('bundle'\)/, 'and the enrol page takes that link');
});

test('the goal finder offers the categories that have courses, and the course most people take', () => {
  const { goalsFromCourses, recommendedCourse } = goals();
  const courses = [
    course('t1', 'Therapy', 50), course('t2', 'Therapy', 400), course('t3', 'Therapy', 10),
    course('c1', 'Child', 90), course('c2', 'Child', 120),
    course('g1', 'General', 700),
    course('d1', 'Diagnosis', 5, 0), // free of a price: not sellable, so not offered
  ];
  const list = goalsFromCourses(courses);
  assert.deepEqual(list.map(g => g.id), ['Therapy', 'Child', 'General'], 'most courses first, and the unpriced category is left out');
  assert.equal(list[0].label, 'العلاج النفسي');
  assert.equal(recommendedCourse(courses, 'Therapy').id, 't2');
  assert.equal(recommendedCourse(courses, 'Child').id, 'c2');
  assert.equal(recommendedCourse(courses, 'Diagnosis'), null);
  assert.deepEqual(goalsFromCourses([]), [], 'nothing to offer, nothing drawn');
  assert.equal(goalsFromCourses(courses, 2).length, 2);
});

test('the home page still honours what marketing controls', () => {
  assert.match(home, /offerPrices\(content, offerCourse, currency\)/);
  assert.match(home, /isExpiryActive\(/);
  assert.match(home, /content\['home\.video\.url'\]/);
  assert.match(read('client/components/home/WhyChooseSection.tsx'), /content\['home\.video\.url'\]/);
  assert.match(home, /value="daqqi"/);
});

test('job and lecturer applications have a place on the page, and the code field is a short one', () => {
  assert.match(home, /<section id="join"/);
  assert.match(home, /<Link to="\/join" /);
  assert.match(home, /<Link to="\/join-us" /);
  const check = read('client/components/home/CertificateCheck.tsx');
  assert.match(check, /sm:w-44/, 'a field sized for a short code, not a long bar');
  assert.match(check, /toUpperCase\(\)/);
  assert.doesNotMatch(check, /maxLength/, 'older, longer codes still verify');
});

test('the reasons beside the tour video are compact, so the video matches their height', () => {
  const why = read('client/components/home/WhyChooseSection.tsx');
  assert.match(why, /lg:grid-cols-2 lg:items-stretch/);
  assert.match(why, /lg:aspect-auto lg:min-h-0/);
});
