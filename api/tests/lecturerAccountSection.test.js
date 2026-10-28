'use strict';

// 26 Oct 2026 — «ازاي هعمل حساب للمحاضر يدخل بيه»: the lecturer's login (e-mail, phone, password) and what they are paid are made on
// the lecturer's own form, and the profile can be linked to any of the four jobs that get the portal.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');

test('the lecturers screen makes the login and sets the pay in one place', () => {
  const section = read('admin/pages/dashboard/tabs/courses/LecturerAccountSection.tsx');
  assert.match(section, /createStaffAccount\(\{ name: draft\.name\.trim\(\), email: email\.trim\(\), phone: phone\.trim\(\), password, role: realRole\(role\) \}\)/);
  assert.match(section, /setDraft\(\{ \.\.\.draft, staffId: result\.staffId,/, 'the new account is linked to the profile');
  assert.match(section, /password\.length < 8/, 'the same eight-character floor the API holds');
  for (const text of ['حساب دخول المحاضر', 'مستحقات المحاضر', 'بالساعة', 'أجره على الاستشارة', 'تغيير كلمة المرور']) assert.ok(section.includes(text), text);
  // Pay goes through the HR request, which a second person approves; only the owner's own is approved on the spot.
  assert.match(section, /instructors\/\$\{draft\.staffId\}\/rates/);
  assert.match(section, /isAdmin && proposal\.id/);
  assert.match(read('admin/pages/dashboard/tabs/courses/CourseInstructorsPanel.tsx'), /<LecturerAccountSection draft=\{therapistDraft\} setDraft=\{setTherapistDraft\} notify=\{notify\} \/>/);
});

test('a profile can be linked to an instructor, trainer, consultant or expert account', () => {
  assert.match(read('api/routes/lms-admin.js'), /LOWER\(role\) IN \('instructor','trainer','consultant','expert'\)/);
  const lecturerRoles = read('api/lib/lecturerPortal.js').match(/LECTURER_ROLES = Object\.freeze\(\[([^\]]*)\]/)[1].replace(/['\s]/g, '').split(',');
  const section = read('admin/pages/dashboard/tabs/courses/LecturerAccountSection.tsx');
  for (const role of lecturerRoles) assert.ok(section.includes(`['${role.toUpperCase()}'`), `${role} can be chosen`);
});
