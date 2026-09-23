'use strict';
/**
 * Reconcile the recorded checksums for migrations 144-178.
 *
 * Why these are wrong: production was migrated from a different copy of these
 * files than the one in git. Every one of them has exactly one commit
 * (89cb282 "large platform expansion from parallel session"), so the files were
 * never edited afterwards - the version that actually ran on production simply
 * no longer exists anywhere.
 *
 * Why not re-run them instead: eight of the 35 carry 18 data statements,
 * including credit-note and financial-document backfills. Re-running would
 * double-apply those and corrupt accounting data.
 *
 * Why re-recording is safe here: the live schema was checked against every
 * structural object these files declare - 26 tables, 69 columns, 41 indexes -
 * and all 136 are present. The schema matches the files; only the stored
 * checksum drifted. This restores the drift-detection invariant going forward.
 *
 * Only rows in the 144-178 range whose status is already 'applied' are touched,
 * and each change is printed.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('../lib/db');

const DIR = path.join(__dirname, '..', 'migrations');
const FROM = 144, TO = 178;
const APPLY = process.argv.includes('--apply');
const sum = f => crypto.createHash('sha256').update(fs.readFileSync(f, 'utf8')).digest('hex').slice(0, 16);

(async () => {
  const [rows] = await pool.query('SELECT version, checksum, status FROM schema_migrations');
  const byVersion = new Map(rows.map(r => [String(r.version), r]));
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.sql'))
    .filter(f => { const n = parseInt(f, 10); return n >= FROM && n <= TO; }).sort();

  let changed = 0, skipped = 0;
  for (const f of files) {
    const row = byVersion.get(f);
    if (!row) { console.log(`  SKIP ${f} - no row`); skipped++; continue; }
    if (row.status !== 'applied') { console.log(`  SKIP ${f} - status=${row.status}`); skipped++; continue; }
    const fresh = sum(path.join(DIR, f));
    if (row.checksum === fresh) { skipped++; continue; }
    console.log(`  ${APPLY ? 'FIX ' : 'WOULD FIX'} ${f}  ${row.checksum} -> ${fresh}`);
    if (APPLY) {
      await pool.query('UPDATE schema_migrations SET checksum=? WHERE version=? AND status=?', [fresh, f, 'applied']);
    }
    changed++;
  }
  console.log(`\n${APPLY ? 'updated' : 'would update'}: ${changed}   unchanged/skipped: ${skipped}`);
  if (!APPLY) console.log('dry run - pass --apply to write');
  await pool.end().catch(() => {});
})().catch(async e => { console.error('ERR', e.message); await pool.end().catch(() => {}); process.exit(1); });
