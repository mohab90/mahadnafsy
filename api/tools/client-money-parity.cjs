#!/usr/bin/env node
'use strict';

/**
 * READ-ONLY. Every client (or the first --limit) where the rule the screens draw (lib/clientItems.js, GET /api/admin/clients/:id/money) and the SQL balance the receipts,
 * instalments and collections read (lib/agreedPrice.js itemBalances) differ by a piastre — see lib/moneyParity.js.
 *
 *   node tools/client-money-parity.cjs [--tenant=<id>] [--limit=5000]
 *
 * Writes nothing. About 4 ms a client: 30,000 clients take two minutes. Reads api/.env — point it at the database you mean to read.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { compareClientMoney } = require('../lib/moneyParity');

const arg = name => (process.argv.find(value => value.startsWith(`--${name}=`)) || '').split('=')[1] || '';

async function main() {
  const db = await mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    const tenant = arg('tenant');
    const [rows] = await db.query(
      `SELECT tenant_id, id FROM subscribers WHERE deleted_at IS NULL ${tenant ? 'AND tenant_id = ?' : ''} ORDER BY tenant_id, id LIMIT ${Number(arg('limit')) || 5000}`, tenant ? [tenant] : []);
    let differing = 0;
    for (const row of rows) {
      const lines = await compareClientMoney(db, { tenantId: row.tenant_id, subscriberIds: [row.id] });
      if (lines.length) { differing += 1; lines.forEach(line => console.log(`${row.tenant_id} ${line}`)); }
    }
    console.log(`${rows.length} clients compared, ${differing} differ. nothing was written.`);
  } finally { await db.end(); }
}
main().catch(error => { console.error(error.message); process.exit(1); });
