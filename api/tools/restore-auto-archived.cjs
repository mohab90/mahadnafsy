#!/usr/bin/env node
'use strict';
/**
 * Put back on the leads table the recent leads the auto-archive took off it.
 *
 *   node tools/restore-auto-archived.cjs              # report only (leads from the last 14 days)
 *   node tools/restore-auto-archived.cjs --apply
 *   … --days 30                                      # a wider window
 *
 * Only leads the job archived (their timeline holds its «أُرشف تلقائياً» entry,
 * actor system) and that nobody has touched since: still 'archived', visible,
 * not deleted. Each goes back to 'new' — the job does not record which opening
 * status it had, and all four it archives from are opening statuses — keeps its
 * rep, and gets a 'restored' entry in its timeline. That entry is also what
 * keeps the job off it for the next autoArchiveDays, so the lead has a full
 * period in front of its rep before it can be archived again.
 *
 * On 4 October 2026 the 14-day sheet report found 298 recent leads archived this
 * way: in the CRM, but off the table — «في عملاء كتير مش بتظهر».
 */
require('dotenv').config();
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const days = Math.max(1, Number(arg('days', 14)) || 14);
const apply = process.argv.includes('--apply');
const tenantId = arg('tenant', process.env.DEFAULT_TENANT_ID || 'tenant-default');

(async () => {
  const { pool } = require('../lib/db');
  const { logLeadEventStrict } = require('../lib/crm');
  const [rows] = await pool.query(
    `SELECT l.id, l.name, l.phone, l.assigned_sales_name, l.created_at
       FROM leads l
      WHERE l.tenant_id = ? AND l.status = 'archived' AND l.hidden = 0 AND l.deleted_at IS NULL
        AND l.created_at >= NOW() - INTERVAL ? DAY
        AND EXISTS (SELECT 1 FROM lead_timeline t
                     WHERE t.tenant_id = l.tenant_id AND t.lead_id = l.id AND t.event_type = 'status'
                       AND t.description LIKE 'أُرشف تلقائياً%')
      ORDER BY l.created_at DESC`, [tenantId, days]);
  const byRep = rows.reduce((map, r) => map.set(r.assigned_sales_name || 'بدون مندوب', (map.get(r.assigned_sales_name || 'بدون مندوب') || 0) + 1), new Map());
  console.log(`${rows.length} lead(s) from the last ${days} days archived by the job`);
  for (const [rep, n] of [...byRep].sort((a, b) => b[1] - a[1])) console.log(`  ${rep}: ${n}`);
  if (!apply) { console.log('\nNothing changed — run again with --apply.'); await pool.end(); return; }
  let restored = 0;
  for (const row of rows) {
    const [result] = await pool.query(
      "UPDATE leads SET status='new', updated_at=updated_at WHERE tenant_id=? AND id=? AND status='archived'", [tenantId, row.id]);
    if (!result.affectedRows) continue;
    await logLeadEventStrict(row.id, 'restored', 'أُعيد من الأرشيف التلقائي إلى قائمة العمل',
      { from: 'archived', to: 'new', actor: 'restore-auto-archived' }, tenantId);
    restored++;
  }
  console.log(`\nrestored ${restored}`);
  await pool.end();
})().catch(error => { console.error(error.message); process.exit(1); });
