'use strict';

// «جزء اوفر 24 ساعه مش عارف اغيره منين اغير الكورس او الاوفر نفسه». The course
// picker and the timer were on a tab no menu reached; «المحتوى ← صفحات الموقع ←
// الصفحة الرئيسية» opened the text fields alone.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');



test('the selected course is the panel\'s own state, not the dashboard\'s', () => {
  for (const file of ['admin/pages/Dashboard.tsx', 'admin/pages/dashboard/hooks/useContentEditorDrafts.ts', 'admin/pages/dashboard/DashboardDirectContentRoutes.tsx']) {
    assert.ok(!read(file).includes('offerSelectedCourseId'), file);
  }
});
