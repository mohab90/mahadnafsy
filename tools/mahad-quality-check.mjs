#!/usr/bin/env node
/**
 * mahad-quality-check.mjs
 * Quick static quality scan — runs without building or starting the server.
 * Exit code 0 = all checks passed, 1 = one or more warnings/failures.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

let warnings = 0;
let checks   = 0;

function pass(msg)  { console.log(`  ✓  ${msg}`); checks++; }
function warn(msg)  { console.warn(`  ⚠  ${msg}`); checks++; warnings++; }
function fail(msg)  { console.error(`  ✗  ${msg}`); checks++; warnings++; }

function readText(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

function countLines(path) {
  const t = readText(path);
  return t ? t.split('\n').length : 0;
}

function walk(dir, ext, results = []) {
  try {
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      if (f === 'node_modules' || f === '.git' || f === 'dist') continue;
      const s = statSync(full);
      if (s.isDirectory()) walk(full, ext, results);
      else if (!ext || extname(f) === ext) results.push(full);
    }
  } catch { /* ignore unreadable dirs */ }
  return results;
}

console.log('\n🔍  Mahad Nafsy — Quality Check\n');

// ── 1. Secrets / Env leaks ───────────────────────────────────────────────────
console.log('1. Secret hygiene');
const envExample = readText(join(ROOT, 'api/.env.example'));
if (envExample) pass('.env.example exists');
else fail('.env.example missing');

const gitignore = readText(join(ROOT, 'api/.gitignore')) || readText(join(ROOT, '.gitignore')) || '';
if (gitignore.includes('.env')) pass('.env is in .gitignore');
else warn('.env not listed in .gitignore — risk of accidental commit');

const watchdog = readText(join(ROOT, 'api/watchdog.sh'));
if (watchdog && (watchdog.includes('WHATSAPP_API_KEY') || watchdog.includes('WA_TOKEN'))) {
  const hasHardcoded = /WA_TOKEN\s*=\s*['"][^'"]+['"]/.test(watchdog) ||
                       /WHATSAPP_API_KEY\s*=\s*['"][^'"]+['"]/.test(watchdog);
  if (hasHardcoded) fail('watchdog.sh contains hardcoded WhatsApp secret');
  else pass('watchdog.sh references env vars (not hardcoded)');
} else pass('watchdog.sh looks clean');

// ── 2. Large file warnings ───────────────────────────────────────────────────
console.log('\n2. File size');
const sizeChecks = [
  ['admin/pages/Dashboard.tsx', 3000],
  ['admin/pages/dashboard/tabs/LeadsTab.tsx', 2000],
  ['admin/pages/dashboard/tabs/FinancialTab.tsx', 1500],
  ['admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx', 1500],
  ['api/routes/core.js', 2000],
  ['api/routes/admin.js', 2000],
];
for (const [rel, limit] of sizeChecks) {
  const n = countLines(join(ROOT, rel));
  if (n === 0) warn(`${rel} — not found`);
  else if (n > limit) warn(`${rel} — ${n} lines (limit ${limit})`);
  else pass(`${rel} — ${n} lines`);
}

// ── 3. Critical files exist ──────────────────────────────────────────────────
console.log('\n3. Critical files');
const required = [
  'api/server.js',
  'api/lib/db.js',
  'api/middleware/auth.js',
  'api/middleware/validate.js',
  'api/middleware/rateLimits.js',
  'api/routes/auth.js',
  'api/routes/certificates.js',
  'api/.env.example',
  'tools/mahad-api-smoke.mjs',
  'DEPLOY.md',
];
for (const rel of required) {
  if (readText(join(ROOT, rel)) !== null) pass(rel);
  else fail(`${rel} — MISSING`);
}

// ── 4. DB hardening checks ───────────────────────────────────────────────────
console.log('\n4. DB hardening (db.js)');
const db = readText(join(ROOT, 'api/lib/db.js')) || '';
if (db.includes('connectTimeout')) pass('connectTimeout configured');
else warn('connectTimeout not set in db.js');
if (db.includes('requireDb')) pass('requireDb middleware exported');
else warn('requireDb middleware missing');
if (db.includes('_markDbDown')) pass('DB state tracking (_markDbDown) present');
else warn('DB state tracking missing');
if (db.includes('DB_MAX_CONCURRENT')) pass('Concurrency guard present');
else warn('Concurrency guard missing');

// ── 5. Auth hardening ────────────────────────────────────────────────────────
console.log('\n5. Auth hardening');
const authMw = readText(join(ROOT, 'api/middleware/auth.js')) || '';
if (authMw.includes('requireAuth')) pass('requireAuth middleware');
else fail('requireAuth missing');
if (authMw.includes('requireAdmin')) pass('requireAdmin middleware');
else fail('requireAdmin missing');

