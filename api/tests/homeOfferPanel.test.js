'use strict';

// «جزء اوفر 24 ساعه مش عارف اغيره منين اغير الكورس او الاوفر نفسه». The course
// picker and the timer were on a tab no menu reached; «المحتوى ← صفحات الموقع ←
// الصفحة الرئيسية» opened the text fields alone.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

test('the page the menu opens is the one with the course and the timer', () => {
  const hub = read('admin/pages/dashboard/DashboardContentHubRoutes.tsx');
  const route = hub.slice(hub.indexOf("contentHubSubTab === 'home_offer') && ("), hub.indexOf("contentHubSubTab === 'about_page'"));
  assert.match(route, /<DashboardHomeOfferPanel fields=\{homeOfferFields\} notify=\{notify\} \/>/);
  const panel = read('admin/pages/dashboard/DashboardHomeOfferPanel.tsx');
  assert.match(panel, /'offer\.courseId': selected\.id/);
  assert.match(panel, /setContentValue\('offer\.timerStartedAt', value\)/);
  assert.match(panel, /'home\.offer\.discountPercent': String\(percent\)/, 'the discount the home page draws the struck price from');
});

test('the selected course is the panel\'s own state, not the dashboard\'s', () => {
  for (const file of ['admin/pages/Dashboard.tsx', 'admin/pages/dashboard/hooks/useContentEditorDrafts.ts', 'admin/pages/dashboard/DashboardDirectContentRoutes.tsx']) {
    assert.ok(!read(file).includes('offerSelectedCourseId'), file);
  }
});
