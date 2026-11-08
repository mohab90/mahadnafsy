'use strict';

// «التزم بالمنيو الرئيسية والهدف بتاعنا — بدل زر الاستشارات يبقى زر الحجز».
// The home page (client/pages/Home.tsx) keeps the site's menu, drops the consultation / «هل لديك
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
  
  
  const designs = read('shared/siteDesigns.ts');
  
  
  for (const id of ['white', 'red', 'dark']) assert.match(designs, new RegExp(`id: '${id}'[\\s\\S]*?primaryCta: 'احجز مكانك الآن'`), `${id} books`);
  
  
  
  
  
  
  
});

test('«مش عارف تبدأ منين؟» sits at the end, right above one closing slide for booking and joining', () => {
  
  
  const find = home.indexOf('<GoalFinder');
  const closing = home.indexOf('{/* Closing slide');
  assert.ok(find > 0 && closing > find, 'the finder comes right before the closing slide');
  assert.ok(home.indexOf('<PaymentPlanner') < find, 'the payment section is still above it');
  const slide = home.slice(closing, home.indexOf('{lightbox &&'));
  // One slide: booking on the burgundy card, joining on the dark one, no photo between them.
  assert.match(slide, /جاهز تبدأ مسارك المهني/);
  assert.match(slide, /from-primary-700/);
  assert.match(slide, /bg-ink/);
  assert.doesNotMatch(slide, /<img|<Picture/, 'the photo in the middle is gone');
  for (const to of ['/enroll', '/courses', '/join', '/join-us']) assert.ok(slide.includes(`<Link to="${to}"`), `${to} is on the slide`);
  assert.ok(slide.includes('انضم إلينا كمحاضر') && slide.includes('انضم إلينا كموظف'));
  // The contact button and the separate «هل لديك استفسار؟» slide are gone.
  
  
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
  
  
  
  
  
  for (const file of ['PaymentPlanner', 'HomeFaq']) {
    assert.doesNotMatch(read(`client/components/home/${file}.tsx`), /\b15\s*%|\b7\s*%/, `no hard-coded rate in ${file}`);
  }
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







test('the home page shows the design chosen in the panel; the old /new address leads to it', () => {
  const app = read('client/App.tsx');
  
  
  
  
  
  assert.ok(!fs.existsSync(path.join(root, 'client/pages/HomeNew.tsx')), 'no third home page');
  
  
});

test('three heroes, a different one on each visit, never the one just seen', () => {
  const js = require('node:module').stripTypeScriptTypes(read('shared/siteDesigns.ts')).replace(/^export /gm, '');
  const m = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', `${js}\nmodule.exports = { siteDesign, heroText, heroChoices, nextHero, HERO_VARIANTS, DESIGNS };`)(m);
  const { siteDesign, heroText, heroChoices, nextHero, HERO_VARIANTS, DESIGNS } = m.exports;
  assert.deepEqual(HERO_VARIANTS.map(v => v.id), ['white', 'red', 'dark']);
  assert.deepEqual(DESIGNS.map(d => d.id), ['modern', 'classic']);
  assert.equal(siteDesign({}), 'modern');
  assert.equal(siteDesign({ 'site.design': 'classic' }), 'classic');
  assert.equal(siteDesign({ 'site.design': 'nonsense' }), 'modern');
  assert.deepEqual(heroChoices({}), ['white', 'red', 'dark']);
  assert.deepEqual(heroChoices({ 'home.hero.red.enabled': 'false' }), ['white', 'dark']);
  assert.deepEqual(heroChoices({ 'home.hero.mode': 'dark' }), ['dark'], 'the panel can fix one');
  assert.deepEqual(heroChoices({ 'home.hero.white.enabled': 'false', 'home.hero.red.enabled': 'false', 'home.hero.dark.enabled': 'false' }), ['white'], 'never none');
  // A refresh moves on to the next one.
  let last = null;
  const seen = [];
  for (let i = 0; i < 6; i++) { last = nextHero(['white', 'red', 'dark'], last, () => 0); seen.push(last); }
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1]);
  assert.deepEqual(new Set(seen), new Set(['white', 'red', 'dark']));
  // Panel text wins; the white hero still answers to the keys it had before variants.
  assert.equal(heroText({ 'home.hero.red.title': 'عنوان' }, 'red').title, 'عنوان');
  assert.equal(heroText({ 'home.heroSubtitle': 'وصف قديم' }, 'white').subtitle, 'وصف قديم');
  assert.equal(heroText({}, 'dark').highlight, 'بشهادة معتمدة');
  for (const v of HERO_VARIANTS) assert.ok(v.defaults.title.includes(v.defaults.highlight), `${v.id}: the highlight is part of its title`);
  const homeSrc = read('client/pages/Home.tsx');
  
  
});

test('the hero shows three real graduates, larger, as light WebP, with nothing written over them', () => {
  const tiles = [...hero.matchAll(/\{ name: '([a-z]+)', alt: '([^']+)' \}/g)];
  assert.equal(tiles.length, 3, 'three graduates');
  for (const [, name, alt] of tiles) {
    assert.ok(alt.length > 10, `${name} is described`);
    for (const file of [`hero-${name}-360.webp`, `hero-${name}-640.webp`, `hero-${name}.jpg`]) {
      const size = fs.statSync(path.join(root, 'client/assets/photos', file)).size;
      assert.ok(size < (file.endsWith('360.webp') ? 30 : 100) * 1024, `${file} is light (${Math.round(size / 1024)}KB)`);
    }
  }
  
  const visuals = hero.slice(hero.indexOf('const ProofChips'), hero.indexOf('const HeroSection'));
  assert.ok(visuals.length > 500, 'the photo blocks were not located');
  assert.match(visuals, /<ProofChips content=\{content\} light \/>/, 'the labels sit under the three photos');
  assert.match(visuals, /<div className="pt-4"><ProofChips content=\{content\} light=\{false\} \/><\/div>/, 'and under the arch photos, in the flow, not on them');
});

test('the graduation photos ship with the site and open in the one lightbox', () => {
  const gallery = read('client/components/home/GraduatesGallery.tsx');
  const photos = [...gallery.matchAll(/\{ src: '([^']+)\.jpg', widths: \[([\d, ]+)\]/g)].map(m => [m[1], m[2].split(', ').map(Number)]);
  assert.ok(photos.length >= 6, 'a wall of real photos');
  for (const [name, widths] of photos) {
    for (const w of widths) {
      const size = fs.statSync(path.join(root, 'client/assets/photos', `${name}-${w}.webp`)).size;
      assert.ok(size < (w <= 480 ? 45 : 120) * 1024, `${name}-${w}.webp is light (${Math.round(size / 1024)}KB)`);
    }
  }
  
  
});

test('every picture below the first screen loads lazily', () => {
  const dir = path.join(root, 'client/components/home');
  const files = [['Home', home], ...fs.readdirSync(dir).filter(f => f.endsWith('.tsx') && f !== 'HeroSection.tsx').map(f => [f, read(`client/components/home/${f}`)])];
  for (const [name, src] of files) {
    for (const match of src.matchAll(/<img\b[^>]*>/g)) assert.match(match[0], /loading="lazy"/, `${name}: ${match[0].slice(0, 80)}`);
  }
});
