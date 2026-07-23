#!/usr/bin/env node
/**
 * migration-drift-scan.mjs
 *
 * Static guard against the exact bug class documented in
 * api/migrations/033_tenant_default_alignment.sql: migration 011 created
 * `tenant_id ... DEFAULT 'mahad'`; migration 028 tried to change the default
 * to 'tenant-default' using `ADD COLUMN IF NOT EXISTS` — which is a no-op
 * once the column already exists, so the wrong default silently survived and
 * a real customer's lead vanished from its own list in production
 * (2026-07-10) before 033 caught it with a proper `MODIFY COLUMN`.
 *
 * This scans every migration file in filename (numeric) order and tracks,
 * per (table, column), the DEFAULT value last actually APPLIED by either
 * `ADD COLUMN` (first creation) or `MODIFY COLUMN` (an update that really
 * takes effect). Whenever a later `ADD COLUMN IF NOT EXISTS` declares a
 * DIFFERENT default for a column that was already created earlier, that's
 * the drift bug: the statement compiles and runs but changes nothing.
 *
 * Usage: node tools/migration-drift-scan.mjs [--list]
 * Wired into tools/mahad-quality-check.mjs as check #15.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const MIGRATIONS_DIR = join(ROOT, 'api/migrations');

function numericPrefix(filename) {
  const m = filename.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : Infinity;
}

// Matches: ALTER TABLE <table> ADD COLUMN [IF NOT EXISTS] <col> ... DEFAULT <value>
// and:     ALTER TABLE <table> MODIFY COLUMN <col> ... DEFAULT <value>
const ALTER_RE = /ALTER TABLE\s+(?:IF EXISTS\s+)?`?([a-zA-Z0-9_]+)`?\s+(ADD|MODIFY)\s+(?:COLUMN\s+)?(IF NOT EXISTS\s+)?`?([a-zA-Z0-9_]+)`?[^,;]*?DEFAULT\s+('[^']*'|"[^"]*"|[A-Za-z0-9_.]+)/gi;

export function scanMigrationDrift() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort((a, b) => numericPrefix(a) - numericPrefix(b));

  // key: "table.column" -> { default, appliedIn }
  const applied = new Map();
  const allViolations = []; // every no-op ADD COLUMN IF NOT EXISTS found, in file order
  const resolvedKeys = new Set(); // keys later fixed by a real MODIFY COLUMN

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    let m;
    ALTER_RE.lastIndex = 0;
    while ((m = ALTER_RE.exec(sql))) {
      const [, table, verb, ifNotExists, column, defaultValue] = m;
      const key = `${table}.${column}`;
      const isAddIfNotExists = verb.toUpperCase() === 'ADD' && !!ifNotExists;
      const prev = applied.get(key);

      if (verb.toUpperCase() === 'MODIFY') {
        // MODIFY always actually applies. If this key had an earlier no-op
        // violation, this is the migration that caught and corrected it.
        applied.set(key, { default: defaultValue, appliedIn: file });
        resolvedKeys.add(key);
        continue;
      }

      if (isAddIfNotExists && prev && prev.default !== defaultValue) {
        // This ADD COLUMN IF NOT EXISTS is a silent no-op: the column
        // already exists (created in prev.appliedIn) with a different
        // default, and IF NOT EXISTS means this statement changes nothing.
        allViolations.push({
          table, column,
          declaredIn: file, declaredDefault: defaultValue,
          actualDefaultFrom: prev.appliedIn, actualDefault: prev.default,
        });
        continue; // do not update `applied` — the no-op didn't change reality
      }

      // Plain ADD COLUMN (no IF NOT EXISTS) or first-time ADD COLUMN IF NOT
      // EXISTS for a column not seen before — this is what actually created
      // the column, so its default is the one in effect.
      if (!prev || !isAddIfNotExists) {
        applied.set(key, { default: defaultValue, appliedIn: file });
      }
    }
  }

  // Only violations NEVER later corrected by a real MODIFY COLUMN are live —
  // e.g. the 011→028 drift is resolved because 033 issued MODIFY COLUMN for
  // every affected table. A resolved violation is a documented incident, not
  // a standing bug — see api/migrations/033_tenant_default_alignment.sql.
  const unresolved = allViolations.filter(v => !resolvedKeys.has(`${v.table}.${v.column}`));
  return { allViolations, unresolved };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').replace(/^([A-Z]):/i, ''));
if (isMain) {
  const { allViolations, unresolved } = scanMigrationDrift();
  if (process.argv.includes('--list')) {
    for (const v of allViolations) {
      const isResolved = !unresolved.includes(v);
      console.log(`${v.table}.${v.column}: ${v.declaredIn} declares DEFAULT ${v.declaredDefault} via ADD COLUMN IF NOT EXISTS,`);
      console.log(`  but the column already exists (created in ${v.actualDefaultFrom} with DEFAULT ${v.actualDefault}) — this statement is a silent no-op.`);
      console.log(`  ${isResolved ? '✓ later corrected by a MODIFY COLUMN' : '✗ STILL UNRESOLVED — no later MODIFY COLUMN fixes this'}\n`);
    }
  }
  console.log(`Migration drift — total historical no-ops found: ${allViolations.length}, still unresolved: ${unresolved.length}`);
}
