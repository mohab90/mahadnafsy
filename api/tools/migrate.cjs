#!/usr/bin/env node
'use strict';
// Standalone migration CLI: `node tools/migrate.cjs` (or `npm run migrate`).
// Runs pending numbered migrations, prints a summary, exits non-zero if any failed.
require('dotenv').config();
const { pool } = require('../lib/db');
const { runMigrations } = require('../lib/migrationRunner');

(async () => {
  try {
    const r = await runMigrations(pool);
    console.log(`[migrate] baseline=${r.baseline} applied=${r.applied} failed=${r.failed} unavailable=${Boolean(r.unavailable)}`);
    await pool.end().catch(() => {});
    process.exit(r.failed > 0 || r.unavailable ? 1 : 0);
  } catch (e) {
    console.error('[migrate] fatal:', e.message);
    process.exit(1);
  }
})();
