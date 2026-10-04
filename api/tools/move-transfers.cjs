#!/usr/bin/env node
'use strict';
/**
 * Move transfers recorded on the wrong account to the right one, by operation
 * number. Report first; --apply to write. A transfer already linked to a
 * payment is moved too — the link is to the transfer, not the account name.
 *
 *   node tools/move-transfers.cjs --from "انستا باي 6046" --to "فودافون كاش 1079" --refs 111,222 [--apply]
 *
 * Before moving, it lists how the target's number is written in payments and
 * transfers already, so the move lands on the spelling in use.
 */
require('dotenv').config();
const arg = name => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : null; };
const from = arg('from'); const to = arg('to');
const refs = String(arg('refs') || '').split(',').map(r => r.trim()).filter(Boolean);
const apply = process.argv.includes('--apply');
const tenantId = arg('tenant') || process.env.DEFAULT_TENANT_ID || 'tenant-default';
if (!from || !to || !refs.length) { console.error('usage: --from "<account>" --to "<account>" --refs a,b,c [--apply]'); process.exit(2); }

(async () => {
  const { pool } = require('../lib/db');
  const digits = (to.match(/\d{3,}/g) || []).pop();
  if (digits) {
    const [names] = await pool.query(
      `SELECT method, COUNT(*) AS n FROM (
         SELECT payment_method AS method FROM payments WHERE tenant_id=? AND payment_method LIKE ?
         UNION ALL SELECT method FROM incoming_transfers WHERE tenant_id=? AND method LIKE ?) m GROUP BY method`,
      [tenantId, `%${digits}%`, tenantId, `%${digits}%`]);
    console.log(`accounts already written with ${digits}:`, names.length ? names.map(r => `«${r.method}» (${r.n})`).join(' · ') : 'none');
  }
  const [rows] = await pool.query(
    'SELECT id, reference, amount, payment_id FROM incoming_transfers WHERE tenant_id=? AND method=? AND reference IN (?)',
    [tenantId, from, refs]);
  console.log(`${rows.length} of ${refs.length} operation number(s) found on «${from}»`);
  const missing = refs.filter(ref => !rows.some(row => row.reference === ref));
  if (missing.length) console.log('  not found:', missing.join(', '));
  if (!apply) { console.log('Nothing changed — run again with --apply.'); await pool.end(); return; }
  const [result] = await pool.query(
    'UPDATE incoming_transfers SET method=? WHERE tenant_id=? AND method=? AND reference IN (?)', [to, tenantId, from, refs]);
  console.log(`moved ${result.affectedRows} to «${to}»`);
  await pool.end();
})().catch(error => { console.error(error.message); process.exit(1); });
