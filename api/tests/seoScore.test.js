'use strict';
/**
 * The SEO score on the course and track editors (admin/lib/seoScore.ts):
 * «تقييم seo كام من 10 للصفحه وايه المقترحات لتقويتها». Node strips the types
 * and runs the admin file itself, so the numbers here are the ones staff see.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { scoreSeo, normalizeForSearch, focusKeyword } = require(path.join(__dirname, '../../admin/lib/seoScore.ts'));

const words = n => Array.from({ length: n }, (_, i) => `كلمة${i}`).join(' ');
const complete = {
  kind: 'course',
  title: 'دبلومة العلاج المعرفي السلوكي',
  titleEn: 'CBT Diploma',
  seoTitle: 'دبلومة العلاج المعرفي السلوكي أونلاين وحضوري — شهادة معتمدة',
  seoDescription: 'دبلومة العلاج المعرفي السلوكي من معهد الدراسات النفسية: تدريب عملي على الحالات، إشراف، وشهادة معتمدة. احجز مكانك في الدفعة الجديدة.',
  seoKeywords: 'دبلومة العلاج المعرفي السلوكي, CBT',
  slug: 'cbt-diploma',
  shortDescription: 'تدريب عملي',
  description: `<p>دبلومة العلاج المعرفي السلوكي ${words(320)}</p>`,
  thumbnail: '/uploads/cbt.jpg',
  videoUrl: 'https://youtu.be/x',
  outlineCount: 6,
  hasPrice: true,
  instructor: 'د. أحمد',
  published: true,
};

test('the weights add up to 100, so a full page scores 10', () => {
  const report = scoreSeo(complete);
  assert.equal(report.checks.reduce((sum, c) => sum + c.weight, 0), 100);
  assert.equal(report.score, 10);
  assert.equal(report.grade, 'ممتاز');
  assert.ok(report.checks.every(c => c.state === 'good' && !c.tip));
});

test('an empty page scores 0 and every check says what to do', () => {
  const report = scoreSeo({ kind: 'course', title: '' });
  assert.equal(report.score, 0);
  assert.ok(report.checks.every(c => c.state === 'bad' && c.tip));
});

test('a track is scored on its courses and short description instead of an instructor', () => {
  const report = scoreSeo({ ...complete, kind: 'bundle', instructor: undefined, outlineCount: 1, shortDescription: 'مسار متكامل لتأهيلك كأخصائي نفسي من الصفر للاحتراف' });
  const ids = report.checks.map(c => c.id);
  assert.ok(ids.includes('short') && !ids.includes('instructor'));
  assert.equal(report.checks.find(c => c.id === 'outline').state, 'partial');
  assert.equal(report.snippet.path, '/bundle/cbt-diploma');
});

test('without its own SEO title, the plain title counts for half at most', () => {
  const report = scoreSeo({ ...complete, seoTitle: '', title: 'دبلومة العلاج المعرفي السلوكي أونلاين وحضوري' });
  const title = report.checks.find(c => c.id === 'title');
  assert.equal(title.state, 'partial');
  assert.match(title.tip, /عنوان SEO/);
  assert.equal(report.snippet.title, 'دبلومة العلاج المعرفي السلوكي أونلاين وحضوري');
});

test('the keyword matches however the alef and taa marbuta are spelled', () => {
  assert.equal(normalizeForSearch('دبلومة إرشاد أسري'), normalizeForSearch('دبلومه ارشاد اسري'));
  const report = scoreSeo({ ...complete, seoKeywords: 'دبلومه العلاج المعرفى' });
  assert.equal(report.checks.find(c => c.id === 'keyword_title').state, 'good');
  assert.equal(focusKeyword('، أول, تاني'), 'أول');
});

test('an Arabic slug is flagged: it turns into %D8 codes when shared', () => {
  const report = scoreSeo({ ...complete, slug: 'دبلومة-cbt' });
  const slug = report.checks.find(c => c.id === 'slug');
  assert.equal(slug.state, 'partial');
  assert.match(slug.tip, /إنجليزي/);
});

test('both editors show the score, and the track form keeps its cover, publish state and SEO fields', () => {
  const root = path.join(__dirname, '../..');
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  assert.match(read('admin/pages/dashboard/tabs/CoursesTab.tsx'), /<SeoScorePanel input=\{seoInput\} \/>/);
  const bundles = read('admin/pages/dashboard/tabs/courses/BundlesPanel.tsx');
  assert.match(bundles, /<SeoScorePanel input=\{seoInput\} \/>/);
  assert.match(bundles, /thumbnail: bundleThumbnail/);
  assert.match(bundles, /isPublished: bundlePublished/);
  const payload = read('admin/context/site-data-hooks/useCatalogState.ts');
  assert.match(payload, /is_published: bundle\.isPublished === false \? 0 : 1/);
  assert.match(payload, /seo_title: bundle\.seo_title/);
  const route = read('api/routes/core/catalog.js');
  assert.match(route, /seo_title=VALUES\(seo_title\)/);
  assert.match(route, /SLUG_TAKEN/);
  assert.match(read('client/pages/BundleDetails.tsx'), /bundle\?\.seo_title/);
});
