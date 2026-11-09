#!/usr/bin/env node
'use strict';

/**
 * Holds the collection employees' monthly sheet (one tab per employee, a row per payment collected) against the system (9 Nov 2026): is every payment of the
 * sheet in the system, and under the same employee?
 *
 *   node tools/reconcile-collection-sheet.cjs "<sheet>.xlsx" --month=2026-10 [--out=report.json] [--tenant=<id>]
 *
 * READ-ONLY: it only SELECTs (a connection set read-only, so even a mistake could not write). Run it on the server, where the production database is, from
 * /var/www/mahad-api (the .env there holds the connection). It prints the Arabic report; --out also writes the full result as JSON, with a printable
 * <name>.md and an Excel-ready <name>.csv next to it. The sheet and the report hold real names, phones and amounts: keep them off the repository.
 *
 * What it does (lib/collectionSheetReconcile.js): every row is found in the system by the client's phone (or the name) and held against that client's paid payments
 * within ±3 days of the row's date for the same amount — found under the same employee / under another / of another type (certificate ↔ course) / with another
 * amount or date / not in the system / the client not registered — then each collector's payments of the month that the tab lacks, and the totals per collector.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = name => { const hit = args.find(arg => arg.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : null; };
const file = args.find(arg => !arg.startsWith('--'));
const month = flag('month');
if (!file || !month) {
  console.error('usage: node tools/reconcile-collection-sheet.cjs "<sheet>.xlsx" --month=2026-10 [--out=report.json] [--tenant=<id>]');
  process.exit(2);
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const { readCollectionSheet } = require('../lib/collectionSheet');
  const { monthOf } = require('../lib/salesSheet');
  const { reconcileCollectionSheet } = require('../lib/collectionSheetReconcile');
  const { renderMarkdown, renderCsv } = require('../lib/collectionSheetReport');
  const { pool } = require('../lib/db');
  const { year, month: monthNumber } = monthOf(month);
  const sheet = readCollectionSheet(fs.readFileSync(path.resolve(file)), { month });

  const conn = await pool.getConnection();
  try {
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    const tenantId = flag('tenant') || process.env.DEFAULT_TENANT_ID || 'tenant-default';
    const report = await reconcileCollectionSheet(conn, { tenantId, sheet, year, month: monthNumber });
    const markdown = renderMarkdown(report);
    const out = flag('out');
    if (out) {
      const base = path.resolve(out).replace(/\.json$/i, '');
      fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
      fs.writeFileSync(`${base}.md`, markdown);
      fs.writeFileSync(`${base}.csv`, renderCsv(report));
      console.error(`written: ${base}.json  ${base}.md  ${base}.csv`);
    }
    console.log(markdown);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
