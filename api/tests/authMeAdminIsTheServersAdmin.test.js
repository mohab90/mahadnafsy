'use strict';

// The panel's «admin» is the server's admin.
//
// GET /api/auth/me told the panel who is an admin from its own list —
// manager, admin, daqqi_manager, online_manager — while requireAdmin and
// every permission check use constants/permissions.js, where only admin and
// manager hold everything. So the Dokki manager and the online manager were
// admins to the panel alone: it showed them every section — الحسابات,
// الموارد البشرية, الإعدادات — skipped their permission checks, and asked the
// server for admin lists it then refused. On production that was نشوى, who is
// to see the Dokki branch only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('auth/me decides admin with the list the server enforces', () => {
  const auth = read('api/routes/auth.js');
  assert.ok(!auth.includes('FULL_ACCESS_ROLES_AUTH'), 'auth.js keeps a list of its own');
  const handler = auth.slice(auth.indexOf("router.get('/api/auth/me'"), auth.indexOf('res.json({ uid: u.id'));
  assert.ok(handler.includes('FULL_ACCESS_ROLES.includes('), 'auth/me must use the shared FULL_ACCESS_ROLES');
  const imported = auth.split('\n').find(l => l.includes("require('../constants/permissions')"));
  assert.ok(imported && imported.includes('FULL_ACCESS_ROLES'), `FULL_ACCESS_ROLES must come from constants/permissions: ${imported}`);
});

test('the server and the panel hold the same two roles as full access', () => {
  const { FULL_ACCESS_ROLES } = require('../constants/permissions');
  assert.deepEqual([...FULL_ACCESS_ROLES].sort(), ['admin', 'manager']);
  const panel = read('admin/constants/permissions.ts');
  const start = panel.indexOf('export const FULL_ACCESS_ROLES: RoleKey[] = [');
  assert.ok(start >= 0, 'the panel lost its FULL_ACCESS_ROLES');
  const body = panel.slice(start, panel.indexOf('];', start));
  const roles = body.slice(body.indexOf('= [') + 3).split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
  assert.deepEqual(roles.sort(), ['admin', 'manager']);
});
