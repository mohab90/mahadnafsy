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

const route = codeOnly(read('api/routes/staff.js'));
const schema = read('api/schema.sql');

const handler = (verb, path_) => {
  const start = route.indexOf(`router.${verb}('${path_}'`);
  assert.ok(start > 0, `${verb.toUpperCase()} ${path_} must exist`);
  const next = route.indexOf('\nrouter.', start + 1);
  return route.slice(start, next < 0 ? route.length : next);
};

test('deleting an employee takes them out of the list the screen reads', () => {
  // The list filters deleted_at and nothing else, so that is the column a
  // delete has to set for anyone to disappear.
  const list = handler('get', '/api/admin/staff');
  assert.match(list, /WHERE s\.tenant_id=\? AND s\.deleted_at IS NULL/);

  const remove = handler('delete', '/api/admin/staff/:id');
  assert.match(remove, /SET is_active=0, deleted_at=NOW\(\)/,
    'setting is_active alone left the employee on screen');
});

test('and cannot remove the caller, or the last owner', () => {
  const remove = handler('delete', '/api/admin/staff/:id');
  assert.match(remove, /CANNOT_DELETE_SELF/, 'a direct call could lock the caller out');
  assert.match(remove, /LAST_OWNER/, 'with no admin or manager left, nothing can create one back');
  assert.match(remove, /writeAuditEvent/, 'an owner-only destructive action leaves a trail');
});

test('an employee who was removed can be brought back, as the dialog promises', () => {
  // «سجله وتاريخه المالي يبقى محفوظًا، ويمكن إعادة تفعيله لاحقًا» — nothing
  // implemented the second half.
  const profile = read('admin/pages/StaffProfile.tsx');
  assert.match(profile, /يمكن إعادة تفعيله لاحقًا/, 'the promise is still made');

  const restore = handler('put', '/api/admin/staff/:id/restore');
  assert.match(restore, /deleted_at=NULL, is_active=1/);
  assert.match(restore, /EMAIL_TAKEN/, 'a live row may have taken the email since');
  assert.match(restore, /requireSuperAdmin/, 'restoring is as privileged as removing');
});

test('a create that fails says why', () => {
  const create = handler('post', '/api/admin/staff');
  // staff carries UNIQUE (tenant_id, email); the collision is the ordinary case.
  assert.match(schema, /UNIQUE KEY `uq_staff_tenant_email`/);
  assert.match(create, /EMAIL_TAKEN/);
  assert.match(create, /EMAIL_BELONGS_TO_DELETED_STAFF/,
    'the email that collides is often the person who was just removed');
  assert.match(create, /NAME_REQUIRED/);
  assert.match(create, /EMAIL_REQUIRED/);
  // And the race the pre-check cannot cover still answers, rather than 500ing.
  assert.match(create, /ER_DUP_ENTRY/);
});

test('the two calls behind "add employee" are reported apart', () => {
  // POST /admin/staff needs manage_staff; POST /admin/staff-account is super
  // admin only. An HR manager created the row, had the login refused, and was
  // told the whole thing failed — while the employee existed.
  const auth = read('api/routes/auth.js');
  assert.match(auth, /router\.post\('\/api\/admin\/staff-account', requireAuth, requireSuperAdmin/);
  assert.match(route, /router\.post\('\/api\/admin\/staff', requireAuth, requireAdminOrStaff, requirePermission\('manage_staff'\)/);

  const tab = codeOnly(read('admin/pages/dashboard/tabs/HRTab.tsx'));
  assert.match(tab, /تم إنشاء \$\{result\.name\} لكن حساب الدخول اتفض/,
    'a created employee with no login is not a failed creation');
  assert.match(tab, /canCreateLogin=\{isAdmin\}/,
    'and the password field is not offered to someone who cannot use it');

  const modal = codeOnly(read('admin/pages/dashboard/tabs/hr-sections/StaffOnboardModal.tsx'));
  assert.match(modal, /canCreateLogin \? '' : 'hidden'/);
});
