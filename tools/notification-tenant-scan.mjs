#!/usr/bin/env node
/**
 * notification-tenant-scan.mjs
 *
 * Static guard for NOT-03: createNotification(type, title, message, data,
 * tenantId) defaults tenantId to DEFAULT_TENANT when the caller omits it —
 * so a forgotten 5th argument doesn't throw, it silently writes the
 * notification under the wrong tenant (invisible to that tenant's staff,
 * and a real cross-tenant data leak into the default tenant's feed). This
 * exact bug shipped in routes/hr/talent.js, routes/hr/attendance.js, and
 * routes/public.js's join-us handler.
 *
 * Heuristic (regex + paren-depth), matching the style of tenant-scope-scan.mjs:
 * flags any createNotification(...) call whose argument list has fewer than
 * 5 top-level comma-separated segments. False positives are possible for
 * exotic call shapes; in practice a missing 5th argument is unambiguous.
 *
 * lib/reconcileJob.js is an intentional exception (system-wide integrity
 * alert, not scoped to any one tenant by design) — allowlisted by file path.
 *
 * Usage: node tools/notification-tenant-scan.mjs [--list]
 * Wired into tools/mahad-quality-check.mjs.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const ALLOWLIST = new Set(['lib/reconcileJob.js']);

function walk(dir, ext, results = []) {
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (f === 'node_modules' || f === '.git') continue;
    const s = statSync(full);
    if (s.isDirectory()) walk(full, ext, results);
    else if (!ext || extname(f) === ext) results.push(full);
  }
  return results;
}

// Splits a call's argument text on top-level commas (ignores commas nested
// inside (), [], {}, or string/template literals).
function splitTopLevelArgs(text) {
  const args = [];
  let depth = 0, cur = '', quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === '\\') { cur += text[++i] ?? ''; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { args.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) args.push(cur);
  return args;
}

function extractCalls(src) {
  const calls = [];
  const callRe = /\bcreateNotification\s*\(/g;
  let m;
  while ((m = callRe.exec(src))) {
    // Skip mentions inside a // line comment (e.g. this file's own doc comments).
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    if (src.slice(lineStart, m.index).includes('//')) continue;
    let depth = 1, i = callRe.lastIndex;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    calls.push({ text: src.slice(callRe.lastIndex, i - 1), offset: m.index });
  }
  return calls;
}

function lineOf(src, offset) {
  return src.slice(0, offset).split('\n').length;
}

export function scanNotificationTenantViolations() {
  const files = [...walk(join(ROOT, 'api/routes'), '.js'), ...walk(join(ROOT, 'api/lib'), '.js')];
  const violations = [];
  for (const f of files) {
    const rel = f.slice(ROOT.length).replace(/^[\\/]?api[\\/]/, '').replace(/\\/g, '/');
    if (ALLOWLIST.has(rel)) continue;
    const src = readFileSync(f, 'utf8');
    for (const call of extractCalls(src)) {
      // Skip the function's own definition (async function createNotification(...)).
      const before = src.slice(Math.max(0, call.offset - 30), call.offset).trimEnd();
      if (/\bfunction$/.test(before)) continue;
      const args = splitTopLevelArgs(call.text);
      if (args.length < 5) {
        violations.push({ file: rel, line: lineOf(src, call.offset), args: args.length, snippet: call.text.slice(0, 80).replace(/\s+/g, ' ') });
      }
    }
  }
  return violations;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').replace(/^([A-Z]):/i, ''));
if (isMain) {
  const violations = scanNotificationTenantViolations();
  if (process.argv.includes('--list')) {
    for (const v of violations) console.log(`${v.file}:${v.line} (${v.args} args) — ${v.snippet}...`);
  }
  console.log(`notification-tenant-scan: ${violations.length} createNotification() call(s) missing tenantId`);
}
