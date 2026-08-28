'use strict';

// The sheets write course names with underscores for spaces, so a name stayed
// one token and could never clear the two-word overlap bar. 472 leads carried a
// course name that never reached interested_course_ids_json.
//
// The other direction matters as much: a first attempt at this fix normalised
// the underscores but kept the one-sided overlap rule, and three names then
// landed on "دبلومة اضطراب طيف التوحد والتدخل المبكر" because they all begin
// with "دبلومة". A wrong course on a lead is worse than an empty one — nobody
// goes looking for it — so both cases are pinned here.

const test = require('node:test');
const assert = require('node:assert');
const { matchCourseId, normalizeCourseTitle } = require('../lib/courseMatch');

// The live catalogue at the time of writing.
const COURSES = [
  ' اخصائي التربية الخاصة', ' الارشاد الزواجي والاسري', 'أخصائي التخاطب',
  'احتراف اللايف كوتشينج', 'اخصائي العلاج بالمخططات المعرفية "Schema 1"',
  'اخصائي تعديل السلوك', 'اعداد معالج ادمان وسلوكيات ادمانية',
  'البرمجة اللغوية العصبية (NLP)', 'التربيه الايجابيه',
  'التشخيص و العلاج المستوى الاول', 'التلاعب والتحصين النفسي (علم النفس المظلم)',
  'التوازن و الدعم النفسي', 'الصحة النفسية', 'العلاج الجدلي السلوكي DBT',
  'العلاج السلوكي المعرفي CBT ', 'العلاج بالقبول والالتزام ACT ',
  'العلاج بالمخططات المعرفية "Schema 2"', 'تدريب المدربين', 'تنمية المهارات الاطفال',
  'دبلومة اضطراب طيف التوحد والتدخل المبكر', 'صعوبات التعلم', 'علم النفس الإكلينيكي',
  'علم النفس الإيجابي', 'فن الكلام والتأثير',
].map((title, i) => ({ id: 'course-' + i, title }));

const titleFor = (id) => COURSES.find(c => c.id === id)?.title ?? null;

test('an underscore-separated name matches its course', () => {
  // This is the shape every failing row had.
  assert.strictEqual(
    titleFor(matchCourseId('فن_الكلام_والتاثير_للمدربين_والموثرين', COURSES)),
    'فن الكلام والتأثير');
  assert.strictEqual(
    titleFor(matchCourseId('دبلومة_العلاج_بالقبول_والالتزام_', COURSES)),
    'العلاج بالقبول والالتزام ACT ');
});

test('spelling variants fold: hamza, ta marbuta, alef maqsura', () => {
  // والتاثير vs والتأثير in the catalogue.
  assert.ok(matchCourseId('فن الكلام والتاثير', COURSES));
  assert.strictEqual(normalizeCourseTitle('سنة'), normalizeCourseTitle('سنه'));
  assert.strictEqual(normalizeCourseTitle('أخصائي'), normalizeCourseTitle('اخصائي'));
  assert.strictEqual(normalizeCourseTitle('المستوى'), normalizeCourseTitle('المستوي'));
});

test('a name damaged by the import still matches on what survived', () => {
  assert.strictEqual(
    titleFor(matchCourseId('فن_الكلا��_والتاثير_للمدربين_والموثرين', COURSES)),
    'فن الكلام والتأثير');
});

test('punctuation in the catalogue title does not block a match', () => {
  assert.strictEqual(
    titleFor(matchCourseId('دبلومة_التلاعب_والتحصين_النفسي__علم_النفس_المظلم_', COURSES)),
    'التلاعب والتحصين النفسي (علم النفس المظلم)');
});

test('a course that is not in the catalogue returns null', () => {
  // These three all begin with "دبلومة" and previously captured the autism
  // diploma on that word alone.
  assert.strictEqual(matchCourseId('دبلومة_المعالج_النفسي_المحترف', COURSES), null);
  assert.strictEqual(matchCourseId('دبلومة_المعالج_النفسي_المحترف_لمدة_سنه_', COURSES), null);
});

test('every catalogue title matches itself and nothing else', () => {
  for (const course of COURSES) {
    assert.strictEqual(matchCourseId(course.title, COURSES), course.id,
      `"${course.title}" should match itself`);
  }
});

test('empty and unusable input returns null rather than guessing', () => {
  for (const value of [null, undefined, '', '   ', '__', 'ـــ']) {
    assert.strictEqual(matchCourseId(value, COURSES), null);
  }
  assert.strictEqual(matchCourseId('فن الكلام والتأثير', []), null);
  assert.strictEqual(matchCourseId('فن الكلام والتأثير', null), null);
});

// ── bundles ──────────────────────────────────────────────────────────────────
// The sheets name learning paths as often as single courses. Searching only
// courses left 208 leads with nothing recorded, for a path the catalogue had all
// along — "دبلومة المعالج النفسي المحترف" is a bundle of four courses.

const BUNDLES = [
  'دبلومة علم النفس المتكامل',
  'التشخيص الإكلينيكي والعلاج السلوكي المعرفي',
  'المعالج النفسي المحترف',
  'العلاج بالمخططات المعرفية " سكيما الدبلومة الكاملة',
  'أخصائي التخاطب والتربية الخاصة',
  'الكوتش الإيجابي المحترف ',
  'دبلومة العلاج النفسي المتكامل " سنه دراسية "',
].map((title, i) => ({ id: 'bundle-' + i, title }));

const bundleTitleFor = (value) => {
  if (!value || !String(value).startsWith('bundle:')) return null;
  const id = String(value).slice(7);
  return BUNDLES.find(b => b.id === id)?.title ?? null;
};

test('a learning path resolves to its bundle, not to nothing', () => {
  assert.strictEqual(
    bundleTitleFor(matchCourseId('دبلومة_المعالج_النفسي_المحترف', COURSES, BUNDLES)),
    'المعالج النفسي المحترف');
});

test('bundles are returned with the bundle: prefix the column already stores', () => {
  const result = matchCourseId('دبلومة علم النفس المتكامل', COURSES, BUNDLES);
  assert.ok(String(result).startsWith('bundle:'), 'expected a bundle: prefix, got ' + result);
});

test('every bundle title matches itself', () => {
  for (const bundle of BUNDLES) {
    assert.strictEqual(matchCourseId(bundle.title, COURSES, BUNDLES), 'bundle:' + bundle.id,
      `"${bundle.title}" should match itself`);
  }
});

test('adding bundles does not disturb the course matches', () => {
  // Every course still resolves to itself with bundles in play.
  for (const course of COURSES) {
    assert.strictEqual(matchCourseId(course.title, COURSES, BUNDLES), course.id,
      `"${course.title}" should still match itself`);
  }
});

test('a name matching neither stays null even with bundles searched', () => {
  assert.strictEqual(matchCourseId('كورس الطبخ المتقدم', COURSES, BUNDLES), null);
});

test('omitting bundles keeps the previous behaviour', () => {
  // The argument is optional; callers that pass only courses are unaffected.
  assert.strictEqual(matchCourseId('دبلومة_المعالج_النفسي_المحترف', COURSES), null);
});
