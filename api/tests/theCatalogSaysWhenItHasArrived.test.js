'use strict';

// The public site's catalog, its lecture players and the enrolment form, as the
// 20 Oct review found them:
//
// - «المسار غير موجود» on a bundle page a visitor reached from an ad: the catalog
//   was marked ready before its request left, and stayed "ready" with nothing in
//   it when the request failed.
// - «كورساتي», the player and the progress bar empty after the lectures arrived:
//   the context value was not rebuilt when they did.
// - A lecture the server refused spun on «جاري تحميل الفيديو» for good on the
//   course page.
// - The enrolment form put the original course back each time the catalog
//   refreshed (it does on tab refocus).
//
// The catalog hook is run here for real, under a small stand-in for React's
// hooks and a stand-in for the API, so what is checked is what it does.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function loadEsbuild() {
  try { return require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
}

// Bundles a client module with `react` and the API client left out, and hands
// it the stand-ins the test controls when it asks for them.
function bundleWithStubs(entry) {
  const esbuild = loadEsbuild();
  if (!esbuild) return null;
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node',
    logLevel: 'silent', define: { 'import.meta.env': '{}' },
    external: ['react', '../../lib/mysqlapi'],
    nodePaths: [path.join(ROOT, 'client', 'node_modules')],
  });
  const stubRequire = id => {
    if (id === 'react') return globalThis.__fakeReact;
    if (id.endsWith('/lib/mysqlapi')) return globalThis.__fakeApi;
    return require(id);
  };
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, stubRequire);
  return module.exports;
}

// Just enough of React's hook contract to run one hook: state that survives
// renders, refs, memoized callbacks and effects that re-run when their deps change.
// Installed before the module is loaded, which takes hold of `react` at once.
function hookHarness() {
  let hook = null;
  const slots = [];
  let index = 0;
  let pending = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  globalThis.__fakeReact = {
    useState(init) {
      const i = index++;
      if (!(i in slots)) slots[i] = { value: typeof init === 'function' ? init() : init };
      const slot = slots[i];
      return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useRef(init) {
      const i = index++;
      if (!(i in slots)) slots[i] = { current: init };
      return slots[i];
    },
    useCallback(fn, deps) {
      const i = index++;
      if (slots[i] && same(slots[i].deps, deps)) return slots[i].fn;
      slots[i] = { fn, deps };
      return fn;
    },
    useEffect(fn, deps) {
      const i = index++;
      const previous = slots[i];
      if (previous && deps && same(previous.deps, deps)) return;
      slots[i] = { deps };
      pending.push(() => {
        if (previous && typeof previous.cleanup === 'function') previous.cleanup();
        slots[i].cleanup = fn();
      });
    },
  };
  return {
    use(fn) { hook = fn; },
    render(args) {
      index = 0;
      const out = hook(args);
      const effects = pending; pending = [];
      effects.forEach(run => run());
      return out;
    },
  };
}

// A request the test answers when it chooses.
function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

function catalogApi() {
  const calls = { courses: [], bundles: [] };
  const api = {
    calls,
    mysqlCatalog: {
      getSiteContent: () => Promise.resolve({}),
      listCourses: () => { const d = deferred(); calls.courses.push(d); return d.promise; },
      listBundles: () => { const d = deferred(); calls.bundles.push(d); return d.promise; },
      listTherapists: () => Promise.resolve([]),
      listTestimonials: () => Promise.resolve([]),
      listLectures: () => Promise.resolve([]),
      listChapters: () => Promise.resolve([]),
    },
  };
  globalThis.__fakeApi = api;
  return api;
}

function runCatalog() {
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const api = catalogApi();
  const harness = hookHarness();
  const lib = bundleWithStubs('client/context/site-data-hooks/useCatalogData.ts');
  if (!lib) return null;
  harness.use(lib.useCatalogData);
  const noop = () => {};
  const args = {
    initialCourses: [], initialBundles: [], initialTherapists: [], initialTestimonials: [],
    isAdmin: false, authUserUid: undefined, mergeContent: noop,
    setLectures: noop, setChapters: noop,
    setCommunityPosts: noop, setCommunityLibraryItems: noop, setCommunityVideos: noop, setCommunityEvents: noop,
  };
  return { api, render: () => harness.render(args) };
}

test('the catalog is not "ready" until the courses and bundles have actually arrived', async () => {
  const run = runCatalog();
  if (!run) return;
  let state = run.render();
  assert.equal(state.remoteReady, false);
  await settle();
  state = run.render();
  assert.equal(state.remoteReady, false, 'still waiting: a bundle page must show its loader, not «غير موجود»');

  run.api.calls.courses[0].resolve([{ id: 'c1', title: 'دبلومة' }]);
  run.api.calls.bundles[0].resolve([{ id: 'b1', title: 'مسار', courses: [] }]);
  await settle();
  state = run.render();
  assert.equal(state.remoteReady, true);
  assert.equal(state.catalogFailed, false);
  assert.deepEqual(state.bundles.map(b => b.id), ['b1'], 'ready arrives together with the data');
});

test('a catalog that failed to load says so and can be asked again', async () => {
  const run = runCatalog();
  if (!run) return;
  run.render();
  run.api.calls.courses[0].resolve([{ id: 'c1' }]);
  run.api.calls.bundles[0].reject(new Error('network'));
  await settle();
  let state = run.render();
  assert.equal(state.remoteReady, true);
  assert.equal(state.catalogFailed, true, 'a failure is reported as a failure, not as an empty list');

  state.retryCatalog();
  state = run.render();
  assert.equal(state.remoteReady, false, 'retrying shows the loader again');
  assert.equal(state.catalogFailed, false);
  assert.equal(run.api.calls.bundles.length, 2, 'retry asks the server again');
  run.api.calls.courses[1].resolve([{ id: 'c1' }]);
  run.api.calls.bundles[1].resolve([{ id: 'b1', courses: [] }]);
  await settle();
  state = run.render();
  assert.equal(state.remoteReady, true);
  assert.equal(state.catalogFailed, false);
  assert.deepEqual(state.bundles.map(b => b.id), ['b1']);
});

test('the bundle page tells a failed catalog apart from a missing bundle', () => {
  const page = read('client/pages/BundleDetails.tsx');
  const notFound = page.indexOf("'المسار غير موجود'");
  const failed = page.indexOf('if (catalogFailed) {');
  assert.ok(failed > 0 && failed < notFound, 'the failure branch comes before «غير موجود»');
  assert.match(page, /onClick=\{retryCatalog\}/);
});

test('the context value is rebuilt when the lectures and chapters arrive', () => {
  const context = read('client/context/SiteDataContext.tsx');
  const deps = context.slice(context.indexOf('const value = useMemo<SiteDataShape>'), context.indexOf('return <SiteDataContext.Provider'));
  const list = deps.slice(deps.lastIndexOf('}), ['));
  assert.match(list, /getCourseChapters/, 'the chapters getter (memoized on chapters) is a dependency');
  assert.match(list, /getCourseLectures/, 'the lectures getter (memoized on lectures) is a dependency');
  const curriculum = read('client/context/site-data-hooks/useCourseCurriculum.ts');
  assert.match(curriculum, /\[chapters, lectures\]\);/, 'and the getters change when the data does');
});

