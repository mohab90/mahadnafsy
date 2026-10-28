'use strict';
/**
 * Creating and removing an employee.
 *
 * Deleting one set is_active=0, while the list the HR screen reads filters on
 * deleted_at — so the person stayed on screen, now labelled «غير نشط», right
 * after a dialog promised to remove them. Production showed 18 staff with none
 * inactive and none deleted, which is what a delete that never removes anyone
 * looks like.
 *
 * Creating one reported every failure as a bare 500, so a taken email, a blank
 * name and a real fault all read «تعذر إنشاء الموظف». And the add flow is two
 * calls with different permissions — the staff row needs manage_staff, the
 * login needs super admin — reported as one. Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// The route's half — a deleted employee leaves the list and can be restored,
// nobody deletes themselves, a failed create names its reason, HR may create a
// login but not an owner's — runs over HTTP in
// tests/integration/staffAndAccounts.integration.test.js. These are the screens.

test('an employee who was removed can be brought back, as the dialog promises', () => {
  const profile = read('admin/pages/StaffProfile.tsx');
  assert.match(profile, /يمكن إعادة تفعيله لاحقًا/, 'the promise is still made');
});

test('a created employee with no login is not reported as a failed creation', () => {
  const tab = codeOnly(read('admin/pages/dashboard/tabs/HRTab.tsx'));
  assert.match(tab, /تم إنشاء \$\{result\.name\} لكن حساب الدخول اتفض/,
    'a created employee with no login is not a failed creation');
  assert.match(tab, /canCreateLogin=\{canAddStaff\}/,
    'the field is offered to exactly the people who can complete it');
});

test('the form never demands a password it does not offer', () => {
  const modal = codeOnly(read('admin/pages/dashboard/tabs/hr-sections/StaffOnboardModal.tsx'));
  assert.match(modal, /canCreateLogin \? '' : 'hidden'/);
  assert.match(modal, /\{canCreateLogin && form\.activate && !form\.password && \(/);
  assert.match(modal, /الموظف هيتسجل من غير حساب دخول/,
    'and when it is hidden, the form says what will happen instead');
});
