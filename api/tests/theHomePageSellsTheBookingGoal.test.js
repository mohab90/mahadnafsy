'use strict';

// «التزم بالمنيو الرئيسية والهدف بتاعنا — بدل زر الاستشارات يبقى زر الحجز».
// The new home page (client/pages/HomeNew.tsx, served at /new beside the real one, which stays
// exactly as it was) keeps the site's menu, drops the consultation / «هل لديك
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
const home = read('client/pages/HomeNew.tsx');
const hero = read('client/components/home/HeroSection.tsx');
const consultation = read('client/components/home/ConsultationSection.tsx');
const offer = read('client/components/home/OfferSpotlight.tsx');
const planner = read('client/components/home/PaymentPlanner.tsx');

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

test('the home page leads with booking and keeps the consultation slide', () => {
  assert.doesNotMatch(home, /احجز استشارة/);
  assert.match(home, /<Link to="\/enroll"[^>]*>[\s\S]{0,80}احجز مكانك الآن/);
  assert.match(hero, /ابدأ مسارك المهني في <span[^>]*>الصحة النفسية<svg[\s\S]*?<\/svg><\/span> بتدريب نظري وعملي مع أفضل دكاترة علم النفس وبشهادة معتمدة/);
  assert.match(hero, /<Link to="\/enroll"[^>]*>[\s\S]{0,80}احجز مكانك الآن/, 'the hero leads with booking');
  assert.match(home, /offerIsShown\(content\)/, 'the 24-hour strip still follows the marketing switch');
  assert.match(home, /<a href="#offer"[^>]*>احجز الآن<\/a>/);
  assert.match(home, /content\['consultation\.show_on_home'\] !== 'false' && <ConsultationSection/);
  assert.match(consultation, /متاح الآن — جلسة فورية/);
  assert.match(consultation, /احجز جلستك الآن/);
  assert.match(consultation, /expressPrice\(content, currency\)/);
  assert.match(consultation, /content\['express\.therapistId'\]/, 'with the therapist who takes the session');
});

