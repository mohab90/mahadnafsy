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

const { authRouteSource } = require('./_authRouteSource');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, read } = require('./support/repo');


test('auth/me decides admin with the list the server enforces', () => {
  const auth = authRouteSource();
  
  const handler = auth.slice(auth.indexOf("router.get('/api/auth/me'"), auth.indexOf('res.json({ uid: u.id'));
  assert.ok(handler.includes('FULL_ACCESS_ROLES.includes('), 'auth/me must use the shared FULL_ACCESS_ROLES');
  const imported = auth.split('\n').find(l => /require\('(?:\.\.\/)+constants\/permissions'\)/.test(l));
  assert.ok(imported && imported.includes('FULL_ACCESS_ROLES'), `FULL_ACCESS_ROLES must come from constants/permissions: ${imported}`);
});
