'use strict';
// ADMIN_EMAILS / ADMIN_UIDS name the original institute's owners. They used to
// count in every institute: an account in another institute carrying one of
// those emails — which that institute's credential editor or HR screen can set
// — was a full administrator there. Platform operators have their own list.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-jwt-secret-0123456789abcdef';
process.env.ADMIN_EMAILS = 'owner@institute.test';
process.env.ADMIN_UIDS = 'owner-uid-1';
const { isInstituteOwner } = require('../middleware/auth');
const { DEFAULT_TENANT_ID } = require('../lib/tenantScope');

test('the owner list counts in the original institute', () => {
  assert.equal(isInstituteOwner({ email: ' Owner@Institute.test ', tenantId: DEFAULT_TENANT_ID }), true);
  assert.equal(isInstituteOwner({ uid: 'owner-uid-1', tenantId: DEFAULT_TENANT_ID }), true);
  assert.equal(isInstituteOwner({ email: 'someone@else.test', tenantId: DEFAULT_TENANT_ID }), false);
});

test('and nowhere else', () => {
  assert.equal(isInstituteOwner({ email: 'owner@institute.test', tenantId: 'tenant-other' }), false);
  assert.equal(isInstituteOwner({ uid: 'owner-uid-1', tenantId: 'tenant-other' }), false);
});

test('no access decision reads the owner list directly', () => {
  // Refusing an owner email (signup, invitations, staff lists) is fine anywhere;
  // granting on it goes through isInstituteOwner.
  const API = path.join(__dirname, '..');
  const offenders = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const full = path.join(d, e.name);
    if (e.isDirectory()) return walk(full);
    if (!e.name.endsWith('.js')) return;
    fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      if (/isAdminEmail\(email\) \|\| ADMIN_UIDS|ADMIN_UIDS\.includes\(|(isAdmin|forcedAdmin|isOperator|canUpdate\w*)\b[^\n]*ADMIN_EMAILS/.test(line)
        && !/function isInstituteOwner|return isAdminEmail|^\s*(\/\/|\*)/.test(line)) {
        offenders.push(`${path.relative(API, full)}:${i + 1}`);
      }
    });
  });
  for (const dir of ['middleware', 'routes', 'lib']) walk(path.join(API, dir));
  assert.deepEqual(offenders, []);
});
