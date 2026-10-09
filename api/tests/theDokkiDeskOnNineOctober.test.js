'use strict';

// The Dokki requests of 9 Oct 2026.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

// «اعمل زر ادوس عليه يظهر الكورسات المنتهي … عشان الكورس المنتهيه استخدامها قليل جدا».
test('finished rounds are hidden until asked for', () => {
  const tab = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  assert.match(tab, /const \[showFinished, setShowFinished\] = useState\(false\);/);
  assert.match(tab, /\(showFinished \|\| daqqiFilterStatus === 'finished' \|\| r\.status !== 'finished'\) &&/);
});
