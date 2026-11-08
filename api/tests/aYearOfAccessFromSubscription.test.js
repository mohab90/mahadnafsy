'use strict';

// 31 Oct 2026: «اي عميل اعمله سنه صلاحيه الكورسات من تاريخ اشتراكه … دا امر ضروري جدا». A course is open for a year from the day the client
// subscribed unless the course names its own duration (courses.access_months); it used to be open-ended until someone set one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-year-secret-0123456789-abcdefghijklmnopqr';
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('the grant counts the duration the course names, else a year, from the subscription day', () => {
  const source = read('lib/entitlements.js');
  assert.match(source, /const DEFAULT_ACCESS_MONTHS = 12;/);
  assert.match(source, /Number\(durationResult\?\.\[0\]\?\.\[0\]\?\.access_months\) > 0\s+\? Number\(durationResult\[0\]\[0\]\.access_months\) : DEFAULT_ACCESS_MONTHS;/);
  assert.match(source, /CASE WHEN \? > 0 THEN DATE_ADD\(COALESCE\(\?,NOW\(\)\), INTERVAL \? MONTH\) ELSE NULL END/, 'a new enrollment: the subscription day plus the months');
});

test('a re-grant never shortens or restarts a live window, and leaves an open-ended one to the conversion tool', () => {
  const source = read('lib/entitlements.js');
  assert.match(source, /expiry_date=CASE WHEN \? > 0 AND expiry_date IS NOT NULL THEN GREATEST\(\s+expiry_date,\s+DATE_ADD\(IF\(status='active' AND expiry_date > NOW\(\),enrolled_at,NOW\(\)\), INTERVAL \? MONTH\)\) ELSE expiry_date END,/);
  assert.match(source, /tools\/set-year-access\.cjs/);
  assert.match(read('../admin/pages/dashboard/tabs/CoursesTab.tsx'), /سيبها فاضية = سنة/);
  assert.match(read('routes/core/content.js'), /courseDefaultMonths: Number\(r\.access_months\) > 0 \? r\.access_months : DEFAULT_ACCESS_MONTHS/);
});

