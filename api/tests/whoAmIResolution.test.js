'use strict';

// "Who is signed in?" was answered independently by twelve screens, each
// writing `staffMembers.find(m => m.email === authUser.email)`, and eleven of
// them got nobody for most of the institute.
//
// GET /api/admin/staff requires view_staff. Four roles out of sixteen hold it —
// online_manager, daqqi_manager, sales_collection_manager, hr. For the other
// ten the request is a 403, the seed is an empty array, and staffMembers stays
// empty. So `currentStaff` was undefined, `hasPermission(undefined, …)` is
// false, and every permission-gated control on those screens was hidden from
// the people entitled to use it: the accountant could not act in الحسابات, the
// sales rep could not act on their own leads, StaffPerformanceTab could not
// tell that a rep should see only themselves and showed them the whole team.
//
// GET /api/staff/me is requireAuth only — it tells any signed-in employee who
// they are. The context resolves it once now, with the staff list first and
// /staff/me as the fallback, and hands the answer to every screen.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROLE_PERMS } = require('../constants/permissions');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

function adminSources() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, 'admin'));
  return out.map(f => path.relative(ROOT, f).split(path.sep).join('/'));
}

test('the staff list really is unreadable by most roles', () => {
  // The premise the rest of this rests on. If view_staff ever became universal
  // the duplication would be harmless, and this test should be reconsidered
  // rather than silently keep passing.
  const route = codeOnly(read('api/routes/staff.js'));
  assert.match(route, /router\.get\('\/api\/admin\/staff'[\s\S]{0,140}requirePermission\('view_staff'\)/);
  assert.match(route, /router\.get\('\/api\/staff\/me', requireAuth,/,
    'the fallback route must stay open to every signed-in employee');

  const holders = Object.entries(ROLE_PERMS)
    .filter(([, perms]) => perms !== '*' && perms.includes('view_staff'))
    .map(([role]) => role);
  assert.deepEqual(holders.sort(), ['daqqi_manager', 'hr', 'online_manager', 'sales_collection_manager']);

  const blind = Object.entries(ROLE_PERMS)
    .filter(([role, perms]) => perms !== '*' && !holders.includes(role))
    .map(([role]) => role);
  assert.ok(blind.length >= 10, `expected most roles to be blind to the staff list, saw ${blind.length}`);

  // And the array they fall back to is empty, not a seed that would mask this.
  assert.match(read('admin/context/siteDataSeed.ts'), /defaultStaffMembers: StaffMember\[\] = \[\];/);
});

test('no screen answers "who am I" on its own', () => {
  const files = adminSources();
  assert.ok(files.length > 150, `expected the admin source tree, saw ${files.length}`);

  // Searching the staff list by the signed-in email — the pattern that returned
  // nobody for ten roles out of sixteen.
  const OWN_LOOKUP = /staffMembers[\s\S]{0,40}\.find\([\s\S]{0,200}email[\s\S]{0,140}authUser/;
  const offenders = files.filter(rel => {
    // The context is where the resolution lives, and App's route guard runs
    // before the provider exists.
    if (rel === 'admin/context/SiteDataContext.tsx' || rel === 'admin/App.tsx') return false;
    return OWN_LOOKUP.test(codeOnly(read(rel)));
  });
  assert.deepEqual(offenders, [],
    'these resolve the signed-in staff member themselves, and get nobody for the ten roles that cannot read the staff list: '
      + offenders.join(', '));
});

test('it is resolved once, with the fallback', () => {
  const hook = codeOnly(read('admin/context/site-data-hooks/useSignedInStaff.ts'));

  // The list first — it carries the full record, commission rate and targets
  // included — then the server's own answer.
  assert.ok(hook.includes('?? staffSelf ?? null;'),
    'without the fallback this is the same blind lookup, just in one place');
  assert.ok(hook.includes('mysqlClient.getStaffSelf()'));

  // Trimmed and lower-cased on both sides: an address stored with a trailing
  // space would otherwise miss the list and fall through to the self record,
  // which is a silent downgrade rather than a failure.
  assert.ok(hook.includes("String(m.email || '').toLowerCase().trim() === key"));

  // The context hands it to every screen, and it is in the value memo's
  // dependencies — without that, screens read the render where it was null.
  const context = codeOnly(read('admin/context/SiteDataContext.tsx'));
  assert.ok(context.includes('useSignedInStaff(isAdmin, authUser?.email, staffMembers)'));
  assert.ok(context.includes('currentStaff: StaffMember | null;'));
  assert.match(context, /isAdmin, currentStaff, staffSelf, staffSelfLoading, remoteReady,/);
});

test('one request answers it, not one per screen', () => {
  const files = adminSources();
  const fetchers = files.filter(rel => /getStaffSelf\(\)/.test(codeOnly(read(rel))));
  assert.deepEqual(fetchers.sort(), [
    // The route guard, which decides whether the dashboard renders at all and
    // therefore runs before the provider it would otherwise read from.
    'admin/App.tsx',
    // The one resolution.
    'admin/context/site-data-hooks/useSignedInStaff.ts',
  ], 'a screen fetches /api/staff/me for itself again');
});
