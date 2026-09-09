#!/usr/bin/env node
/**
 * Customer routes that take an id from the URL and never tie it to the caller.
 *
 * A route like GET /api/me/tickets/:id is only safe if the query also says
 * "and this ticket belongs to me". Where it does not, changing the number in
 * the address bar reads someone else's record — the plainest form of the data
 * leak this system has already had once, in a notification list.
 *
 * A route passes when the handler both resolves who is calling (from the token,
 * not the body) and uses that identity in the lookup. Reported rather than
 * judged: a handful legitimately address global objects, such as a course.
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

// Ways a handler establishes who is asking.
const IDENTITY = [
  'resolveSubscriberId', 'resolveSubscriberRow', '_resolveStaffByUser',
  'req.user.uid', 'req.user?.uid', 'req.staffRecord', 'customerNotificationViewer',
  'subscriberId', 'sub.id', 'subscriber.id', 'staff.id', 'viewerKey',
];
// Ways the lookup is then narrowed to them.
const SCOPED = [
  'subscriber_id', 'staff_id', 'user_id', 'firebase_uid', 'viewer_key',
  'client_email', 'author_id', 'requested_by', 'owner_id', 'recipient_staff_id',
];

// Narrowing inside the SELECT is one way to tie a record to its owner; loading
// it and then refusing when it is not theirs is another, and this scan could
// only see the first. It reported GET /api/me/tickets/:id and its reply route
// every run — both of which load the ticket and then call ownsTicket(t,
// subscriber, email) before answering — so the two standing entries in its
// output were both correct code. A scan whose output is known to be wrong is
// one nobody reads.
//
// The pattern that counts: an ownership predicate whose result gates the
// response. Naming them explicitly rather than matching anything that looks
// like a guard, so this cannot quietly start accepting a check that does not
// decide the answer.
const OWNERSHIP_GUARDS = [
  'ownsTicket(',
  'requireScopedSubscriber(',
  'assertOwnedByCaller(',
];

let examined = 0;
const unscoped = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  // `\s*` before the paren: some routes are written `router.get  (`, and a
  // pattern without it skips them silently.
  const routeRe = /router\.(get|post|put|patch|delete)\s*\(\s*'([^']+)'\s*,([^\n]*)/g;
  const bounds = [];
  let match;
  while ((match = routeRe.exec(src))) {
    bounds.push({ verb: match[1].toUpperCase(), route: match[2], guards: match[3], start: match.index });
  }

  for (let i = 0; i < bounds.length; i++) {
    const bound = bounds[i];
    if (bound.route.startsWith('/api/admin/')) continue;
    if (/requireAdmin|requireAdminOrStaff|requirePermission/.test(bound.guards)) continue;
    if (!/requireAuth/.test(bound.guards)) continue;
    if (!/:\w+/.test(bound.route)) continue; // only routes addressing a record by id
    examined++;

    const body = src.slice(bound.start, i + 1 < bounds.length ? bounds[i + 1].start : src.length);
    const knowsCaller = IDENTITY.some((token) => body.includes(token));
    // Narrowing can also be delegated: GET /api/me/lectures/:lectureId/access
    // resolves the caller and hands that id to resolveLectureAccess, which is
    // the access authority for the API and both frontends. No scoped column
    // appears in the handler because the handler is not the one querying.
    //
    // Deliberately narrow: the caller's own resolved id must be an argument to
    // the resolver. A helper called without it narrows nothing.
    const delegates = /\b(?:resolve|assert|require|check|ensure)\w*\(\s*\{?[^;]{0,200}?\bsubscriberId\b/.test(body);
    const narrows = SCOPED.some((column) => body.includes(column)) || delegates;
    // The guard has to refuse, not merely be called: a predicate whose result
    // is ignored ties nothing to anyone.
    const refuses = OWNERSHIP_GUARDS.some((guard) => {
      const at = body.indexOf(guard);
      if (at < 0) return false;
      const line = body.slice(Math.max(0, body.lastIndexOf('\n', at)), body.indexOf('\n', at));
      return /\bif\s*\(\s*!|return\s+res\.status\(4/.test(line);
    });
    if ((!knowsCaller || !narrows) && !refuses) {
      unscoped.push({
        route: bound.verb + ' ' + bound.route,
        file: rel,
        why: !knowsCaller ? 'never resolves who is calling' : 'resolves the caller but does not narrow the lookup by them',
      });
    }
  }
}

console.log('customer routes addressing a record by id: ' + examined);
console.log('not tied to the caller: ' + unscoped.length);
for (const row of unscoped) {
  console.log('  ' + row.route);
  console.log('      ' + row.file + ' — ' + row.why);
}