const rateLimits = readText(join(ROOT, 'api/middleware/rateLimits.js')) || '';
if (rateLimits.includes('loginLimiter')) pass('loginLimiter defined');
else warn('loginLimiter missing');
if (rateLimits.includes('registerLimiter')) pass('registerLimiter defined');
else warn('registerLimiter missing');
if (rateLimits.includes('publicLimiter')) pass('publicLimiter defined');
else warn('publicLimiter missing');

// ── 6. Input validation coverage ─────────────────────────────────────────────
console.log('\n6. Input validation');
const validateMw = readText(join(ROOT, 'api/middleware/validate.js')) || '';
if (validateMw.includes('validateBody')) pass('validateBody middleware present');
else fail('validateBody middleware missing');
if (validateMw.includes('stripHtml')) pass('XSS stripping (stripHtml) present');
else warn('XSS stripping missing');

const authRoutes = readText(join(ROOT, 'api/routes/auth.js')) || '';
if (authRoutes.includes('validateBody')) pass('auth.js uses validateBody');
else warn('auth.js missing validateBody');

const certRoutes = readText(join(ROOT, 'api/routes/certificates.js')) || '';
if (certRoutes.includes('validateBody')) pass('certificates.js uses validateBody');
else warn('certificates.js missing validateBody');

// ── 7. React tab extraction progress ─────────────────────────────────────────
console.log('\n7. Frontend decomposition');
const tabsDir = join(ROOT, 'admin/pages/dashboard/tabs');
const tabs = walk(tabsDir, '.tsx');
pass(`${tabs.length} tab component files in tabs/`);

const dashLines = countLines(join(ROOT, 'admin/pages/Dashboard.tsx'));
if (dashLines < 4000) pass(`Dashboard.tsx — ${dashLines} lines (under 4000)`);
else if (dashLines < 6000) warn(`Dashboard.tsx — ${dashLines} lines (still large, target <4000)`);
else fail(`Dashboard.tsx — ${dashLines} lines (very large)`);

// ── 8. Server hardening ───────────────────────────────────────────────────────
console.log('\n8. Server hardening');
const srv = readText(join(ROOT, 'api/server.js')) || '';
if (srv.includes("require('helmet')") || srv.includes('require("helmet")'))
  pass('helmet.js security headers configured');
else fail('helmet.js missing — add to server.js');

if (srv.includes("require('compression')") || srv.includes('require("compression")'))
  pass('HTTP compression (gzip) enabled');
else fail('compression middleware missing — add to server.js');

if (srv.includes('/api/health'))
  pass('health endpoint present (/api/health)');
else warn('no /api/health endpoint — monitoring cannot probe liveness');

if (srv.includes('uncaughtException'))
  pass('uncaughtException handler registered');
else fail('uncaughtException not handled — unhandled errors will crash the process');

if (srv.includes('unhandledRejection'))
  pass('unhandledRejection handler registered');
else fail('unhandledRejection not handled — promise failures will crash the process');

// ── 9. Frontend resilience & TypeScript ──────────────────────────────────────
console.log('\n9. Frontend quality');
const ebPath = join(ROOT, 'admin/components/ErrorBoundary.tsx');
if (readText(ebPath) !== null) pass('ErrorBoundary component exists');
else warn('ErrorBoundary component missing — runtime errors will crash the whole page');

const appTsx = readText(join(ROOT, 'admin/App.tsx')) || '';
if (appTsx.includes('ErrorBoundary')) pass('ErrorBoundary used in App.tsx');
else warn('ErrorBoundary not wired in App.tsx');

const tsconfig = readText(join(ROOT, 'admin/tsconfig.json')) || '';
if (tsconfig.includes('"strictNullChecks": true'))
  pass('TypeScript strictNullChecks enabled');
else warn('strictNullChecks not enabled in tsconfig.json');

if (tsconfig.includes('"forceConsistentCasingInFileNames": true'))
  pass('TypeScript forceConsistentCasingInFileNames enabled');
else warn('forceConsistentCasingInFileNames not set');

