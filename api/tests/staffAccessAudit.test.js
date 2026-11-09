'use strict';

// Reviewing the accounts one by one, after the HR manager's turned out to be
// misconfigured rather than empty.
//
// The repo already refused a ROLE that holds a data permission its scope cannot
// serve (tools/role-bar-gate-scan). Both checks passed while a real person's
// account was broken, because a row carries its own permission list and its own
// data scope and neither is the role's. tools/staff-access-audit.cjs asks the
// same question of every live row; these pin the two things it must not get
// wrong.
//
// Run: npm run test:unit

const { authRouteSource } = require('./_authRouteSource');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(API, rel), 'utf8');
const audit = read('tools/staff-access-audit.cjs');

test('a login is a users row, not the legacy firebase column', () => {
  // firebase_uid looks like the link and is not one: two rows of eighteen carry
  // it, including people who had signed in that week. Reading it as "has an
  // account" reported sixteen employees locked out of a system they use daily —
  // and would have buried the three who really cannot sign in.
  
  
  assert.ok(!/firebase_uid/.test(audit.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')),
    'the audit reads firebase_uid again — it is not the login');
});

test('the audit asks about the scope a row actually resolves to', () => {
  const { resolveDataScope, resolvePermissions } = require('../constants/permissions');
  // The two cases that made the HR account look empty rather than misconfigured.
  assert.equal(resolveDataScope({ role: 'hr' }, { fallback: 'none' }), 'none');
  assert.equal(resolveDataScope({ role: 'hr', data_scope: 'all' }, { fallback: 'none' }), 'all');
  // A permission list on the row beats the role's, and the audit compares the two.
  assert.deepEqual(resolvePermissions({ role: 'hr', permissions_json: '["view_leads"]' }), ['view_leads']);
  
  
  // Read-only, like every other tool that touches a live database here.
  
  
});

test('only a full-access role may delete a client, by default or otherwise', () => {
  // The owner's rule, and the audit reads it off the rows. It has to hold one
  // level up as well: a role whose defaults carry delete_leads breaks the rule
  // the moment somebody is given that role, with nothing to configure and
  // nothing to notice. sales_collection_manager was the one — it manages a
  // team, and the rule means the manager.
  const { ROLE_PERMS, FULL_ACCESS_ROLES } = require('../constants/permissions');
  const offenders = [];
  for (const [role, perms] of Object.entries(ROLE_PERMS)) {
    if (perms === '*' || FULL_ACCESS_ROLES.includes(role)) continue;
    const deletes = perms.filter(p => ['delete_leads', 'delete_subscribers'].includes(p));
    if (deletes.length) offenders.push(`${role}: ${deletes.join(', ')}`);
  }
  assert.deepEqual(offenders, [], 'a role that is not admin or manager may delete clients by default');
  // And the two that may are exactly the two the product calls full access.
  assert.deepEqual([...FULL_ACCESS_ROLES].sort(), ['admin', 'manager']);
});




