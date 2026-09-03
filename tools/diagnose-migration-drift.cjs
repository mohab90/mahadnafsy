// Read-only. migrate:verify reports 35 applied migrations whose checksum no
// longer matches the file, while all 80 structural checks pass — so the schema
// is right and it is the record that has drifted. This says which of the two
// possible causes it is, because they need opposite responses:
//
//   - The file on the server differs from the file in the repository. Then the
//     server is running something that was never reviewed.
//   - Both are identical and the recorded checksum predates a change in how the
//     checksum is computed. Then nothing is wrong with the schema and the
//     record needs re-stamping, not the database.
require('dotenv').config({ path: '/var/www/mahad-api/.env' });
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

const MIGRATIONS = '/var/www/mahad-api/migrations';

// Exactly as api/lib/migrationRunner.js computes it.
const checksumOf = sql =>
  crypto.createHash('sha256').update(String(sql).replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [rows] = await db.query(
    'SELECT version, checksum, status, applied_at FROM schema_migrations ORDER BY version');

  const matched = [];
  const mismatched = [];
  const absent = [];

  for (const row of rows) {
    const file = path.join(MIGRATIONS, row.version);
    if (!fs.existsSync(file)) { absent.push(row.version); continue; }
    const raw = fs.readFileSync(file, 'utf8');
    const actual = checksumOf(raw);
    if (actual === row.checksum) { matched.push(row.version); continue; }
    mismatched.push({
      version: row.version,
      recorded: row.checksum,
      actual,
      appliedAt: row.applied_at,
      bytes: Buffer.byteLength(raw),
      // If the raw bytes hash to the recorded value, the record predates the
      // CRLF normalisation rather than the file having been edited.
      rawUnnormalised: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16) === row.checksum,
    });
  }

  console.log(`recorded migrations : ${rows.length}`);
  console.log(`checksum matches    : ${matched.length}`);
  console.log(`checksum mismatches : ${mismatched.length}`);
  console.log(`file not on disk    : ${absent.length}${absent.length ? ' -> ' + absent.join(', ') : ''}`);

  const preNormalisation = mismatched.filter(m => m.rawUnnormalised);
  console.log(`\nof the mismatches, ${preNormalisation.length} match the file's raw bytes,`);
  console.log('i.e. they were stamped before the CRLF normalisation and the file is unchanged.');

  if (mismatched.length) {
    console.log('\nfirst 8 mismatches:');
    for (const m of mismatched.slice(0, 8)) {
      console.log(`  ${m.version}`);
      console.log(`    recorded ${m.recorded}  actual ${m.actual}  ${m.bytes} bytes  applied ${String(m.appliedAt).slice(0, 19)}`);
      console.log(`    raw bytes match recorded: ${m.rawUnnormalised}`);
    }
  }

  // Emit the versions so they can be compared against the repository copies.
  fs.writeFileSync('/tmp/mismatched-migrations.txt',
    mismatched.map(m => m.version).join('\n') + '\n');
  console.log('\nversions written to /tmp/mismatched-migrations.txt');

  await db.end();
})().catch(error => { console.error('ERR', error.message); process.exit(1); });