// ── 10. Test & migration coverage ────────────────────────────────────────────
console.log('\n10. Test & migration coverage');
const smokeFile = readText(join(ROOT, 'tools/mahad-api-smoke.mjs')) || '';
const smokeAssertions = (smokeFile.match(/\b(check|assert|expect|PASS|ok\()/g) || []).length;
if (smokeAssertions >= 20) pass(`smoke tests — ${smokeAssertions} assertions (>= 20)`);
else warn(`smoke tests — only ${smokeAssertions} assertions (target >= 20)`);

const migrationsDir = join(ROOT, 'api/migrations');
const migFiles = walk(migrationsDir, '.sql');
if (migFiles.length >= 7) pass(`DB migrations — ${migFiles.length} SQL files (>= 7)`);
else warn(`DB migrations — only ${migFiles.length} files (target >= 7)`);

const migration007 = readText(join(ROOT, 'api/migrations/007_consolidated_runtime_schema.sql')) || '';
const indexCount = (migration007.match(/ADD INDEX/g) || []).length;
if (indexCount >= 15) pass(`DB indexes — ${indexCount} indexes in migration 007 (>= 15)`);
else warn(`DB indexes — only ${indexCount} indexes defined (target >= 15)`);

// ── 11. Financial schema-correctness guard ───────────────────────────────────
// Locks in the schema fixes verified against the live DB (expenses=amount/date,
// payroll_items=payroll_run_id/net_salary, analytics revenue=payments table).
// These tokens are columns/tables that do NOT exist for the financial queries and
// previously caused the cockpit/P&L/payroll endpoints to crash. Fail if they return.
console.log('\n11. Financial schema-correctness guard');
const finText = [
  readText(join(ROOT, 'api/routes/finance.js')),
  readText(join(ROOT, 'api/routes/analytics.js')),
  readText(join(ROOT, 'api/routes/admin-utils.js')),
].join('\n');
const forbiddenFinTokens = ['expense_date', 'gross_salary', 'pi.run_id'];
const hitFin = forbiddenFinTokens.filter(t => finText.includes(t));
if (hitFin.length === 0) pass('financial routes free of non-existent schema columns (expense_date/gross_salary/pi.run_id)');
else warn(`financial routes reference non-existent columns: ${hitFin.join(', ')}`);

const analyticsText = readText(join(ROOT, 'api/routes/analytics.js')) || '';
if (!/paid_at/.test(analyticsText) && !/payment_audit_log/.test(analyticsText))
  pass('analytics revenue queries use the payments table (no paid_at / payment_audit_log)');
else warn('analytics.js still references paid_at or payment_audit_log for revenue');

// ── 12. Authorization-coverage guard ─────────────────────────────────────────
// Every admin mutating endpoint (POST/PUT/PATCH/DELETE on /api/admin/*) MUST carry
// an authorization guard beyond requireAuth — otherwise any logged-in user (even a
// client) can hit it. Guard tokens may sit on the route line or the next line
// (multiline route definitions). Catches the installment-plans class of hole.
console.log('\n12. Authorization-coverage guard');
const AUTHZ = /requireAdmin\b|requireAdminOrStaff|requirePermission|requireAdminOrOnlineManager|requireSuperAdmin/;
const routeFiles = walk(join(ROOT, 'api/routes'), '.js');
const adminMutating = [];
const unguarded = [];
for (const f of routeFiles) {
  const lines = (readText(f) || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/router\.(post|put|patch|delete)\('\/api\/admin\//.test(lines[i])) {
      adminMutating.push(1);
      const window = (lines[i] + '\n' + (lines[i + 1] || '') + '\n' + (lines[i + 2] || ''));
      if (!AUTHZ.test(window)) unguarded.push(`${f.split(/[\\/]/).slice(-1)[0]}:${i + 1}`);
    }
  }
}
if (unguarded.length === 0) pass(`all ${adminMutating.length} admin mutating endpoints carry an authz guard`);
else fail(`admin mutating endpoints with NO authz guard (any logged-in user can call): ${unguarded.join(', ')}`);

// ── 13. Duplicate-route guard (regression lock) ──────────────────────────────
// All 37 route files are mounted, so a (method+path) defined in two files means
// the later-mounted handler is DEAD (Express first-match wins) — a maintenance
// hazard. There is a known backlog of such duplicates; this guard locks it so the
// count can only DECREASE. Lowering DUP_BASELINE as duplicates are cleaned keeps
// it honest. It FAILS if a NEW duplicate is introduced.
console.log('\n13. Duplicate-route guard');
const DUP_BASELINE = 0; // all duplicate routes cleaned (removed 5 dead files + 20 dead handlers, 2026-06-20). Keep at 0.
const routeDefs = [];
for (const f of walk(join(ROOT, 'api/routes'), '.js')) {
  const t = readText(f) || '';
  const re = /router\.(get|post|put|patch|delete)\('(\/api\/[^']+)'/g;
  let m;
  while ((m = re.exec(t))) routeDefs.push(`${m[1]} ${m[2]}`);
}
const seen = new Map();
for (const r of routeDefs) seen.set(r, (seen.get(r) || 0) + 1);
const dupCount = [...seen.values()].filter(n => n > 1).length;
if (dupCount <= DUP_BASELINE) pass(`duplicate routes: ${dupCount} (≤ baseline ${DUP_BASELINE}; lower the baseline as you clean them)`);
else fail(`duplicate routes increased to ${dupCount} (baseline ${DUP_BASELINE}) — a new endpoint shadows an existing one`);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
if (warnings === 0) {
  console.log(`✅  All ${checks} checks passed\n`);
  process.exit(0);
} else {
  console.log(`⚠️   ${warnings} warning(s) / failure(s) out of ${checks} checks\n`);
  process.exit(1);
}
