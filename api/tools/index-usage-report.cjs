#!/usr/bin/env node
'use strict';

/**
 * Which indexes of the big tables does nobody read? — from MariaDB's own counters. READ-ONLY.
 *
 *   node tools/index-usage-report.cjs                  # leads, subscribers, payments, orders
 *   node tools/index-usage-report.cjs --table=leads
 *
 * The counters (INFORMATION_SCHEMA.INDEX_STATISTICS) exist only while the server runs with userstat=ON, and start from zero each time it is switched on or restarted.
 * Switching it on is one statement by whoever runs the server — `SET GLOBAL userstat=1;` — and it costs a few percent on a busy server, so it is for a month, not for ever.
 * The leads table has forty indexes and every insert and update pays for all of them; this is the list to choose from, after a month of ordinary use including the
 * month's end (payroll, reports). An index with 0 reads after that is a candidate — and still one to drop alone, on staging first, with the slow-endpoint sweep
 * (tools/lab/sweep.cjs) before and after. Nothing is dropped by this tool.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const ONLY = (process.argv.find(arg => arg.startsWith('--table=')) || '').slice('--table='.length);
const TABLES = ONLY ? [ONLY] : ['leads', 'subscribers', 'payments', 'orders'];

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const [[flag]] = await db.query("SHOW VARIABLES LIKE 'userstat'");
  if (!flag || String(flag.Value).toUpperCase() !== 'ON') {
    console.log("userstat is OFF: the server is not counting index reads, so there is nothing to report.\nTo count for a month, whoever runs the database executes:  SET GLOBAL userstat=1;\n(add userstat=1 to the server's config to keep it across a restart; switch it off after the month.)");
    await db.end();
    return;
  }
  const [[up]] = await db.query("SHOW GLOBAL STATUS LIKE 'Uptime'");
  console.log(`server uptime ${Math.round(Number(up.Value) / 86400 * 10) / 10} days (the counters cannot cover more than that)\n`);
  for (const table of TABLES) {
    const [indexes] = await db.query(
      `SELECT s.INDEX_NAME AS name, GROUP_CONCAT(s.COLUMN_NAME ORDER BY s.SEQ_IN_INDEX) AS cols, MAX(s.NON_UNIQUE) AS non_unique, COALESCE(MAX(i.ROWS_READ), 0) AS rows_read
         FROM information_schema.STATISTICS s
         LEFT JOIN information_schema.INDEX_STATISTICS i ON i.TABLE_SCHEMA = s.TABLE_SCHEMA AND i.TABLE_NAME = s.TABLE_NAME AND i.INDEX_NAME = s.INDEX_NAME
        WHERE s.TABLE_SCHEMA = DATABASE() AND s.TABLE_NAME = ?
        GROUP BY s.INDEX_NAME ORDER BY rows_read ASC, s.INDEX_NAME`, [table]);
    const unused = indexes.filter(row => Number(row.rows_read) === 0 && row.name !== 'PRIMARY' && Number(row.non_unique) === 1);
    console.log(`${table}: ${indexes.length} indexes, ${unused.length} with no read since the counters started`);
    for (const row of indexes) console.log(`  ${String(Number(row.rows_read)).padStart(12)} rows read  ${row.name}  (${row.cols})${Number(row.non_unique) === 0 ? '  UNIQUE' : ''}`);
    console.log('');
  }
  await db.end();
})().catch(error => { console.error(error.message); process.exit(1); });
