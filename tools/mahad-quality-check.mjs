#!/usr/bin/env node
/**
 * mahad-quality-check.mjs
 * Quick static quality scan — runs without building or starting the server.
 * Exit code 0 = all checks passed, 1 = one or more warnings/failures.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { scanTenantViolations } from './tenant-scope-scan.mjs';
import { scanMigrationDrift } from './migration-drift-scan.mjs';
import { scanNotificationTenantViolations } from './notification-tenant-scan.mjs';
import { scanBulkRateLimitViolations } from './bulk-rate-limit-scan.mjs';
import { scanPublicRateLimitViolations } from './public-rate-limit-scan.mjs';
import { scanPermissionMatrix } from './permission-matrix-scan.mjs';
import { scanSchemaSourceDrift } from './schema-source-drift.mjs';
import { scanIndexDefeats } from './index-defeat-scan.mjs';

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
const srv = [
  readText(join(ROOT, 'api/server.js')),
  readText(join(ROOT, 'api/lib/httpApp.js')),
  readText(join(ROOT, 'api/lib/processLifecycle.js')),
].filter(Boolean).join('\n');
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
const ebPath = join(ROOT, 'shared/ui/ErrorBoundary.tsx');
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
const AUTHZ = /requireAdmin\b|requireAdminOrStaff|requirePermission|requireAdminOrOnlineManager|requireSuperAdmin|requirePlatformAdmin/;
const routeFiles = walk(join(ROOT, 'api/routes'), '.js');
const adminMutating = [];
const unguarded = [];
for (const f of routeFiles) {
  const routeText = readText(f) || '';
  const lines = routeText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/router\.(post|put|patch|delete)\('\/api\/admin\//.test(lines[i])) {
      adminMutating.push(1);
      const window = (lines[i] + '\n' + (lines[i + 1] || '') + '\n' + (lines[i + 2] || ''));
      const guardedSpread = [...window.matchAll(/\.\.\.(\w+)/g)].some(([, name]) => {
        const declaration = routeText.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
        return declaration && AUTHZ.test(declaration[1]);
      });
      if (!AUTHZ.test(window) && !guardedSpread) {
        unguarded.push(`${f.split(/[\\/]/).slice(-1)[0]}:${i + 1}`);
      }
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
//
// Two coverage gaps fixed (ARC-02): the path string is matched with any of
// '/"/` (not just single quotes) via a backreferenced delimiter, and each path
// is normalized (every :paramName segment collapsed to :param) before
// comparing — Express dispatches on path SHAPE, so /api/orders/:id and
// /api/orders/:orderId shadow each other identically even though they were
// previously counted as two different, non-colliding strings.
console.log('\n13. Duplicate-route guard');
const DUP_BASELINE = 0; // all duplicate routes cleaned (removed 5 dead files + 20 dead handlers, 2026-06-20). Keep at 0.
const normalizeRoutePath = (p) => p.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':param');
const routeDefs = [];
for (const f of walk(join(ROOT, 'api/routes'), '.js')) {
  const t = readText(f) || '';
  const re = /router\.(get|post|put|patch|delete)\(\s*(['"`])(\/api\/[^'"`]+)\2/g;
  let m;
  while ((m = re.exec(t))) routeDefs.push(`${m[1]} ${normalizeRoutePath(m[3])}`);
}
const seen = new Map();
for (const r of routeDefs) seen.set(r, (seen.get(r) || 0) + 1);
const dupCount = [...seen.values()].filter(n => n > 1).length;
if (dupCount <= DUP_BASELINE) pass(`duplicate routes: ${dupCount} (≤ baseline ${DUP_BASELINE}; lower the baseline as you clean them)`);
else fail(`duplicate routes increased to ${dupCount} (baseline ${DUP_BASELINE}) — a new endpoint shadows an existing one`);

// ── 14. Tenant isolation guard (regression lock) ─────────────────────────────
// Every table with a tenant_id column (list derived automatically from the
// migrations, see tools/tenant-scope-scan.mjs) must be touched with tenant_id
// in the same query. This class of bug is how 4+ real cross-tenant data
// leaks made it into the codebase (payments/review, admin/search,
// migrate-branches, and tables that had no tenant_id column at all). Locks
// the count so it can only DECREASE — lower BASELINE as violations are fixed.
console.log('\n14. Tenant isolation guard');
const TENANT_VIOLATION_BASELINE = 0;
const { tenantTableCount, violations: tenantViolations } = scanTenantViolations();
if (tenantViolations.length <= TENANT_VIOLATION_BASELINE) {
  pass(`tenant-scope violations: ${tenantViolations.length} across ${tenantTableCount} tracked tables (≤ baseline ${TENANT_VIOLATION_BASELINE}; lower the baseline as you clean them)`);
} else {
  fail(`tenant-scope violations increased to ${tenantViolations.length} (baseline ${TENANT_VIOLATION_BASELINE}) — a new query on a tenant-scoped table is missing tenant_id. Run: node tools/tenant-scope-scan.mjs --list`);
}

// ── Permission matrix guard ─────────────────────────────────────────────────
console.log('\nPermission matrix guard');
const permissionMatrix = scanPermissionMatrix();
const permissionViolations = [
  ...permissionMatrix.unguardedStaffRoutes,
  ...permissionMatrix.unknownRoutePermissions,
  ...permissionMatrix.unmappedTabs,
  ...permissionMatrix.unknownTabPermissions,
  ...permissionMatrix.permissionRegistryDrift,
];
if (!permissionViolations.length) {
  pass(`permission matrix complete across ${permissionMatrix.routeFiles} route files and ${permissionMatrix.tabCount} dashboard tabs`);
} else {
  fail(`${permissionViolations.length} permission-matrix violation(s). Run: node tools/permission-matrix-scan.mjs --list`);
}

// ── 15. Migration-schema drift guard ─────────────────────────────────────────
// Catches the exact bug behind the migration-011-vs-028 production incident
// (a real customer's lead vanished 2026-07-10, see 033_tenant_default_
// alignment.sql): a later migration's `ADD COLUMN IF NOT EXISTS` silently
// doing nothing because the column already exists with a different default
// from an earlier migration. Baseline is 0 and stays 0 — unlike the tenant-
// scope guard there is no legacy backlog to work down here; any hit means a
// NEW migration just introduced the same class of silent no-op.
console.log('\n15. Migration-schema drift guard');
const { unresolved: migrationDriftUnresolved } = scanMigrationDrift();
if (migrationDriftUnresolved.length === 0) {
  pass('migration drift: 0 unresolved ADD COLUMN IF NOT EXISTS conflicts (7 historical ones from 011↔028 confirmed fixed by 033)');
} else {
  fail(`migration drift: ${migrationDriftUnresolved.length} unresolved column-default conflict(s) — a migration's ADD COLUMN IF NOT EXISTS is silently not applying. Run: node tools/migration-drift-scan.mjs --list`);
}

// ── 16. Notification tenant guard ────────────────────────────────────────────
// Catches NOT-03: createNotification()'s tenantId param defaults to the
// default tenant, so a forgotten 5th argument doesn't throw — it silently
// writes the notification under the wrong tenant (invisible to that
// tenant's staff, and a cross-tenant leak into the default tenant's feed).
// Shipped in routes/hr/talent.js, routes/hr/attendance.js, and public.js's
// join-us handler; all three fixed. Baseline 0, no legacy backlog.
console.log('\n16. Notification tenant guard');
const notificationTenantViolations = scanNotificationTenantViolations();
if (notificationTenantViolations.length === 0) {
  pass('notification tenant guard: 0 createNotification() calls missing tenantId');
} else {
  fail(`notification tenant guard: ${notificationTenantViolations.length} createNotification() call(s) missing tenantId — silently defaults to the default tenant. Run: node tools/notification-tenant-scan.mjs --list`);
}

// ── 17. Bulk/export rate-limit guard ─────────────────────────────────────────
// Catches NOT-04: bulk actions and data exports are far more expensive per
// request than an ordinary admin GET/POST, but only had the generic
// adminLimiter (400 req/min per IP) — no dedicated, per-user-keyed limit.
console.log('\n17. Bulk/export rate-limit guard');
const bulkRateLimitViolations = scanBulkRateLimitViolations();
if (bulkRateLimitViolations.length === 0) {
  pass('bulk/export rate-limit guard: 0 bulk/export routes missing a dedicated limiter');
} else {
  fail(`bulk/export rate-limit guard: ${bulkRateLimitViolations.length} bulk/export route(s) missing a dedicated rate limiter. Run: node tools/bulk-rate-limit-scan.mjs --list`);
}

// ── 18. Public/optionalAuth rate-limit guard ──────────────────────────────────
// Catches the root cause behind RATE-01..04: rate limiting was added
// per-endpoint by hand, so a newly-added public or optionalAuth route can
// silently ship with zero abuse protection until the next manual audit finds
// it. /api/admin and /api/staff are excluded (blanket adminLimiter/
// advancedRateLimit at the app.use() mount in server.js already covers them).
console.log('\n18. Public/optionalAuth rate-limit guard');
const publicRateLimitViolations = scanPublicRateLimitViolations();
if (publicRateLimitViolations.length === 0) {
  pass('public rate-limit guard: 0 public/optionalAuth routes missing a dedicated limiter');
} else {
  fail(`public rate-limit guard: ${publicRateLimitViolations.length} public/optionalAuth route(s) missing a dedicated rate limiter. Run: node tools/public-rate-limit-scan.mjs --list`);
}

// ── 20. schema.sql ↔ migrations drift guard ───────────────────────────────────
// A fresh environment loads api/schema.sql and then replays only the migrations
// newer than that snapshot (001-033 are baselined = recorded WITHOUT executing).
// So structure the migrations build but schema.sql doesn't declare is stale
// documentation at best and — when it came from a baselined migration — a
// table/column a NEW environment would never get at worst. Baselined so the gap
// can shrink but never silently grow.
// Measured 2026-07-30: 15 tables / 79 columns. Nearly all come from
// post-baseline migrations, which still execute on a fresh build and therefore
// self-heal; the rest are stale declarations in migration 007 that the live
// schema later renamed (e.g. conditions → conditions_json).
console.log('\n20. schema.sql ↔ migrations drift guard');
// Tables are now at ZERO: the 13 real ones were copied verbatim from their
// owning migrations into schema.sql, and the rest turned out not to be drift at
// all — `lectures`/`tickets`/`lecture_logs` are only ever ALTERed (stale names;
// the real tables are course_lectures/support_tickets), and the *_archive pair
// is CREATE TABLE ... LIKE, which the migration rebuilds from its parent.
// Columns remain documentation-only drift: all but 3 come from post-baseline
// migrations that still execute on a fresh build, and those 3 are stale
// migration-007 declarations the live schema later renamed.
const SCHEMA_DRIFT_TABLE_BASELINE = 0;
const SCHEMA_DRIFT_COLUMN_BASELINE = 79;
const schemaDrift = scanSchemaSourceDrift();
if (schemaDrift.missingTables.length <= SCHEMA_DRIFT_TABLE_BASELINE
    && schemaDrift.missingColumnCount <= SCHEMA_DRIFT_COLUMN_BASELINE) {
  pass(`schema drift: ${schemaDrift.missingTables.length} table(s) / ${schemaDrift.missingColumnCount} column(s) built by migrations but absent from schema.sql (≤ baseline ${SCHEMA_DRIFT_TABLE_BASELINE}/${SCHEMA_DRIFT_COLUMN_BASELINE}; lower it as schema.sql is refreshed)`);
} else {
  fail(`schema drift grew to ${schemaDrift.missingTables.length} table(s) / ${schemaDrift.missingColumnCount} column(s) (baseline ${SCHEMA_DRIFT_TABLE_BASELINE}/${SCHEMA_DRIFT_COLUMN_BASELINE}) — a migration added structure api/schema.sql doesn't declare, so a fresh build from it would be incomplete. Run: node tools/schema-source-drift.mjs --list`);
}

// ── 21. Index-defeat guard ────────────────────────────────────────────────────
// Wrapping an indexed column in a function inside WHERE/JOIN (LOWER(status),
// DATE(created_at), MONTH(x)=? AND YEAR(x)=?) silently turns the query into a
// full table scan: still correct, just linearly slower as the table grows — the
// failure mode that only appears in production at scale. This class kept
// reappearing (fixed in routes, then found again in lib, then reintroduced by
// parallel work), so it's locked at ZERO rather than a baseline.
// Projections (SELECT DATE(x) AS day) and headcount-bounded tables
// (attendance_logs, leaves, payroll_*) are exempt — see the scanner.
console.log('\n21. Index-defeat guard (functions on indexed columns)');
const indexDefeats = scanIndexDefeats();
if (indexDefeats.length === 0) {
  pass('index-defeat guard: 0 function-wrapped indexed columns in WHERE/JOIN');
} else {
  fail(`index-defeat guard: ${indexDefeats.length} indexed column(s) wrapped in a function inside WHERE/JOIN — these force full table scans. Run: node tools/index-defeat-scan.mjs --list`);
}

// ── 22. Payment ↔ journal guard ───────────────────────────────────────────────
// Revenue everywhere (dashboards, P&L, the 12-month trend) is summed from
// journal_entry_lines, never from the payments table. So a payment path that
// inserts a payments row without posting a double-entry journal is money that
// exists for the customer and does not exist for accounting — and it fails
// silently, because the payment itself succeeds. Every file that writes a
// payments row must go through postPaymentJournal.
console.log('\n22. Payment ↔ journal guard');
{
  // The reconciliation stub writes amount=0/status='pending' placeholder rows for
  // enrollments that never had a payment. They are deliberately not revenue.
  const JOURNAL_EXEMPT = new Set(['api/routes/crm-tools.js']);
  const unjournaled = [];
  for (const file of walk(join(ROOT, 'api'), '.js')) {
    const rel = file.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/'), '').replace(/^\//, '');
    if (rel.includes('/tests/') || JOURNAL_EXEMPT.has(rel)) continue;
    const src = readText(file);
    if (!/INSERT INTO payments\b/i.test(src)) continue;
    if (!/postPaymentJournal/.test(src)) unjournaled.push(rel);
  }
  if (unjournaled.length === 0) {
    pass('payment↔journal guard: every payment-writing file posts a double-entry journal');
  } else {
    fail(`payment↔journal guard: ${unjournaled.length} file(s) INSERT INTO payments without postPaymentJournal — that revenue never reaches the P&L: ${unjournaled.join(', ')}`);
  }
}

// ── 23. Client-identity guard ─────────────────────────────────────────────────
// "Which subscriber is the signed-in client?" must go through
// lib/subscriberIdentity.js. Resolving it by email alone silently returns
// nothing for anyone who signed in with a WhatsApp number and has no email —
// the client sees an empty account and the server reports no error at all.
console.log('\n23. Client-identity guard (subscriber lookup by email alone)');
{
  // Not client identity: uniqueness checks on submitted input, the sign-in and
  // signup flows themselves, bulk sends addressed by email, and lookups keyed on
  // a record's stored email rather than on the caller.
  const IDENTITY_EXEMPT = new Set([
    'api/routes/auth.js',
    'api/routes/admin/subscribers.js',
    'api/routes/campaigns.js',
    'api/routes/support.js',
    'api/routes/client-maintenance.js',
  ]);
  const offenders = [];
  for (const file of walk(join(ROOT, 'api', 'routes'), '.js')) {
    const rel = file.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/'), '').replace(/^\//, '');
    if (IDENTITY_EXEMPT.has(rel)) continue;
    const src = readText(file);
    if (!src) continue;
    for (const line of src.split(/\r?\n/)) {
      if (!/FROM subscribers/i.test(line)) continue;
      if (!/LOWER\(TRIM\(email\)\)/i.test(line)) continue;
      // firebase_uid in the same predicate means it is at least not email-only.
      if (/firebase_uid/.test(line)) continue;
      offenders.push(`${rel}: ${line.trim().slice(0, 90)}`);
    }
  }
  if (offenders.length === 0) {
    pass('client-identity guard: no route resolves the signed-in client by email alone');
  } else {
    fail(`client-identity guard: ${offenders.length} email-only subscriber lookup(s) — WhatsApp-only clients resolve to nothing there. Use lib/subscriberIdentity.js: ${offenders.join(' | ')}`);
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
if (warnings === 0) {
  console.log(`✅  All ${checks} checks passed\n`);
  process.exit(0);
} else {
  console.log(`⚠️   ${warnings} warning(s) / failure(s) out of ${checks} checks\n`);
  process.exit(1);
}
