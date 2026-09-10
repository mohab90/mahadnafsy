'use strict';

// Lectures are the heaviest thing the admin can ask the API for: every lecture
// of every course, 508 KB and ~600 ms measured against production. It was
// fetched in the login bootstrap, so every employee paid it on every page
// load — the sales rep, the collection officer, the HR manager, none of whom
// can even open a course.
//
// It is loaded on demand now. The failure mode of doing that wrong is silent:
// a screen that reads the rows without asking for them does not error, it
// renders the seed rows from siteDataSeed.ts. A course would show a handful of
// invented lectures, and a client's progress would read «شاهد 0 من 0». So the
// test is not "the fetch was removed" — it is "every reader asks".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/.*$/, '$1'))
  .join('\n');

/** Every .ts/.tsx under admin, minus the context that defines the loading. */
function adminSources() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, 'admin'));
  return out
    .map(f => path.relative(ROOT, f).split(path.sep).join('/'))
    .filter(rel => !rel.startsWith('admin/context/'));
}

/** The names a module pulls out of useSiteData(), across line breaks. */
function siteDataKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(/\{([\s\S]*?)\}\s*=\s*useSiteData\(\)/g)) {
    for (const part of match[1].split(',')) {
      const name = part.split(':')[0].trim();
      if (name) keys.add(name);
    }
  }
  return keys;
}

/** Reading any of these means the module needs the table to be loaded. */
const LECTURE_KEYS = ['lectures', 'chapters', 'getCourseLectures', 'getCourseChapters'];

test('every admin screen that reads lectures asks for them to be loaded', () => {
  const files = adminSources();
  // Denominator, so a walk that silently stopped matching is visible rather
  // than reported as a clean bill.
  assert.ok(files.length > 150, `expected the admin source tree, saw ${files.length}`);

  const readers = [];
  for (const rel of files) {
    const source = codeOnly(read(rel));
    if (!source.includes('useSiteData(')) continue;
    const keys = siteDataKeys(source);
    if (!LECTURE_KEYS.some(key => keys.has(key))) continue;
    readers.push({ rel, asks: source.includes('useEnsureLectures()') });
  }

  // The premise: there are readers to check. If a refactor renamed the keys,
  // this list empties and the test would otherwise pass having checked nothing.
  assert.ok(readers.length >= 5, `expected the lecture readers, saw ${readers.length}`);

  const silent = readers.filter(r => !r.asks).map(r => r.rel);
  assert.deepEqual(silent, [],
    'these read lectures from the context but never load them, so they render seed rows: ' + silent.join(', '));
});

// There are two bootstraps, and the fix only counted for half the accounts
// until both were found: SiteDataContext's runs for a staff session, and
// useAdminDataRuntime's for an admin one — where the call had no argument at
// all, which is listLectures' 5000 default.
test('neither bootstrap fetches lectures any more', () => {
  for (const rel of ['admin/context/SiteDataContext.tsx', 'admin/context/site-data-hooks/useAdminDataRuntime.ts']) {
    const source = codeOnly(read(rel));
    assert.ok(!source.includes('listLectures('),
      rel + ' fetches the whole lectures table at boot again, for everyone');
    assert.ok(!source.includes('listChapters('), rel + ' fetches every chapter at boot again');
  }

  // What each bootstrap does still fetch — the small catalogue every screen
  // shows — is untouched. Without this, emptying the block would pass.
  const staff = codeOnly(read('admin/context/SiteDataContext.tsx'));
  assert.ok(staff.includes('listCourses(') && staff.includes('listTherapists('));
  const admin = codeOnly(read('admin/context/site-data-hooks/useAdminDataRuntime.ts'));
  assert.ok(admin.includes('listAllCourses(') && admin.includes('listAllTherapists('));
});

test('ensureLectures fetches once, and only counts a request the server answered', () => {
  const hook = codeOnly(read('admin/context/site-data-hooks/useLecturesChaptersState.ts'));

  // Once per session: a second screen shares the in-flight promise rather than
  // firing a second 508 KB request, and a screen reopened later does not
  // refetch, because writes update the arrays in place.
  assert.ok(hook.includes('const lecturesRequest = useRef<Promise<void> | null>(null);'));
  assert.ok(hook.includes('if (lecturesLoaded.current) return Promise.resolve();'));

  // reloadLectures swallows its own errors. Without a flag set on the answer
  // itself, a failed fetch would look identical to a successful one and pin
  // the seed rows on screen for the rest of the session.
  assert.ok(hook.includes("lecturesLoaded.current = lRes.status === 'fulfilled';"));
  assert.ok(hook.includes('if (!lecturesLoaded.current) lecturesRequest.current = null;'));

  // And it is reachable from a screen.
  const context = codeOnly(read('admin/context/SiteDataContext.tsx'));
  assert.ok(context.includes('export const useEnsureLectures = () => {'));
  assert.ok(context.includes('useEffect(() => { void ensureLectures(); }, [ensureLectures]);'));
});

test('the lectures fetch is paged, not capped at a guess', () => {
  // 2392 lectures are published. The staff bootstrap asked for 2000 of them
  // and the endpoint orders by course, so the courses at the end of that order
  // had no lectures on any screen that counted them — a client who had watched
  // one read «شاهد 0 من 0». The admin bootstrap's own call had no argument,
  // which is the 5000 default, so the two accounts disagreed about the same
  // course.
  for (const rel of [
    'admin/context/site-data-hooks/useLecturesChaptersState.ts',
    'client/context/site-data-hooks/useCourseCurriculum.ts',
  ]) {
    const source = codeOnly(read(rel));
    assert.ok(source.includes('fetchAllPages<unknown>((limit, offset) => mysqlCatalog.listLectures(limit, offset))'),
      rel + ' fetches lectures with a flat limit again, which truncates the moment a course is added');
    assert.ok(!/listLectures\(\d/.test(source), rel + ' still passes a hardcoded page size');
  }

  // And the pager stops on a short page rather than on a row count, so it does
  // not need to know how many there are.
  const pager = codeOnly(read('shared/fetchAllPages.ts'));
  assert.ok(pager.includes('if (rows.length < pageSize) break;'));
  assert.ok(pager.includes('index < maxPages'), 'without a stop a paging bug loops forever');
});
