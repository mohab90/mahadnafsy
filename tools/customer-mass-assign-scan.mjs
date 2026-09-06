#!/usr/bin/env node
/**
 * Fields a caller must not be able to choose for themselves.
 *
 * A customer-facing write route that reads `amount`, `price`, `status` or a
 * role off the request body is letting the browser decide something the server
 * owns. This codebase has had that exact bug: the checkout once took the course
 * price from the request, so the customer chose what a course cost.
 *
 * Reports the read, not a verdict — several are legitimate (a support ticket
 * carries a subscriber_id the route then verifies). The point is that each one
 * has to be looked at, and that the number does not quietly grow.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES = path.join(ROOT, 'api', 'routes');

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
})(ROUTES);

const SENSITIVE = [
  'amount', 'price', 'status', 'role', 'permissions', 'balance', 'discount',
  'commission', 'tenant_id', 'tenantId', 'is_admin', 'isAdmin',
  'staff_id', 'staffId', 'subscriber_id', 'subscriberId', 'currency',
];

let examined = 0;
const hits = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const routeRe = /router\.(post|put|patch|delete)\(\s*'([^']+)'\s*,([^\n]*)/g;
  const bounds = [];
  let match;
  while ((match = routeRe.exec(src))) {
    bounds.push({ verb: match[1].toUpperCase(), route: match[2], guards: match[3], start: match.index });
  }

  for (let i = 0; i < bounds.length; i++) {
    const bound = bounds[i];
    const staffGated = /requireAdmin|requireAdminOrStaff|requireStaff|requirePermission/.test(bound.guards);
    if (staffGated || bound.route.startsWith('/api/admin/')) continue;
    if (!/requireAuth|optionalAuth/.test(bound.guards)) continue;
    examined++;

    const body = src.slice(bound.start, i + 1 < bounds.length ? bounds[i + 1].start : src.length);
    const taken = SENSITIVE.filter((field) => {
      const direct = new RegExp('req\\.body[?.]*\\.' + field + '\\b');
      const destructured = new RegExp('(?:const|let)\\s*\\{[^}]*\\b' + field + '\\b[^}]*\\}\\s*=\\s*req\\.body');
      return direct.test(body) || destructured.test(body);
    });
    if (taken.length) hits.push({ route: bound.verb + ' ' + bound.route, file: rel, taken });
  }
}

console.log('customer-facing write routes examined: ' + examined);
console.log('routes reading a server-owned field from the request body: ' + hits.length);
for (const hit of hits) {
  console.log('  ' + hit.route);
  console.log('      ' + hit.file + ' — ' + hit.taken.join(', '));
}
