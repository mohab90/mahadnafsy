'use strict';
/**
 * «أول كارت ظهر بعد ٥ ثواني … كل الصور خفيفة … أي صفحة متاخدش أكتر من ثانية» (18 Oct 2026).
 *
 * Two things that make the first screen heavy and are easy to put back by accident: a list that the first
 * screen waits for although nothing on it reads it, and a thumbnail drawn at full size (the course and staff
 * pictures are hosted at up to 12 MB; /api/img resizes them).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');

test('the admin does not wait for the consultations before it draws', () => {
  const runtime = read('admin/context/site-data-hooks/useAdminDataRuntime.ts');
  const firstWave = runtime.slice(runtime.indexOf('const [staffRes, contentRes]'), runtime.indexOf('clearTimeout(safetyTimer);\n        isHydratingRef.current = false;'));
  assert.ok(firstWave.includes('listAllStaff') && firstWave.includes('getContent'), 'the staff and the content are what every screen leans on');
  assert.ok(!firstWave.includes('listAllConsultations'), 'the consultations are the second wave\'s');
  assert.match(runtime, /const \[consultsRes, coursesRes, bundlesRes, therapistsRes, notificationsRes\] = await Promise\.allSettled/);
  assert.ok(runtime.includes("if (consultsRes.status === 'fulfilled') setConsultations("), 'and they still land in the context');
});

test('the resize helper is shared, and every admin list thumbnail goes through it', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'shared', 'img.ts')));
  assert.match(read('client/lib/img.ts'), /export \{ cdnImg, cdnSrcSet \} from '\.\.\/\.\.\/shared\/img'/);
  const lists = {
    'admin/pages/dashboard/tabs/courses/CourseListPanel.tsx': 'thumbnailSrc',
    'admin/pages/dashboard/tabs/hr-sections/HrStaffCard.tsx': 'member.image',
    'admin/pages/dashboard/tabs/courses/BundlesPanel.tsx': 'bundleThumbnail',
    'admin/pages/dashboard/DashboardInstituteGalleryPanel.tsx': 'imageUrl',
    'admin/pages/dashboard/DashboardCommunityAdminPanel.tsx': 'v.thumbnail',
    'admin/pages/dashboard/CommunityEventsAdmin.tsx': 'event.imageUrl',
    'admin/pages/dashboard/tabs/QuizzesTab.tsx': 'thumbnailSrc',
    'admin/pages/dashboard/tabs/CoursesTab.tsx': 'img',
  };
  for (const [file, expr] of Object.entries(lists)) {
    const source = read(file);
    assert.ok(source.includes(`<img src={cdnImg(${expr}, `), `${file} draws ${expr} resized`);
    assert.ok(/shared\/img'/.test(source), `${file} imports the helper`);
  }
  assert.ok(read('admin/pages/dashboard/tabs/hr-sections/HrStaffCard.tsx').includes('loading="lazy"'), 'fifty staff pictures must not all load at once');
});

test('the student dashboard draws course pictures resized too', () => {
  for (const file of [
    'client/components/student-dashboard/StudentCoursesTab.tsx',
    'client/components/student-dashboard/StudentMaterialsTab.tsx',
    'client/components/student-dashboard/StudentQuizTab.tsx',
    'client/pages/UserDashboard.tsx',
  ]) assert.ok(read(file).includes('<img src={cdnImg(course.thumbnail, '), file);
});

test('on a phone the client tabs get the whole row and the filters wrap, never scroll sideways', () => {
  assert.ok(read('admin/pages/dashboard/tabs/online-clients-sections/ViewTabsBar.tsx').includes('flex flex-wrap items-start gap-2 md:flex-nowrap'));
  const filters = read('admin/pages/dashboard/tabs/online-clients-sections/FiltersToolbar.tsx');
  // «خلي الفلاتر بدون سكرول عرضي»: the follow-up chips and the filters are one wrapping row.
  assert.ok(filters.includes('<div className="mb-2 flex flex-wrap items-center gap-2 [&_select]:min-w-0 [&_select]:flex-1 [&_select]:basis-[calc(50%-0.25rem)] md:[&_select]:flex-none md:[&_select]:basis-auto">'));
  assert.doesNotMatch(filters, /overflow-x-auto/);
  // The cards / table switch and the columns menu share one row.
  assert.ok(filters.includes('<div className="mb-3 flex flex-wrap items-center justify-between gap-2">'));
});

test('the logo is the resized one, from our own address, and a breadcrumb link can be pressed', () => {
  assert.ok(read('client/components/Header.tsx').includes('<img src={cdnImg(logoUrl, 320)}'));
  assert.ok(read('client/components/Footer.tsx').includes('<img src={cdnImg(logoUrl, 320)}'));
  for (const file of ['client/pages/course-details-sections/CourseHeroSection.tsx', 'client/pages/bundle-details-sections/BundleSections.tsx'])
    assert.ok(read(file).includes('className="inline-flex min-h-[36px] items-center hover:text-white">الرئيسية</Link>'), file);
});

test('the inline-picture tool writes nothing unless told to, and keeps what it replaces', () => {
  const tool = read('tools/externalize-inline-images.cjs');
  assert.ok(tool.includes("process.argv.includes('--apply')"));
  assert.ok(tool.includes('if (!found.length || !APPLY)'), 'a dry run returns before any write');
  assert.ok(tool.indexOf('inline-images-backup-') < tool.indexOf('storeMediaImage({'), 'the old values are saved before the first store');
  assert.ok(tool.includes('WHERE id = ? AND \\`${f.column}\\` = ?'), 'a row edited meanwhile is left alone');
});

test('the panel carries its own font: nothing in front of the first paint waits for Google', () => {
  const html = read('admin/index.html');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(html), 'no stylesheet or preconnect to another company before the panel paints');
  const css = read('admin/index.css');
  for (const weight of [400, 500, 700, 800]) for (const subset of ['arabic', 'latin']) {
    assert.ok(css.includes(`url('./assets/fonts/tajawal-${weight}-${subset}.woff2')`), `${weight} ${subset} is declared`);
    assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'admin', 'assets', 'fonts', `tajawal-${weight}-${subset}.woff2`)), `${weight} ${subset} is shipped`);
  }
});

test('on a phone a row action, an interview card control and a filter pill are finger-sized', () => {
  const css = read('admin/index.css');
  assert.match(css, /table\.rt-stack td button, table\.rt-stack td a\[href\] \{ min-width: 36px; min-height: 36px;/);
  assert.match(css, /\[data-touch\] button, \[data-touch\] a\[href\], \[data-touch\] select \{ min-height: 36px; \}/);
  for (const card of ['interviews-sections/InterviewCard.tsx', 'join-us/ApplicationCard.tsx', 'hr-sections/HrStaffCard.tsx'])
    assert.ok(read(`admin/pages/dashboard/tabs/${card}`).includes('data-touch'), card);
  for (const bar of ['join-us/ApplicationsBoard.tsx', 'interviews-sections/InterviewFilters.tsx'])
    assert.ok(read(`admin/pages/dashboard/tabs/${bar}`).includes('inline-flex min-h-[32px] shrink-0 items-center rounded-full'), bar);
});

test('the client database is a stack of small cards on a phone and the same table elsewhere', () => {
  const tab = read('admin/pages/dashboard/tabs/ClientDbTab.tsx');
  assert.ok(tab.includes('const isMobile = useIsMobile();'));
  assert.ok(tab.includes('{isMobile ? ('));
  assert.ok(tab.includes('<ClientDbCard key={rowKey}'));
  assert.ok(tab.includes('<table className="w-full text-sm" dir="rtl">'), 'the table is still there for a desk');
  const card = read('admin/pages/dashboard/tabs/client-db/ClientDbCard.tsx');
  for (const label of ['اتصال', 'واتس أب', 'فتح ملف العميل', 'حجز / دفعة', 'حذف (أرشفة)']) assert.ok(card.includes(`aria-label="${label}"`), label);
  assert.ok(card.includes('href={`tel:${row.phone}`}'));
});

test('the inline-picture tool can delete what it finds, after saving it', () => {
  const tool = read('tools/externalize-inline-images.cjs');
  assert.ok(tool.includes("process.argv.includes('--clear')"));
  assert.ok(tool.includes("CLEAR ? { url: '', size: 0 }"));
  assert.ok(tool.indexOf('inline-images-backup-') < tool.indexOf('const stored = CLEAR'), 'the backup is written before the first change');
});

test('the student dashboard text links can be pressed on a phone', () => {
  const dashboard = read('client/pages/UserDashboard.tsx');
  assert.equal((dashboard.match(/inline-flex min-h-\[36px\] items-center text-xs/g) || []).length, 3, '«عرض الكل» twice and «عرض سجل المدفوعات»');
});