test('«مش عارف تبدأ منين؟» sits at the end, right above one closing slide for booking and joining', () => {
  assert.doesNotMatch(hero, /<GoalFinder/, 'no longer in the hero');
  assert.doesNotMatch(hero, /تواصل معنا|\/contact/, 'and no contact button at the top');
  const find = home.indexOf('<GoalFinder');
  const closing = home.indexOf('{/* Closing slide');
  assert.ok(find > 0 && closing > find, 'the finder comes right before the closing slide');
  assert.ok(home.indexOf('<PaymentPlanner') < find, 'the payment section is still above it');
  const slide = home.slice(closing, home.indexOf('export default Home'));
  // One slide: booking on the red half, joining on the dark half, the graduates between them.
  assert.match(slide, /جاهز تبدأ مسارك المهني/);
  assert.match(slide, /bg-primary-700/);
  assert.match(slide, /bg-\[#1a0f12\]/);
  assert.match(slide, /brand\/graduates\.jpg/);
  for (const to of ['/enroll', '/courses', '/join', '/join-us']) assert.ok(slide.includes(`<Link to="${to}"`), `${to} is on the slide`);
  assert.ok(slide.includes('انضم إلينا كمحاضر') && slide.includes('انضم إلينا كموظف'));
  // The contact button and the separate «هل لديك استفسار؟» slide are gone.
  assert.doesNotMatch(home, /هل لديك استفسار/);
  assert.doesNotMatch(home, /<Link to="\/contact"/);
  assert.ok(fs.existsSync(path.join(root, 'client/public/brand/graduates.jpg')), 'the photo ships with the site');
});

test('the sections follow one order: why → certificate check → payment → paths', () => {
  const at = marker => {
    const i = home.indexOf(marker);
    assert.ok(i > 0, `${marker} is on the page`);
    return i;
  };
  const why = at('<WhyChooseSection');
  const cert = at('<CertificateCheck');
  const pay = at('<PaymentPlanner');
  const paths = at('<PathsSection');
  assert.ok(why < cert && cert < pay && pay < paths, 'why, then the certificate check, then the payment band, then the paths');
  // The check is inside the same section as the reasons, the payment band is its own section.
  const section = home.slice(home.lastIndexOf('<section', why), home.indexOf('</section>', cert));
  assert.ok(section.includes('<CertificateCheck'), 'the certificate check sits directly under the reasons');
  assert.ok(!section.includes('<PaymentPlanner'), 'and the payment section is separate from it');
});

test('the payment calculator reads the marketing rates', () => {
  assert.match(planner, /<section id="pay"/);
  assert.match(planner, /enrollmentRates\(content\)/, 'the percentages marketing sets');
  assert.match(planner, /amountDueNow\(base, 'cash', rates\)/);
  assert.match(planner, /installmentTotal\(base, rates\)/);
  assert.match(planner, /\/enroll\?course=\$\{encodeURIComponent\(course\.id\)\}/, 'and books the programme it priced');
  for (const file of ['PaymentPlanner', 'HomeFaq']) {
    assert.doesNotMatch(read(`client/components/home/${file}.tsx`), /\b15\s*%|\b7\s*%/, `no hard-coded rate in ${file}`);
  }
});

test('the certificate check opens the public verification page', () => {
  const check = read('client/components/home/CertificateCheck.tsx');
  assert.match(check, /\/certificate\/\$\{encodeURIComponent\(clean\)\}/);
  assert.match(read('client/App.tsx'), /path="\/certificate\/:code"/);
});

test('the home page shows three paths, never the long integrated programme', () => {
  const js = require('node:module').stripTypeScriptTypes(read('shared/homePaths.ts')).replace(/^export /gm, '');
  const module_ = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', `${js}\nmodule.exports = { bundlesForHome, HOME_PATHS_MAX };`)(module_, module_.exports);
  const { bundlesForHome, HOME_PATHS_MAX } = module_.exports;
  const list = [
    { title: 'دبلومة العلاج النفسي المتكامل " دراسة سنه ونص "' },
    { title: 'دبلومة علم النفس المتكامل' }, { title: 'التشخيص الإكلينيكي' }, { title: 'المعالج النفسي المحترف' },
    { title: 'سكيما' }, { title: 'التخاطب' }, { title: 'الكوتش' },
  ];
  const shown = bundlesForHome(list);
  assert.equal(HOME_PATHS_MAX, 3);
  assert.deepEqual(shown.map(b => b.title), ['دبلومة علم النفس المتكامل', 'التشخيص الإكلينيكي', 'المعالج النفسي المحترف']);
  assert.equal(bundlesForHome([]).length, 0);
  assert.match(read('client/components/home/PathsSection.tsx'), /bundlesForHome\(bundles\)/);
});

test('the payment calculator names the programme clearly, with a line about it', () => {
  assert.match(planner, /text-xl font-black[^"]*">\{course\.title\.trim\(\)\}/);
  assert.match(planner, /\{blurb && /);
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
  assert.match(offer, /offerPrices\(content, offerCourse, currency\)/);
  assert.match(home, /offerShown && <OfferSpotlight/);
  assert.match(home, /isExpiryActive\(/);
  assert.match(home, /content\['home\.video\.url'\]/);
  assert.match(read('client/components/home/WhyChooseSection.tsx'), /content\['home\.video\.url'\]/);
  assert.match(offer, /value="daqqi"/);
  assert.match(offer, /source: 'عرض 24 ساعة'/, 'the offer form still lands in العملاء المحتملون under its source');
});

test('the certificate code field is a short one', () => {
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

test('the new home page is a page of its own at /new: the real home page is untouched, and /new is never indexed', () => {
  const app = read('client/App.tsx');
  assert.match(app, /<Route path="\/" element=\{<Home \/>\} \/>/, 'the real home page is still at /');
  assert.match(app, /<Route path="\/new" element=\{lazyPage\(<HomeNew \/>\)\} \/>/);
  assert.match(app, /React\.lazy\(\(\) => import\('\.\/pages\/HomeNew'\)\)/, 'loaded only when /new is opened');
  assert.match(home, /noindex, nofollow/);
  assert.match(home, /useSeo\(\{[^}]*path: '\/'/, 'its canonical is the real home page');
  const original = read('client/pages/Home.tsx');
  for (const name of ['GoalFinder', 'PaymentPlanner', 'PathsSection', 'WhyChooseSection', 'CertificateCheck', 'HeroSection', 'GraduatesGallery']) {
    assert.ok(!original.includes(name), `the real home page does not use ${name}`);
  }
  assert.match(original, /consultation\.show_on_home/);
});

test('the hero shows three real graduates, small files, described for screen readers', () => {
  const tiles = [...hero.matchAll(/src: '([^']+\.jpg)', alt: '([^']+)'/g)];
  assert.equal(tiles.length, 3, 'three graduates');
  for (const [, file, alt] of tiles) {
    assert.ok(alt.length > 10, `${file} is described`);
    assert.ok(fs.statSync(path.join(root, 'client/public/brand/grads', file)).size < 200 * 1024, `${file} is under 200KB`);
  }
  assert.match(hero, /brand\/grads\/\$\{g\.src\}/);
});

test('the graduation photos ship with the site and open in the one lightbox', () => {
  const gallery = read('client/components/home/GraduatesGallery.tsx');
  const photos = [...gallery.matchAll(/\{ src: '([^']+\.jpg)', alt: '[^']+' \}/g)].map(m => m[1]);
  assert.ok(photos.length >= 6, 'a wall of real photos');
  for (const file of photos) assert.ok(fs.statSync(path.join(root, 'client/public/brand/grads', file)).size < 300 * 1024, `${file} is light enough`);
  assert.match(home, /className="fixed inset-0 z-\[80\]/, 'on the shared stacking scale');
  assert.match(home, /GRADUATION_PHOTOS\[lightbox\.index\]/);
});

test('every picture below the first screen loads lazily', () => {
  const dir = path.join(root, 'client/components/home');
  const files = [['HomeNew', home], ...fs.readdirSync(dir).filter(f => f.endsWith('.tsx') && f !== 'HeroSection.tsx').map(f => [f, read(`client/components/home/${f}`)])];
  for (const [name, src] of files) {
    for (const match of src.matchAll(/<img\b[^>]*>/g)) assert.match(match[0], /loading="lazy"/, `${name}: ${match[0].slice(0, 80)}`);
  }
});
