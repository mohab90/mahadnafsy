'use strict';
/**
 * Audit regression suite (read-only: it never modifies or boots application code).
 *
 * Run: node --test tests/auditRegression.test.js     (or: npm run test:unit)
 *
 * Part 1 — STRICT. Every relative require() in the API must resolve to a real
 *          file, with the exact letter case (Windows hides case bugs that Linux
 *          production does not). This is the test that would have caught
 *          CRIT-01: routes/auth/*.js required '../lib/lifecycle', a path that
 *          does not exist, and 72% of the existing tests only read code as text.
 *
 * Part 2 — GUARDS. Each defect of the 7 Oct 2026 audit, fixed on 7–8 Oct, kept
 *          from coming back. They began as `todo` checks written against the
 *          old code; they point at where each fix lives now. The behaviour of
 *          each fix is tested by running it, in the test named beside it.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(API_ROOT, '..');
const SKIP_DIRS = new Set(['node_modules', 'tests', 'uploads', 'docs', '.img-cache', '.uat-logs', 'migrations']);
const CODE_EXT = new Set(['.js', '.cjs', '.mjs']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (CODE_EXT.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** True only when `file` exists AND its on-disk name matches the requested case. */
function isFileExactCase(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  return fs.readdirSync(path.dirname(file)).includes(path.basename(file));
}

function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base, `${base}.js`, `${base}.json`, `${base}.cjs`, `${base}.mjs`, `${base}.node`,
    path.join(base, 'index.js'), path.join(base, 'index.json'),
  ];
  if (candidates.some(isFileExactCase)) return true;
  // A directory with a package.json "main" is also resolvable.
  const pkg = path.join(base, 'package.json');
  return isFileExactCase(pkg);
}

const REQUIRE_RE = /\brequire\(\s*(['"])(\.{1,2}\/[^'"\n$]*)\1\s*\)/g;

function findUnresolvedRequires(files) {
  const problems = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      for (const m of line.matchAll(REQUIRE_RE)) {
        if (!resolveRelative(file, m[2])) {
          problems.push(`${path.relative(REPO_ROOT, file)}:${i + 1}  require('${m[2]}')`);
        }
      }
    });
  }
  return problems;
}

function read(...parts) {
  return fs.readFileSync(path.join(REPO_ROOT, ...parts), 'utf8');
}
/** Source of `file` from the first occurrence of `from` up to (excluding) `to`. */
function region(src, from, to) {
  const start = src.indexOf(from);
  assert.ok(start >= 0, `anchor not found: ${from}`);
  const end = to ? src.indexOf(to, start + from.length) : -1;
  return src.slice(start, end > start ? end : undefined);
}

// ───────────────────────── Part 1: strict ─────────────────────────
describe('module graph integrity', () => {
  const files = [...walk(API_ROOT), ...walk(path.join(REPO_ROOT, 'ws-server'))];

  test('the scan actually sees the codebase (guards against a silently empty scan)', () => {
    assert.ok(files.length > 300, `expected >300 source files, scanned ${files.length}`);
    assert.ok(files.some(f => f.endsWith(path.join('routes', 'auth', 'registration.js'))));
  });

  test('every relative require() resolves to a real file with exact case (CRIT-01)', () => {
    const problems = findUnresolvedRequires(files);
    assert.deepEqual(problems, [], `Unresolvable require() calls:\n  ${problems.join('\n  ')}`);
  });

  test('resolver self-check: detects a deliberately wrong path', () => {
    const registration = path.join(API_ROOT, 'routes', 'auth', 'registration.js');
    assert.equal(resolveRelative(registration, '../../lib/lifecycle'), true);
    assert.equal(resolveRelative(registration, '../lib/lifecycle'), false);
    assert.equal(resolveRelative(registration, '../../lib/LifeCycle'), false, 'case mismatch must fail');
  });
});

