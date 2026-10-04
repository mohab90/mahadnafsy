#!/usr/bin/env node
'use strict';
/**
 * Bring in every lead from the linked Google Sheets of the last N days that the
 * CRM does not hold, and say where the ones it does hold are.
 *
 *   node tools/sheets-backfill.cjs                # report only (default 14 days)
 *   node tools/sheets-backfill.cjs --days 14 --apply
 *   node tools/sheets-backfill.cjs --all --apply  # every row, whatever its date
 *   node tools/sheets-backfill.cjs --all --sheet "اسم الشيت"   # one sheet only (name, sheet id or gid)
 *   node tools/sheets-backfill.cjs --list         # the saved sheets, and which are ticked for auto sync
 *
 * Report per sheet tab:
 *   rows        rows in the tab
 *   in window   rows dated within the window (undated rows always count)
 *   new         not in the CRM at all — what --apply imports, distributed like
 *               any synced lead
 *   visible     already on the leads table
 *   unassigned  in the CRM but with no rep (محلي جديد — every rep at a cap)
 *   archived    in the CRM but archived (the auto-archive job, crm_settings.
 *               autoArchiveDays, archives owned leads nobody contacted)
 *   hidden      deleted by someone (never re-imported: «شيتات بتترجع بعد المسح»)
 *   merged      folded into another lead as a duplicate
 *
 * Uses the same importer as the 15-minute sync (lib/sheets.js).
 */
require('dotenv').config();
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const days = process.argv.includes('--all') ? null : Number(arg('days', 14));
const apply = process.argv.includes('--apply');
const tenantId = arg('tenant', process.env.DEFAULT_TENANT_ID || 'tenant-default');

(async () => {
  const { syncAllConfiguredSheets } = require('../lib/sheets');
  const { pool } = require('../lib/db');
  if (process.argv.includes('--list')) {
    const { getTenantSetting } = require('../lib/tenantSettings');
    const settings = await getTenantSetting('crm_settings', { tenantId, fallback: {} });
    for (const sheet of settings?.sheets || []) {
      console.log(`${sheet.autoSync === false ? '☐ not ticked' : '☑ auto sync '} · ${sheet.name || '—'} · ${sheet.sheetId} · gid ${sheet.gid || '—'}`);
    }
    await pool.end();
    return;
  }
  const only = arg('sheet', '');
  const report = await syncAllConfiguredSheets(tenantId, { windowDays: days, dryRun: !apply, only });
  if (only && !report.sheets.length) console.log(`no saved sheet matches «${only}» — see --list`);
  console.log(`${apply ? 'IMPORTED' : 'REPORT (nothing written — add --apply)'} · tenant ${tenantId} · window ${days ? `${days} days` : 'all rows'}\n`);
  for (const sheet of report.sheets) {
    const e = sheet.existing;
    console.log(`• ${sheet.name}${sheet.gid ? ` (gid ${sheet.gid})` : ''}${sheet.error ? `  ✗ ${sheet.error}` : ''}${sheet.dated ? '' : '  [no date column — every row counted]'}`);
    console.log(`    rows ${sheet.rows} · in window ${sheet.inWindow} · older ${sheet.outsideWindow}`);
    console.log(`    new ${sheet.imported} · visible ${e.visible} · unassigned ${e.unassigned} · archived ${e.archived} · hidden ${e.hidden} · merged ${e.merged}`);
    for (const row of sheet.importedRows.slice(0, 50)) {
      console.log(`      + ${row.name} · ${row.phone || '—'}${row.arrivedAt ? ` · ${row.arrivedAt.toISOString().slice(0, 16).replace('T', ' ')}` : ''}`);
    }
    if (sheet.importedRows.length > 50) console.log(`      … and ${sheet.importedRows.length - 50} more`);
  }
  const total = report.sheets.reduce((sum, s) => sum + s.imported, 0);
  const archived = report.sheets.reduce((sum, s) => sum + s.existing.archived, 0);
  console.log(`\n${apply ? 'imported' : 'would import'}: ${total}${archived ? ` · ${archived} already in the CRM but archived (see the archive tab, or set crm_settings.autoArchiveDays)` : ''}`);
  await pool.end();
})().catch(error => { console.error(error); process.exit(1); });
