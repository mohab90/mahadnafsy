#!/usr/bin/env node
/**
 * Routes that hand a database row straight to a browser.
 *
 * mysql2 returns column names exactly as the table spells them, so
 * `res.json(rows)` after `SELECT session_date, meeting_link` ships snake_case.
 * Every screen in this project reads camelCase, and both client apps cast the
 * response to their own type — `rows as unknown as LiveStream[]` — so nothing
 * fails loudly. The field is simply undefined and the card renders without it.
 *
 * Not hypothetical: /api/me/consultations and /api/live-streams both did this.
 * A confirmed consultation drew with no therapist, no date and no join button,
 * and a live session never lit up as live, because the fields the screen wanted
 * were spelled differently in the row it was handed.
 *
 * A response is flagged only when its SELECT names a snake_case column or uses
 * a wildcard, so a route selecting `id, title, amount` is not reported.
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

// Words that look like columns but never reach a screen as data.
const IGNORE = new Set([
  'tenant_id', 'deleted_at', 'created_at', 'updated_at', 'order_by', 'is_null',
  'group_concat', 'date_format', 'left_join', 'inner_join', 'on_duplicate',
]);
const SNAKE = /^[a-z]+(?:_[a-z0-9]+)+$/;

let routesChecked = 0;
const findings = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).split(path.sep).join('/');

  const routeRe = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
  const bounds = [];
  let match;
  while ((match = routeRe.exec(src))) {
    bounds.push({ verb: match[1].toUpperCase(), route: match[2], start: match.index });
  }

  for (let i = 0; i < bounds.length; i++) {
    const body = src.slice(bounds[i].start, i + 1 < bounds.length ? bounds[i + 1].start : src.length);
    routesChecked++;

    // A response handing over a bare variable rather than an object literal.
    const jsonRe = /res\.json\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
    let call;
    while ((call = jsonRe.exec(body))) {
      const name = call[1];
      // Was that variable filled from a SELECT inside this handler?
      const decl = new RegExp(
        '(?:const|let)\\s*\\[?\\s*' + name + '\\b[\\s\\S]{0,400}?`([\\s\\S]*?)`'
      ).exec(body);
      const sql = decl ? decl[1] : '';
      if (!/select/i.test(sql)) continue;

      const wildcard = /select\s+[\w.]*\*/i.test(sql);
      const cols = [...new Set((sql.match(/[a-z]+(?:_[a-z0-9]+)+/g) || []))]
        .filter(col => SNAKE.test(col) && !IGNORE.has(col));
      if (!wildcard && cols.length === 0) continue;

      findings.push({
        file: rel,
        route: bounds[i].verb + ' ' + bounds[i].route,
        why: wildcard ? 'SELECT *' : 'snake_case column(s): ' + cols.slice(0, 4).join(', '),
      });
      break;
    }
  }
}

console.log('raw-row-response-scan: ' + routesChecked + ' route handler(s) examined');
console.log('responses handing a database row straight to a client: ' + findings.length);
for (const found of findings) {
  console.log('  ' + found.route);
  console.log('      ' + found.file + ' — ' + found.why);
}
