#!/usr/bin/env node
'use strict';
// Puts back the leads the cold-lead job archived while nobody owned them.
//
//   node api/tools/restore-archived-unowned-leads.cjs [tenant-id]            ← counts only
//   node api/tools/restore-archived-unowned-leads.cjs [tenant-id] --apply    ← writes
//   add --include-imports to also restore imported «محلي/دولي قديم» rows
//
// The job archived every lead untouched for N days, whether or not it had an
// owner. A lead with no owner was not neglected — it was waiting for a desk to
// hand it out, or (the imports) existed to be handed out by hand. lib/leadAutoArchive.js
// no longer takes them; this undoes what it already did.
//
// Narrow on purpose: only leads the JOB archived (its timeline entry says
// actor «system», to «archived») — one an admin archived by hand stays archived —
// that are still visible, still without an owner, and still «archived». Each one
// goes back to «new» and gets a «restored» entry on its timeline.
require('dotenv').config();
const { pool } = require('../lib/db');
const { logLeadEventStrict } = require('../lib/crm');
const { excludeArchiveSourcesSql } = require('../lib/leadArchive');

const args = process.argv.slice(2);
const TENANT = args.find(arg => !arg.startsWith('--')) || process.env.DEFAULT_TENANT_ID || 'tenant-default';
const APPLY = args.includes('--apply');
const INCLUDE_IMPORTS = args.includes('--include-imports');
const BATCH = 500;

(async () => {
  const archive = excludeArchiveSourcesSql('l.source');
  const where = `
      l.tenant_id=? AND l.deleted_at IS NULL AND l.hidden=0 AND l.status='archived'
      AND l.assigned_sales_id IS NULL AND (l.assigned_cs_id IS NULL OR l.assigned_cs_id='')
      ${INCLUDE_IMPORTS ? '' : archive.sql}
      AND EXISTS (SELECT 1 FROM lead_timeline t
                   WHERE t.lead_id=l.id AND t.tenant_id=l.tenant_id AND t.event_type='status'
                     AND t.meta_json LIKE '%"actor":"system"%' AND t.meta_json LIKE '%"to":"archived"%')`;
  const params = [TENANT, ...(INCLUDE_IMPORTS ? [] : archive.params)];

  const [[count]] = await pool.query(`SELECT COUNT(*) AS n FROM leads l WHERE ${where}`, params);
  const [[imports]] = await pool.query(
    `SELECT COUNT(*) AS n FROM leads l
      WHERE l.tenant_id=? AND l.deleted_at IS NULL AND l.hidden=0 AND l.status='archived'
        AND l.assigned_sales_id IS NULL AND (l.assigned_cs_id IS NULL OR l.assigned_cs_id='')
        AND NOT (TRUE ${excludeArchiveSourcesSql('l.source').sql})
        AND EXISTS (SELECT 1 FROM lead_timeline t WHERE t.lead_id=l.id AND t.tenant_id=l.tenant_id AND t.event_type='status'
                     AND t.meta_json LIKE '%"actor":"system"%' AND t.meta_json LIKE '%"to":"archived"%')`,
    [TENANT, ...excludeArchiveSourcesSql('l.source').params]);
  console.log(`Archived by the job, still unowned${INCLUDE_IMPORTS ? ' (imports included)' : ''}: ${count.n}`);
  if (!INCLUDE_IMPORTS) console.log(`  not counted — imported «محلي/دولي قديم» rows: ${imports.n}  (add --include-imports to restore them too)`);
  if (!APPLY) {
    console.log('\nNothing was changed. Run again with --apply to put these leads back to «new».');
    return;
  }

  let restored = 0;
  for (;;) {
    const [rows] = await pool.query(`SELECT l.id FROM leads l WHERE ${where} ORDER BY l.created_at ASC LIMIT ?`, [...params, BATCH]);
    if (!rows.length) break;
    const ids = rows.map(row => row.id);
    const [result] = await pool.query(
      `UPDATE leads SET status='new', updated_at=NOW()
        WHERE tenant_id=? AND status='archived' AND id IN (${ids.map(() => '?').join(',')})`, [TENANT, ...ids]);
    for (const id of ids) {
      await logLeadEventStrict(id, 'restored', 'رجعت للتوزيع — اتأرشفت تلقائيًا وهي بدون مندوب',
        { from: 'archived', to: 'new', actor: 'tools/restore-archived-unowned-leads' }, TENANT).catch(() => {});
    }
    restored += result.affectedRows;
    if (result.affectedRows === 0) break; // nothing moved: do not spin
  }
  console.log(`\nRestored ${restored} lead(s) to «new». They are back in «محلي جديد» / «دولي جديد» (or the import tabs) for distribution.`);
})().catch(error => { console.error('restore-archived-unowned-leads:', error.message); process.exit(2); }).finally(() => pool.end().catch(() => {}));
