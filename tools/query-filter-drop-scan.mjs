#!/usr/bin/env node
/**
 * Query parameters the admin sends that the route never reads.
 *
 * An unread filter is not an empty filter — it is no filter. The باي موب screen
 * fetched `/api/admin/payments?source=paymob` against a handler that
 * destructured four query keys, none of them `source`, so a tab headed
 * "منفصل عن الدفعات اللي بيسجّلها الموظفين" listed every payment in the
 * database and summed them into its own total. The staff home panel asked for
 * `?my=true` where the route read `mine === '1'`, and showed a manager every
 * task in the tenant under "مهامي".
 *
 * Neither was visible to anything. payload-drop-scan reads request *bodies* on
 * *write* routes; this is the read side, where a dropped filter widens what
 * comes back instead of narrowing it.
 *
 * A key counts as read if the handler mentions it at all — this looks for the
 * filter that was never wired up, not for one wired up wrongly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, exts) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return [];
    const target = join(dir, entry.name);
    return entry.isDirectory() ? walk(target, exts) : [target];
  }).filter(file => exts.some(ext => file.endsWith(ext)));
}

// Pagination and cache-busting keys are handled generically or deliberately
// ignored, and flagging them would bury the real findings.
const IGNORED = new Set(['limit', 'offset', 'page', 'pageSize', 'cursor', '_', 't', 'ts']);

// Comments come out of the handler before it is searched.
//
// Caught by mutating the fix back out and watching this scan stay green: the
// comment explaining the bug names the very parameter it describes, so a
// handler that merely *documents* `source` read as one that handles it. A
// scanner that a comment can satisfy is the same failure it exists to catch.
const stripComments = source => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * The keys a handler actually takes off req.query.
 *
 * "Does the body mention the word" is not enough, and mutation testing is what
 * showed it: /api/admin/payments maps `source: p.source || null` into its
 * response, so the handler named `source` while filtering nothing by it. The
 * bug this scan exists for would have passed. Only two things count as reading
 * a parameter — `req.query.key`, and a destructure of req.query that names it,
 * including under a rename.
 */
function queryKeysRead(body) {
  const keys = new Set();
  for (const direct of body.matchAll(/req\.query\.([A-Za-z_][\w]*)/g)) keys.add(direct[1]);
  for (const direct of body.matchAll(/req\.query\[\s*['"]([^'"]+)['"]\s*\]/g)) keys.add(direct[1]);
  for (const destructured of body.matchAll(/\{([^{}]*)\}\s*=\s*req\.query/g)) {
    for (const part of destructured[1].split(',')) {
      const name = part.split(':')[0].split('=')[0].trim();
      if (/^[A-Za-z_][\w]*$/.test(name)) keys.add(name);
    }
  }
  return keys;
}

export function scanQueryFilterDrops() {
  const routes = new Map();
  for (const file of walk(join(ROOT, 'api/routes'), ['.js'])) {
    const source = readFileSync(file, 'utf8');
    const pattern = /router\.get\(\s*(['"`])([^'"`]+)\1([\s\S]*?)\n\}\);/g;
    let match;
    while ((match = pattern.exec(source))) {
      routes.set(match[2], { file: relative(ROOT, file).replace(/\\/g, '/'), body: stripComments(match[3]) });
    }
  }

  const drops = [];
  for (const file of walk(join(ROOT, 'admin'), ['.ts', '.tsx'])) {
    const source = readFileSync(file, 'utf8');
    for (const call of source.matchAll(/['"`](\/api\/[^'"`?\s]+)\?([^'"`\s]+)['"`]/g)) {
      const route = routes.get(call[1]);
      if (!route) continue;
      const read = queryKeysRead(route.body);
      for (const key of [...call[2].matchAll(/(?:^|&)([A-Za-z_][\w]*)=/g)].map(k => k[1])) {
        if (IGNORED.has(key)) continue;
        if (read.has(key)) continue;
        drops.push(`${relative(ROOT, file).replace(/\\/g, '/')}: GET ${call[1]}?${key}= — ${route.file} never reads "${key}" off req.query`);
      }
    }
  }
  return { routesIndexed: routes.size, drops };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = scanQueryFilterDrops();
  if (process.argv.includes('--list')) result.drops.forEach(drop => console.log(`  ${drop}`));
  console.log(`query-filter-drop-scan: ${result.routesIndexed} GET routes indexed, ${result.drops.length} dropped filter(s)`);
  if (result.drops.length) process.exitCode = 1;
}
