#!/usr/bin/env node
// ── Migration Runner ─────────────────────────────────────────────────────────
// Usage:  node tools/run-migrations.mjs [--dry-run] [--from 007]
//
// • Reads api/.env for DB credentials (DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME)
// • Creates schema_migrations tracking table if not exists
// • Runs any pending .sql files from api/migrations/ in numbered order
// • Idempotent: skips already-applied migrations
// • --dry-run : print which migrations WOULD run, then exit
// • --from 007: run only migrations whose filename starts with 007 or higher
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dir  = dirname(fileURLToPath(import.meta.url));
const ROOT   = resolve(__dir, '..');
const ENV_PATH     = join(ROOT, 'api', '.env');
const MIGRATIONS   = join(ROOT, 'api', 'migrations');

// mysql2 lives in api/node_modules (not the repo root) — resolve it from there
// so the runner works when invoked from the repo root.
const apiRequire = createRequire(join(ROOT, 'api', 'package.json'));
const { createConnection } = apiRequire('mysql2/promise');

// ── Parse .env manually (no extra deps) ─────────────────────────────────────
function parseEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

// ── CLI flags ────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const dryRun  = args.includes('--dry-run');
const fromIdx = args.indexOf('--from');
const fromNum = fromIdx !== -1 ? args[fromIdx + 1] : null;

// ── Load env ─────────────────────────────────────────────────────────────────
const env = parseEnv(ENV_PATH);
const cfg = {
  host:     env.DB_HOST     || process.env.DB_HOST     || '127.0.0.1',
  port:     parseInt(env.DB_PORT || process.env.DB_PORT || '3306'),
  user:     env.DB_USER     || process.env.DB_USER,
  password: env.DB_PASSWORD || process.env.DB_PASSWORD,
  database: env.DB_NAME     || process.env.DB_NAME,
  multipleStatements: true,
  charset: 'UTF8MB4_UNICODE_CI',
};

if (!cfg.user || !cfg.database) {
  console.error('[migrations] ERROR: DB_USER and DB_NAME must be set in api/.env');
  process.exit(1);
}

// ── Discover migration files ──────────────────────────────────────────────────
const files = readdirSync(MIGRATIONS)
  .filter(f => f.endsWith('.sql'))
  .sort(); // lexicographic = numeric order (001, 002, …)

const pending = fromNum
  ? files.filter(f => f >= `${fromNum}_`)
  : files;

if (pending.length === 0) {
  console.log('[migrations] No migration files found.');
  process.exit(0);
}

// ── Connect ───────────────────────────────────────────────────────────────────
console.log(`[migrations] Connecting to ${cfg.host}:${cfg.port}/${cfg.database} as ${cfg.user}…`);
const conn = await createConnection(cfg);
await conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
await conn.query("SET FOREIGN_KEY_CHECKS = 0");

// ── Ensure tracking table ─────────────────────────────────────────────────────
await conn.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename     VARCHAR(200) PRIMARY KEY,
    applied_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    duration_ms  INT DEFAULT NULL,
    checksum     CHAR(8) DEFAULT NULL
  ) CHARACTER SET utf8mb4
`);

// ── Get already-applied ───────────────────────────────────────────────────────
const [applied] = await conn.query('SELECT filename FROM schema_migrations');
const appliedSet = new Set(applied.map(r => r.filename));

// ── Run pending ───────────────────────────────────────────────────────────────
let ran = 0;
let skipped = 0;

for (const file of pending) {
  if (appliedSet.has(file)) {
    console.log(`  ✓ skip  ${file}  (already applied)`);
    skipped++;
    continue;
  }

  const sqlPath = join(MIGRATIONS, file);
  const sql     = readFileSync(sqlPath, 'utf8');

  // Simple 8-char checksum: sum of char codes mod 0xFFFFFFFF, hex
  const checksum = [...sql].reduce((a, c) => (a + c.charCodeAt(0)) & 0xFFFFFFFF, 0)
    .toString(16).padStart(8, '0');

  if (dryRun) {
    console.log(`  ○ would run  ${file}  (${(sql.length / 1024).toFixed(1)} KB, checksum ${checksum})`);
    ran++;
    continue;
  }

  console.log(`  → running   ${file}…`);
  const t0 = Date.now();
  try {
    await conn.query(sql);
    const ms = Date.now() - t0;
    await conn.query(
      'INSERT INTO schema_migrations (filename, duration_ms, checksum) VALUES (?, ?, ?)',
      [file, ms, checksum]
    );
    console.log(`  ✓ done      ${file}  (${ms}ms)`);
    ran++;
  } catch (err) {
    console.error(`  ✗ FAILED    ${file}  — ${err.message}`);
    await conn.end();
    process.exit(2);
  }
}

await conn.query("SET FOREIGN_KEY_CHECKS = 1");
await conn.end();

// ── Summary ───────────────────────────────────────────────────────────────────
const mode = dryRun ? '[dry-run] ' : '';
console.log(`\n[migrations] ${mode}Done — ${ran} migration(s) ${dryRun ? 'pending' : 'applied'}, ${skipped} skipped.`);

if (!dryRun && ran > 0) {
  console.log('\n[migrations] Verify:');
  console.log("  mysql> SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '" + cfg.database + "';");
  console.log("  mysql> SELECT COLUMN_TYPE FROM information_schema.columns");
  console.log("         WHERE table_schema='" + cfg.database + "' AND table_name='courses' AND column_name='price_egp';");
  console.log("         -- expected: decimal(12,2)");
}
