'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const admin = (...p) => path.join(__dirname, '..', '..', 'admin', ...p);
const read = (...p) => fs.readFileSync(admin(...p), 'utf8');

const fields = read('pages', 'dashboard', 'contentFields.ts');

// Pull the key lists straight out of the TS source. A real import would need a
// TS toolchain in the API test runner; the shapes here are plain literals.
function keysOf(exportName) {
  const start = fields.indexOf(`export const ${exportName}`);
  assert.notEqual(start, -1, `${exportName} not found in contentFields.ts`);
  const block = fields.slice(start, fields.indexOf('\n];', start));
  return [...block.matchAll(/key: '([^']+)'/g)].map(m => m[1]);
}

const FIELD_LISTS = [
  'aboutPageFields', 'homeOfferFields', 'pageCoursesFields', 'pageBundlesFields',
  'pageConsultationsFields', 'pageInstructorsFields', 'pageContactFields',
  'pageJoinUsFields', 'pageCommunityFields', 'policySections',
  'pageCourseDetailsFields', 'pageBundleDetailsFields', 'pageMiscFields',
];

test('no content key is offered by two different editors', () => {
  // "الفوتر له 3 أماكن بيتعدل منهم" — the same value editable from more than one
  // screen means an edit made in one place looks lost in the other.
  const seen = new Map();
  const dupes = [];
  for (const list of FIELD_LISTS) {
    for (const key of keysOf(list)) {
      if (seen.has(key)) dupes.push(`${key}: ${seen.get(key)} + ${list}`);
      else seen.set(key, list);
    }
  }
  assert.deepEqual(dupes, [], `keys with more than one editor:\n${dupes.join('\n')}`);
});

test('the raw key table defers to the owning editor instead of duplicating it', () => {
  const advanced = read('pages', 'dashboard', 'DashboardContentHubAdvancedPanel.tsx');
  assert.match(advanced, /const owner = contentEditorFor\(key\)/);
  // Read-only display plus a jump link, not a second textarea.
  assert.match(advanced, /if \(owner\) \{[\s\S]{0,900}openEditor\(owner\)/);
  assert.match(fields, /export function contentEditorFor/);
  // Every key the dedicated editors own must resolve to a home.
  const registry = fields.slice(fields.indexOf('const OWNED_KEYS'));
  for (const list of FIELD_LISTS) {
    assert.ok(
      registry.includes(`${list}.map(f => f.key)`) || registry.includes(`${list}.flatMap`)
        || registry.includes(`${list}.map(f => f.key).concat`),
      `${list} is not registered to an editor, so its keys stay editable in two places`
    );
  }
});

test('content forms save in one request, not one request per field', () => {
  // Each setContentValue() posts the whole content document. Looping it over a
  // form's fields meant N full writes for one click, and a failure part-way
  // through left the page half-saved while still reporting success.
  const editors = [
    ['pages/dashboard/ContentHubEditors.tsx', read('pages', 'dashboard', 'ContentHubEditors.tsx')],
    ['pages/dashboard/DashboardHomeOfferPanel.tsx', read('pages', 'dashboard', 'DashboardHomeOfferPanel.tsx')],
    ['pages/dashboard/DashboardFooterSettingsPanel.tsx', read('pages', 'dashboard', 'DashboardFooterSettingsPanel.tsx')],
    ['pages/dashboard/DashboardContentHubAdvancedPanel.tsx', read('pages', 'dashboard', 'DashboardContentHubAdvancedPanel.tsx')],
  ];
  for (const [name, src] of editors) {
    assert.doesNotMatch(src, /Promise\.all\([\s\S]{0,200}setContentValue\(/,
      `${name} still saves one field per request`);
    assert.match(src, /setContentValues\(/, `${name} does not use the batched save`);
  }
  const hook = read('context', 'site-data-hooks', 'useContentState.ts');
  assert.match(hook, /const setContentValues = \(entries: Record<string, string>\)/);
  assert.match(hook, /queueContentMutation\(keys, 'update'/);
});

test('the course and bundle detail pages are fully editable', () => {
  // 118 strings between these two pages used to be code defaults with no editor
  // anywhere in the panel — the two pages that actually sell the courses.
  const client = path.join(__dirname, '..', '..', 'client');
  const editable = new Set(FIELD_LISTS.flatMap(keysOf));
  const missing = [];
  for (const [page, prefix] of [['CourseDetails', 'courseDetails.'], ['BundleDetails', 'bundleDetails.']]) {
    const files = fs.readdirSync(path.join(client, 'pages'))
      .filter(f => f.startsWith(page) && /\.tsx?$/.test(f));
    assert.ok(files.length, `no ${page} page found`);
    for (const f of files) {
      const src = fs.readFileSync(path.join(client, 'pages', f), 'utf8');
      for (const m of src.matchAll(/content\[['"]([^'"]+)['"]\]/g)) {
        if (m[1].startsWith(prefix) && !editable.has(m[1])) missing.push(m[1]);
      }
    }
  }
  assert.deepEqual([...new Set(missing)], [], `read by the page with no editor: ${missing.join(', ')}`);
});

test('every home.offer key the site reads has an editor', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'pages', 'Home.tsx'), 'utf8');
  const readKeys = new Set([...home.matchAll(/content\['((?:home\.offer|offer)\.[^']+)'\]/g)].map(m => m[1]));
  const editable = new Set(keysOf('homeOfferFields'));
  // offer.courseId / offer.timerStartedAt are written by the course picker and
  // the timer-reset button in the same panel rather than as text fields.
  for (const handled of ['offer.courseId', 'offer.timerStartedAt']) editable.add(handled);
  const orphans = [...readKeys].filter(k => !editable.has(k));
  assert.deepEqual(orphans, [], `read by the site with nowhere to edit them: ${orphans.join(', ')}`);
});