test('a refused lecture says why instead of loading forever', () => {
  const lib = (() => { try { return bundleWithStubs('client/lib/lectureVideo.ts'); } catch { return null; } })();
  if (lib) {
    assert.match(lib.lectureAccessRefusal({ reason: 'drip_locked', unlocks_at: '2026-11-02T08:00:00Z' }), /^المحاضرة هتفتح في موعدها يوم /);
    assert.equal(lib.lectureAccessRefusal({ reason: 'drip_locked' }), 'المحاضرة هتفتح في موعدها');
    assert.equal(lib.lectureAccessRefusal({ reason: 'not_enrolled' }), 'المحاضرة غير متاحة ضمن صلاحية اشتراكك الحالية');
    assert.equal(lib.lectureAccessRefusal({}), 'المحاضرة غير متاحة ضمن صلاحية اشتراكك الحالية');
  }
  // Both players use it, and the course page shows it before its spinner.
  const page = read('client/pages/CourseDetails.tsx');
  assert.match(page, /else setResolvedLecture\(\{ lectureId, url: '', error: lectureAccessRefusal\(r\) \}\)/);
  assert.match(page, /\.catch\(\(\) => \{ if \(!cancelled\) setResolvedLecture\(\{ lectureId, url: '', error: LECTURE_ACCESS_CHECK_FAILED \}\)/);
  const section = read('client/pages/course-details-sections/LecturePlayerSection.tsx');
  assert.ok(section.indexOf('lectureAccessError ? (') < section.indexOf('!resolvedLectureUrl ? ('), 'the refusal is drawn instead of the spinner');
  assert.match(read('client/components/UserDashboardVideoPlayer.tsx'), /lectureAccessRefusal\(r\)/);
});

test('the enrolment form seeds its selection from the link once, not on every catalog refresh', () => {
  const page = read('client/pages/Enrollment.tsx');
  assert.match(page, /useState<string\[\]>\(\(\) => \{\s*const courseId = searchParams\.get\('course'\);/);
  assert.ok(!/\}, \[allOptions\]\);/.test(page), 'no effect keyed on the catalog writes the selection');
});
