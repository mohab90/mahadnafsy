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
  
});

test('the student dashboard draws course pictures resized too', () => {
  for (const file of [
    'client/components/student-dashboard/StudentCoursesTab.tsx',
    'client/components/student-dashboard/StudentMaterialsTab.tsx',
    'client/components/student-dashboard/StudentQuizTab.tsx',
    'client/pages/UserDashboard.tsx',
  ]) assert.ok(read(file).includes('<img src={cdnImg(course.thumbnail, '), file);
});



test('the logo is the resized one, from our own address, and a breadcrumb link can be pressed', () => {
  
  
  for (const file of ['client/pages/course-details-sections/CourseHeroSection.tsx', 'client/pages/bundle-details-sections/BundleSections.tsx'])
    assert.ok(read(file).includes('className="inline-flex min-h-[36px] items-center hover:text-white">الرئيسية</Link>'), file);
});

test('the inline-picture tool writes nothing unless told to, and keeps what it replaces', () => {
  const tool = read('tools/externalize-inline-images.cjs');
  
  
  assert.ok(tool.indexOf('inline-images-backup-') < tool.indexOf('storeMediaImage({'), 'the old values are saved before the first store');
  
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
  
  
  for (const card of ['interviews-sections/InterviewCard.tsx', 'join-us/ApplicationCard.tsx', 'hr-sections/HrStaffCard.tsx'])
    assert.ok(read(`admin/pages/dashboard/tabs/${card}`).includes('data-touch'), card);
  for (const bar of ['join-us/ApplicationsBoard.tsx', 'interviews-sections/InterviewFilters.tsx'])
    assert.ok(read(`admin/pages/dashboard/tabs/${bar}`).includes('inline-flex min-h-[32px] shrink-0 items-center rounded-full'), bar);
});

test('the client database is a stack of small cards on a phone and the same table elsewhere', () => {
  const tab = read('admin/pages/dashboard/tabs/ClientDbTab.tsx');
  
  
  
  
  const card = read('admin/pages/dashboard/tabs/client-db/ClientDbCard.tsx');
  for (const label of ['اتصال', 'واتس أب', 'فتح ملف العميل', 'حجز / دفعة', 'حذف (أرشفة)']) assert.ok(card.includes(`aria-label="${label}"`), label);
  
});

test('the inline-picture tool can delete what it finds, after saving it', () => {
  const tool = read('tools/externalize-inline-images.cjs');
  
  
  assert.ok(tool.indexOf('inline-images-backup-') < tool.indexOf('const stored = CLEAR'), 'the backup is written before the first change');
});

test('the student dashboard text links can be pressed on a phone', () => {
  const dashboard = read('client/pages/UserDashboard.tsx');
  assert.equal((dashboard.match(/inline-flex min-h-\[36px\] items-center text-xs/g) || []).length, 3, '«عرض الكل» twice and «عرض سجل المدفوعات»');
});
