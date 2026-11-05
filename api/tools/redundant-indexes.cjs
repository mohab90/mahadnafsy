#!/usr/bin/env node
'use strict';

/**
 * Indexes another index of the same table already covers: a non-unique index whose columns are the LEADING columns of another (or an identical twin). READ-ONLY.
 *
 *   node tools/redundant-indexes.cjs                # leads, subscribers, payments, orders
 *   node tools/redundant-indexes.cjs --table=leads
 *
 * A composite index answers a lookup on its leading column(s) alone, so the shorter one only adds a write to every insert and update. Unique indexes, the primary key
 * and full-text indexes are never listed. The result is exact (no guess about use), which is why migration 364 may drop what it lists; an index that is merely
 * unused needs tools/index-usage-report.cjs.
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
  for (const table of TABLES) {
    const [rows] = await db.query(`SHOW INDEX FROM \`${table}\``);
    const byName = new Map();
    for (const row of rows) {
      const entry = byName.get(row.Key_name) || { name: row.Key_name, unique: Number(row.Non_unique) === 0, cols: [], type: row.Index_type };
      entry.cols[row.Seq_in_index - 1] = row.Column_name + (row.Sub_part ? `(${row.Sub_part})` : '');
      byName.set(row.Key_name, entry);
    }
    const list = [...byName.values()];
    const found = [];
    for (const a of list) {
      if (a.unique || a.name === 'PRIMARY' || a.type === 'FULLTEXT') continue;
      for (const b of list) {
        if (a === b) continue;
        const prefix = a.cols.length < b.cols.length && a.cols.every((col, i) => col === b.cols[i]);
        const twin = a.cols.length === b.cols.length && a.cols.every((col, i) => col === b.cols[i]) && a.name > b.name && !b.unique;
        if (prefix || twin) { found.push({ drop: a.name, cols: a.cols.join(', '), by: b.name, byCols: twin ? 'identical' : b.cols.join(', ') }); break; }
      }
    }
    console.log(`${table}: ${list.length} indexes, ${found.length} covered by another`);
    found.forEach(entry => console.log(`  ${entry.drop} (${entry.cols})  is covered by  ${entry.by} (${entry.byCols})`));
  }
  await db.end();
})().catch(error => { console.error(error.message); process.exit(1); });