// ───────────────────────── Part 2: guards ─────────────────────────
describe('the 7 Oct 2026 audit stays fixed', () => {
  test('HIGH-08 / MED-30: ws-server has no fallback secret, pins HS256 and never broadcasts (theRealtimeServerTellsOnlyItsOwn)', () => {
    const server = read('ws-server', 'server.js');
    assert.doesNotMatch(server, /fallback_secret_key/);
    assert.match(server, /algorithms\s*:\s*\[\s*['"]HS256['"]\s*\]/);
    assert.doesNotMatch(server, /io\.emit\(/);
    assert.doesNotMatch(server, /origin:\s*process\.env\.WS_CORS_ORIGIN\s*\|\|\s*'\*'/);
  });

  test('CRIT-02: both signup routes run the one handler, which adds the lead (aWebsiteSignupReachesTheDesk)', () => {
    const src = read('api', 'routes', 'auth', 'registration.js');
    assert.match(src, /router\.post\('\/api\/auth\/register',[^\n]*, signup\);/);
    assert.match(src, /router\.post\('\/api\/user\/signup',[^\n]*, signup\);/);
    assert.match(region(src, 'async function signup(', '\n}\n'), /ensureLeadForUser\(/);
  });

  test('CRIT-03: checkout-intent keeps the payment mode, and a receipt grants by plan (anInstalmentIsNotAFullPayment)', () => {
    const notes = region(read('api', 'routes', 'lead-capture-crm.js'), 'const notes = JSON.stringify(', 'await conn.query(');
    assert.match(notes, /payMode/);
    assert.doesNotMatch(read('api', 'routes', 'payment-proofs.js'), /accessType:\s*'full'/);
  });

  test('CRIT-04: a course is paid at one share everywhere (aCourseIsPaidAtTheSameShareEverywhere)', () => {
    assert.match(read('api', 'lib', 'coursePaid.js'), /const PAID_SHARE = 0\.9;/);
    assert.match(read('api', 'lib', 'autoCertificate.js'), /const PAID_THRESHOLD = PAID_SHARE;/);
  });

  test('HIGH-05: checkout-intent never writes over an existing lead\'s crm_json', () => {
    const intent = region(read('api', 'routes', 'lead-capture-crm.js'), "router.post('/api/public/checkout-intent'", '\n});\n');
    assert.doesNotMatch(intent, /crm_json\s*=\s*VALUES\(crm_json\)/);
  });

  test('HIGH-06: a payer with an email still finds a lead known by the number (aPayerFindsTheirLeadByNumber)', () => {
    const src = read('api', 'lib', 'subscriberProvisioning.js');
    assert.match(region(src, 'if (!lead) {', '\n  }\n'), /findLeadByContact\(conn, \{ tenantId, phone \}\)/);
  });

  test('HIGH-07: the site shows the server\'s Arabic refusal instead of «تعذر إنشاء الحساب»', () => {
    assert.match(read('client', 'pages', 'Enrollment.tsx'), /authAr\[msg\] \|\| \(\/\[ء-ي\]\/\.test\(msg\) \? msg :/);
  });

  test('HIGH-09: every promo-code query is the tenant\'s (aPromoCodeIsOneTenants)', () => {
    const src = read('api', 'routes', 'promo-codes.js');
    const queries = src.match(/pool\.query\(/g) || [];
    assert.ok(queries.length > 0);
    assert.ok((src.match(/tenant_id/g) || []).length >= queries.length);
  });

  test('MED-10: a connection that arrives after the timeout is handed back', () => {
    const src = read('api', 'lib', 'db.js');
    assert.match(region(src, 'const pending = _origGetConn();', '\n};\n'), /pending\.then\(late => late\.release\(\)/);
  });

  test('MED-11: a lost connection repeats reads only (aLostConnectionRepeatsOnlyReads)', () => {
    const src = read('api', 'lib', 'db.js');
    const handler = region(src, 'pool.query = async', 'pool.execute = async');
    assert.match(handler, /RETRYABLE\.has\(err\.code\) && _isRead\(sql\)/);
  });

  test('MED-12: cross-site writes are refused unless switched off explicitly', () => {
    assert.match(read('api', 'lib', 'httpApp.js'), /CSRF_ORIGIN_ENFORCE \|\| ''\)\.toLowerCase\(\) === 'false'/);
  });

  test('MED-13: /api/staff writes reach the activity log (staffWritesReachTheActivityLog)', () => {
    assert.match(read('api', 'lib', 'httpApp.js'), /app\.use\('\/api\/staff', auditWrites\);/);
  });

  test('MED-18: requireAdminOrStaff asks the owner for MFA (theOwnerAnswersTheMfaPolicyEverywhere)', () => {
    const src = read('api', 'middleware', 'auth.js');
    const start = src.indexOf('async function requireAdminOrStaff');
    assert.ok(start >= 0, 'requireAdminOrStaff not found');
    assert.match(src.slice(start, src.indexOf('\n}\n', start)), /enforceMfa\(req, res, null, \[\], true\)/);
  });

  test('LOW-19: there is no self check-in', () => {
    assert.doesNotMatch(read('api', 'routes', 'hr', 'attendance.js'), /'\/api\/me\/hr\/attendance\//);
  });

  test('LOW-22: the site carries no admin API client', () => {
    assert.doesNotMatch(read('client', 'lib', 'mysqlapi.ts'), /export const mysqlAdmin\b/);
  });

  test('LOW-23: signup hands its connection back only when it has one', () => {
    const src = read('api', 'routes', 'auth', 'registration.js');
    assert.match(region(src, 'async function signup(', '\n}\n'), /finally\s*\{\s*if\s*\(conn\)\s*conn\.release\(\)/);
  });

  // Six migrations share three numbers (198–200, from the v25 and v26 lines).
  // Each is recorded by its whole file name and all six ran, so they are safe
  // where they are — renaming one would run it again. No new number is shared.
  test('LOW-21: no migration number is shared, beyond the six that already ran', () => {
    const RAN = new Set(['198', '199', '200']);
    const seen = new Map();
    const dups = [];
    for (const name of fs.readdirSync(path.join(API_ROOT, 'migrations')).filter(f => /^\d+_/.test(f)).sort()) {
      const n = name.match(/^(\d+)_/)[1];
      if (seen.has(n) && !RAN.has(n)) dups.push(`${seen.get(n)}  <->  ${name}`);
      else seen.set(n, name);
    }
    assert.deepEqual(dups, []);
  });
});

