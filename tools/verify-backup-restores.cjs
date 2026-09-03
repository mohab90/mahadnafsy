// Restore the newest backup file into a throwaway database and check it came
// back whole.
//
// api/tools/backup-restore-rehearsal.cjs takes a *fresh* dump and restores
// that, which proves the dump-and-restore mechanism works. It does not prove
// that the files sitting in /var/backups/mahad-db restore — and those are what
// the business would actually reach for. Nobody had opened one: the screen
// that reports on them was pointed at an empty directory, so "we have backups"
// rested on the files existing and nothing more.
//
// Never touches the source database. The restore target is created here, is
// named with a fixed prefix, and is dropped in a finally — and the drop refuses
// any name not carrying that prefix, so a mistake in this file cannot become a
// dropped production database.
//
//   node tools/verify-backup-restores.cjs
require('dotenv').config({ path: '/var/www/mahad-api/.env' });
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const mysql = require('mysql2/promise');

const BACKUP_DIR = process.env.MAHAD_BACKUP_DIR || '/var/backups/mahad-db';
const SOURCE_DB = process.env.DB_NAME || 'mahadnafsy_db';
const PREFIX = 'mahad_restore_check_';
const TARGET = `${PREFIX}${process.pid}`;

const CORE_TABLES = [
  'tenants', 'users', 'staff', 'leads', 'subscribers', 'courses',
  'enrollments', 'payments', 'journal_entries', 'community_posts',
];

const sql = (db, statement) =>
  execFileSync('mysql', ['-u', 'root', '-N', '-B', ...(db ? [db] : []), '-e', statement],
    { encoding: 'utf8' }).trim();

function dropTarget() {
  // The guard that makes the rest of this file safe to be wrong.
  if (!TARGET.startsWith(PREFIX) || TARGET === SOURCE_DB) {
    console.error(`REFUSING to drop ${TARGET}`);
    process.exit(1);
  }
  try { sql(null, `DROP DATABASE IF EXISTS \`${TARGET}\``); } catch (error) {
    console.error('could not drop the rehearsal database:', error.message);
  }
}

(async () => {
  const archives = fs.readdirSync(BACKUP_DIR)
    .filter(name => name.endsWith('.sql.gz'))
    .map(name => ({ name, stat: fs.statSync(path.join(BACKUP_DIR, name)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  if (!archives.length) { console.error('no backup archives found in', BACKUP_DIR); process.exit(1); }

  const newest = archives[0];
  const archive = path.join(BACKUP_DIR, newest.name);
  console.log(`archive : ${newest.name}`);
  console.log(`size    : ${(newest.stat.size / 1048576).toFixed(1)} MB, written ${newest.stat.mtime.toISOString()}`);
  console.log(`target  : ${TARGET} (dropped when this finishes)\n`);

  let restored = false;
  try {
    sql(null, `CREATE DATABASE \`${TARGET}\` CHARACTER SET utf8mb4`);

    const started = Date.now();
    // zcat | mysql, so the whole dump never has to be held in memory.
    const restore = spawnSync('bash', ['-c',
      `set -o pipefail; zcat ${JSON.stringify(archive)} | mysql -u root ${TARGET}`],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (restore.status !== 0) {
      console.error('RESTORE FAILED:', (restore.stderr || '').slice(-800));
      process.exitCode = 1;
      return;
    }
    restored = true;
    console.log(`restored in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

    const liveTables = Number(sql(null,
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${SOURCE_DB}'`));
    const restoredTables = Number(sql(null,
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${TARGET}'`));
    console.log(`tables  : ${restoredTables} restored, ${liveTables} live`);

    console.log('\nrow counts (restored vs live — live may be ahead, it kept running):');
    let worstDrift = 0;
    let empty = [];
    for (const table of CORE_TABLES) {
      let there = 0, here = 0;
      try { there = Number(sql(TARGET, `SELECT COUNT(*) FROM \`${table}\``)); } catch { there = -1; }
      try { here = Number(sql(SOURCE_DB, `SELECT COUNT(*) FROM \`${table}\``)); } catch { here = -1; }
      const drift = here > 0 ? Math.abs(here - there) / here : 0;
      worstDrift = Math.max(worstDrift, drift);
      if (there === 0 && here > 0) empty.push(table);
      console.log(`  ${table.padEnd(18)} ${String(there).padStart(7)}  vs ${String(here).padStart(7)}`);
    }

    console.log('');
    if (restoredTables < liveTables * 0.95) {
      console.log(`FAIL: the restore is missing tables (${restoredTables} of ${liveTables})`);
      process.exitCode = 1;
    } else if (empty.length) {
      console.log(`FAIL: restored but empty where live has rows: ${empty.join(', ')}`);
      process.exitCode = 1;
    } else if (worstDrift > 0.1) {
      console.log(`FAIL: a core table differs by more than 10% — that is more than a day of writes`);
      process.exitCode = 1;
    } else {
      console.log('PASS: the newest backup restores to a complete, populated database.');
    }
  } finally {
    if (restored || true) dropTarget();
    const still = sql(null,
      `SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name LIKE '${PREFIX}%'`);
    console.log(`rehearsal databases left behind: ${still}`);
  }
})().catch(error => { console.error('ERR', error.message); dropTarget(); process.exit(1); });
