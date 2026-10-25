'use strict';

// 25 Oct 2026 — «حساب محاضر»: the screens. The portal is a route of its own, reached from the lecturer's roles,
// with a tab for each thing the owner asked for, and every call it makes is to the lecturer's own endpoints.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('the portal is a route of its own and the lecturer roles are sent to it', () => {
  assert.match(read('admin/App.tsx'), /<Route path="\/lecturer-portal" element=\{\s*<StaffRoute><LecturerPortal \/><\/StaffRoute>/);
  const nav = read('admin/pages/dashboard/DashboardNavigation.tsx');
  assert.match(nav, /\['instructor', 'trainer', 'consultant', 'expert'\]\.includes\(currentStaff\.role\)/);
  assert.match(nav, /navigate\('\/lecturer-portal'\)/);
});

test('it has a tab for lives, weekly hours, consultations, ratings, students, earnings, the community, notifications and the profile', () => {
  const shell = read('admin/pages/LecturerPortal.tsx');
  for (const id of ['overview', 'lives', 'hours', 'consultations', 'feedback', 'students', 'earnings', 'community', 'notifications', 'profile']) {
    assert.match(shell, new RegExp(`id: '${id}'`), id);
  }
  // Hours and consultations exist only for a lecturer who has a consultation profile.
  assert.match(shell, /item\.id === 'hours' \|\| item\.id === 'consultations' \? Boolean\(overview\.profile\.consultation\)/);
  for (const section of ['LecturerLives', 'LecturerHours', 'LecturerConsultations', 'LecturerFeedback', 'LecturerStudents', 'LecturerEarnings', 'LecturerCommunity', 'LecturerProfile', 'LecturerOverview']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'admin/pages/lecturer', `${section}.tsx`)), section);
  }
});

test('every call the portal makes is to the lecturer\'s own endpoints, and each one exists on the server', () => {
  const api = read('admin/pages/lecturer/lecturerApi.ts');
  const server = read('api/routes/lecturer-portal.js');
  const called = [...api.matchAll(/['`]\/staff\/lecturer\/([a-z-]+(?:\/[a-z-]+)*)/g)].map(match => match[1]);
  const shortcuts = [...api.matchAll(/get<[^>]*>\('([a-z-]+)/g)].map(match => match[1]);
  for (const route of new Set([...called, ...shortcuts])) {
    assert.ok(server.includes(`/api/staff/lecturer/${route}`), `${route} is served`);
  }
  // The only calls outside /lecturer are the lecturer's own live status and the community's public feed.
  const others = [...api.matchAll(/(?:adminGet|adminPatch|adminPost)(?:<[^(]*>)?\(\s*[`']\/(?!staff\/lecturer)([a-z/-]+)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(others)].sort(), ['community/events', 'community/library', 'community/posts', 'community/videos', 'staff/me/live-streams/']);
});

test('the weekly hours screen says they repeat, and lets a day be closed', () => {
  const hours = read('admin/pages/lecturer/LecturerHours.tsx');
  assert.match(hours, /بيتكرر كل أسبوع/);
  assert.match(hours, /اقفل اليوم/);
  assert.match(hours, /lecturerApi\.saveSlots\(slots\)/);
  assert.match(hours, /الاستشارات مش مفعّلة على حسابك/);
});

test('a lecturer can start a free community live, schedule a live by date and time, and sees how it was paid', () => {
  const lives = read('admin/pages/lecturer/LecturerLives.tsx');
  assert.match(lives, /ابدأ لايف مجاني في المجتمع/);
  assert.match(lives, /type="datetime-local"/);
  assert.match(lives, /cairoInputToUtc\(draft\.scheduledAt\)/);
  assert.match(read('admin/pages/lecturer/LecturerEarnings.tsx'), /مكافآت تدوير العملاء/);
  assert.match(read('admin/pages/lecturer/LecturerConsultations.tsx'), /<ConsultationTimingBadge item=\{/);
});
