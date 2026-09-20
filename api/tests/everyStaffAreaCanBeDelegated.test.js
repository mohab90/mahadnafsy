'use strict';

// A part of the system an employee can be given is a part with a permission.
//
// The institute hands out work by permission — الإعدادات ← صلاحيات الموظف — but
// 192 admin routes asked for requireAdmin instead, which only the owner and a
// manager pass. So there was no way to let the content person edit a course,
// the receptionist answer the inbox, or HR read an appraisal: the screen was
// offered by the permission grid and the API refused it. The permissions for
// these areas already existed; the routes simply did not use them.
//
// The areas below are the ones the desk works in. System administration —
// settings, security, backups, the SaaS and channel credentials — deliberately
// stays with the owner and is not listed here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROUTES = path.join(__dirname, '..', 'routes');

function routeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? routeFiles(full) : (entry.name.endsWith('.js') ? [full] : []);
  });
}

// Every /api/admin route with the guards it declares, spreads resolved.
function routesWithGuards() {
  const out = [];
  for (const file of routeFiles(ROUTES)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/router\.(get|post|put|patch|delete)\('(\/api\/admin\/[^']+)'([^)]*)/g)) {
      const [, method, route, rawGuards] = m;
      let guards = rawGuards;
      for (const spread of rawGuards.matchAll(/\.\.\.(\w+)/g)) {
        const decl = new RegExp('const\\s+' + spread[1] + '\\s*=\\s*\\[([^\\]]*)\\]').exec(source);
        if (decl) guards += ' ' + decl[1];
      }
      out.push({ file: path.relative(ROUTES, file), method: method.toUpperCase(), route, guards });
    }
  }
  return out;
}

// prefix → what an employee holding the right permission should reach.
const DELEGATED = [
  '/api/admin/courses', '/api/admin/lectures', '/api/admin/chapters', '/api/admin/quizzes',
  '/api/admin/bundles', '/api/admin/live-streams', '/api/admin/testimonials', '/api/admin/therapists',
  '/api/admin/consultations', '/api/admin/certificate-requests',
  '/api/admin/inbox', '/api/admin/contact-messages', '/api/admin/notification-settings',
  '/api/admin/appraisals', '/api/admin/analytics/', '/api/admin/promo-codes', '/api/admin/discounts',
  '/api/admin/kpi/', '/api/admin/funnel', '/api/admin/forecast',
];

// Reads that a permission opens where the matching write stays with the owner.
const READ_ONLY_DELEGATED = ['GET /api/admin/activity-logs'];

test('the areas the desk works in are opened by a permission, not by being an admin', () => {
  const adminOnly = routesWithGuards().filter(r =>
    (DELEGATED.some(prefix => r.route === prefix || r.route.startsWith(prefix + '/') || r.route.startsWith(prefix + '?'))
      || READ_ONLY_DELEGATED.includes(`${r.method} ${r.route}`))
    && /\brequireAdmin\b/.test(r.guards)
    && !/requirePermission|requireAnyPermission|requirePermissionOr/.test(r.guards));
  assert.deepEqual(adminOnly.map(r => `${r.method} ${r.route} (${r.file})`), [],
    'these can only be reached by the owner, so the permission that names them grants nothing');
});

test('every permission a route asks for is a permission that exists', () => {
  const { PERMISSIONS } = require('../constants/permissions');
  const known = new Set(Object.values(PERMISSIONS));
  const unknown = [];
  for (const r of routesWithGuards()) {
    for (const m of r.guards.matchAll(/require(?:Any)?Permission(?:OrSelf|OrOwnRows)?\(\s*'([a-z_]+)'/g)) {
      if (!known.has(m[1])) unknown.push(`${r.method} ${r.route} asks for '${m[1]}'`);
    }
  }
  assert.deepEqual(unknown, [], 'a typo here silently refuses everybody');
});

test('every permission can be handed out from الإعدادات', () => {
  const { PERMISSIONS } = require('../constants/permissions');
  const panel = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'constants', 'permissions.ts'), 'utf8');
  const labels = panel.slice(panel.indexOf('PERMISSION_LABELS'), panel.indexOf('PERMISSION_CATEGORIES'));
  const categories = panel.slice(panel.indexOf('PERMISSION_CATEGORIES'), panel.indexOf('export const FULL_ACCESS_ROLES'));
  const offered = new Set([...categories.matchAll(/'([a-z_]+)'/g)].map(m => m[1]));
  const missing = Object.values(PERMISSIONS).filter(p => !offered.has(p));
  assert.deepEqual(missing, [],
    'a permission the grid does not list cannot be given to anybody — the four أداء الفرق ones were added with their screens and never listed');
  const unlabelled = Object.values(PERMISSIONS).filter(p => !new RegExp(`^\\s{2}${p}:`, 'm').test(labels));
  assert.deepEqual(unlabelled, [], 'and one with no Arabic label reads as a key in the grid');
});
