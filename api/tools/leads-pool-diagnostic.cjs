#!/usr/bin/env node
'use strict';
// Read-only. Where did the new leads go?
//
// Run on the server:  node api/tools/leads-pool-diagnostic.cjs [tenant-id]
//
// «محلي جديد» lists only the live waiting pool: visible, no sales rep, no
// collection officer, not an imported archive, not in a final status, and not
// international. A lead can be missing from it for any of those reasons and the
// tab says nothing. This puts every lead in the first bucket that applies, in the
// order the screen applies them, so «the count is too low» becomes a list of
// numbers with a reason each.
require('dotenv').config();
const { pool } = require('../lib/db');
const { ARCHIVE_SOURCE_PREFIXES } = require('../lib/leadArchive');
const { TERMINAL_LEAD_STATUSES } = require('../lib/leadStatuses');

const TENANT = process.argv[2] || process.env.DEFAULT_TENANT_ID || 'tenant-default';
const terminal = [...TERMINAL_LEAD_STATUSES];
const archiveLike = ARCHIVE_SOURCE_PREFIXES.map(() => `TRIM(COALESCE(source,'')) LIKE ?`).join(' OR ');
const archiveParams = ARCHIVE_SOURCE_PREFIXES.map(prefix => `${prefix}%`);
const intl = `(UPPER(REPLACE(REPLACE(COALESCE(branch,''),'-','_'),' ','_')) IN ('ONLINE_ABROAD','ONLINE_SAUDI') OR TRIM(COALESCE(source,'')) LIKE 'دولي%')`;
const noOwner = `assigned_sales_id IS NULL AND (assigned_cs_id IS NULL OR assigned_cs_id='')`;
const live = `tenant_id=? AND deleted_at IS NULL`;

(async () => {
  const one = async (sql, params = []) => (await pool.query(sql, params))[0];

  const [[totals]] = await pool.query(
    `SELECT COUNT(*) AS all_rows,
            SUM(hidden=1) AS hidden_rows,
            SUM(hidden=0) AS visible_rows,
            SUM(hidden=0 AND ${noOwner}) AS visible_without_owner
       FROM leads WHERE ${live}`, [TENANT]);
  console.log('Leads in the database (not deleted):', JSON.stringify(totals));

  const [[buckets]] = await pool.query(
    `SELECT
       SUM(${archiveLike}) AS imported_archive,
       SUM(NOT (${archiveLike}) AND LOWER(status) IN (${terminal.map(() => '?').join(',')})) AS final_status,
       SUM(NOT (${archiveLike}) AND LOWER(status) NOT IN (${terminal.map(() => '?').join(',')}) AND ${intl}) AS dawli_new,
       SUM(NOT (${archiveLike}) AND LOWER(status) NOT IN (${terminal.map(() => '?').join(',')}) AND NOT ${intl}) AS local_new
       FROM leads WHERE ${live} AND hidden=0 AND ${noOwner}`,
    [...archiveParams, ...archiveParams, ...terminal, ...archiveParams, ...terminal,
      ...archiveParams, ...terminal, TENANT]);
  console.log('\nVisible leads with no owner, by where they appear:');
  console.log(`  «محلي جديد»  (the waiting pool)        : ${buckets.local_new || 0}`);
  console.log(`  «دولي جديد»                            : ${buckets.dawli_new || 0}`);
  console.log(`  imported archive («… قديم»/«استيراد»)  : ${buckets.imported_archive || 0}`);
  console.log(`  final status (never distributed)       : ${buckets.final_status || 0}`);

  const byStatus = await one(
    `SELECT LOWER(status) AS status, COUNT(*) AS n FROM leads
      WHERE ${live} AND hidden=0 AND ${noOwner} AND NOT (${archiveLike})
        AND LOWER(status) IN (${terminal.map(() => '?').join(',')})
      GROUP BY LOWER(status) ORDER BY n DESC`, [TENANT, ...archiveParams, ...terminal]);
  if (byStatus.length) {
    console.log('\n  final-status rows with no owner, by status:');
    byStatus.forEach(row => console.log(`    ${row.status}: ${row.n}`));
  }

  // The job that turns cold unowned leads into «archived» — off unless the owner
  // set a number of days.
  try {
    const [[setting]] = await pool.query(
      `SELECT config_json FROM tenant_settings WHERE tenant_id=? AND section='crm_settings' LIMIT 1`, [TENANT]);
    // A JSON column comes back from the driver already parsed; a text one does not.
    const raw = setting ? setting.config_json : null;
    const cfg = !raw ? {} : (typeof raw === 'string' ? JSON.parse(raw) : raw);
    console.log(`\nAuto-archive of cold leads (crm_settings.autoArchiveDays): ${Number(cfg.autoArchiveDays) > 0 ? `ON — ${cfg.autoArchiveDays} days` : 'off'}`);
  } catch (error) {
    console.log('\nAuto-archive setting: could not read —', error.message);
  }
  const [[arch]] = await pool.query(
    `SELECT COUNT(*) AS n FROM leads WHERE ${live} AND hidden=0 AND status='archived'`, [TENANT]);
  console.log(`Leads with status «archived» (any owner): ${arch.n}`);

  const [[archivedSplit]] = await pool.query(
    `SELECT SUM(assigned_sales_id IS NOT NULL) AS with_rep,
            SUM(assigned_sales_id IS NULL) AS without_rep,
            SUM(NOT EXISTS (SELECT 1 FROM communications c WHERE c.lead_id=leads.id)) AS never_contacted
       FROM leads WHERE ${live} AND hidden=0 AND status='archived'`, [TENANT]);
  console.log(`  of those: with a rep ${archivedSplit.with_rep || 0}, without ${archivedSplit.without_rep || 0}, never contacted ${archivedSplit.never_contacted || 0}`);

  const byStatusAll = await one(
    `SELECT LOWER(status) AS status, COUNT(*) AS n FROM leads WHERE ${live} AND hidden=0
      GROUP BY LOWER(status) ORDER BY n DESC LIMIT 12`, [TENANT]);
  console.log('\nAll visible leads by status:');
  byStatusAll.forEach(row => console.log(`  ${String(row.n).padStart(6)}  ${row.status}`));

  const ages = await one(
    `SELECT CASE WHEN created_at >= CURDATE() THEN '1 today'
                 WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN '2 1-7 days'
                 WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN '3 8-30 days'
                 ELSE '4 older than 30 days' END AS bucket, COUNT(*) AS n
       FROM leads WHERE ${live} AND hidden=0 AND ${noOwner} AND NOT (${archiveLike})
        AND LOWER(status) NOT IN (${terminal.map(() => '?').join(',')})
      GROUP BY bucket ORDER BY bucket`, [TENANT, ...archiveParams, ...terminal]);
  console.log('\nWaiting pool (no owner, live status, not an import) by age:');
  ages.forEach(row => console.log(`  ${row.bucket.slice(2).padEnd(22)} ${row.n}`));

  // Why a new lead is not handed out: the reps and their limits, as the capture
  // path reads them (lib/leadAssignment.js listDistributableReps).
  try {
    const { listDistributableReps } = require('../lib/leadAssignment');
    const { intakeByStaff } = require('../lib/assignmentQuota');
    const eligible = new Set((await listDistributableReps(TENANT, pool)).map(rep => String(rep.id)));
    const [staff] = await pool.query(
      `SELECT s.id, s.name, p.branch_key, p.is_available, p.max_open_leads, p.intake_limit, p.intake_period,
              p.course_ids_json, p.sources_json
         FROM staff s LEFT JOIN crm_assignment_members p
           ON p.tenant_id=s.tenant_id AND p.staff_id=s.id AND p.team_key='sales'
        WHERE s.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL AND UPPER(s.role)='SALES'
        ORDER BY s.name`, [TENANT]);
    const [open] = await pool.query(
      `SELECT assigned_sales_id AS id, COUNT(*) AS n FROM leads
        WHERE tenant_id=? AND hidden=0 AND status NOT IN ('converted','lost','archived','disqualified')
          AND assigned_sales_id IS NOT NULL GROUP BY assigned_sales_id`, [TENANT]);
    const openBy = new Map(open.map(row => [String(row.id), Number(row.n)]));
    const quota = await intakeByStaff(TENANT, staff.filter(r => r.intake_limit != null)
      .map(r => ({ staff_id: r.id, intake_period: r.intake_period })), pool);
    console.log(`\nSales reps (${eligible.size} of ${new Set(staff.map(r => r.id)).size} can take a new lead right now):`);
    for (const r of staff) {
      const takes = eligible.has(String(r.id));
      const why = r.branch_key == null ? 'no row on the «التوزيع» screen'
        : !r.is_available ? 'switched off'
        : (r.max_open_leads != null && (openBy.get(String(r.id)) || 0) >= r.max_open_leads) ? 'at the open-leads cap'
        : (r.intake_limit != null && (quota.get(String(r.id)) || 0) >= r.intake_limit) ? 'intake limit reached'
        : (r.course_ids_json || r.sources_json) ? 'rules limit which leads (course/source)' : '';
      console.log(`  ${takes ? 'YES' : ' no'}  ${String(r.name).padEnd(24)} branch=${r.branch_key ?? '-'} open=${openBy.get(String(r.id)) || 0}${r.max_open_leads != null ? '/' + r.max_open_leads : ''}`
        + `  intake=${quota.get(String(r.id)) || 0}${r.intake_limit != null ? '/' + r.intake_limit + ' per ' + r.intake_period : ''}${why ? '  ← ' + why : ''}`);
    }
  } catch (error) {
    console.log('\nSales reps: could not read —', error.message);
  }

  // The rule at capture time is per lead — its branch, its source, its courses —
  // so «a rep has room» is not the same as «this lead can be handed to them».
  // Each distinct kind of waiting lead is asked the question the capture path asks.
  try {
    const { listDistributableReps } = require('../lib/leadAssignment');
    const [waiting] = await pool.query(
      `SELECT branch, source, interested_course_ids_json AS courses FROM leads
        WHERE ${live} AND hidden=0 AND ${noOwner} AND NOT (${archiveLike})
          AND LOWER(status) NOT IN (${terminal.map(() => '?').join(',')})`,
      [TENANT, ...archiveParams, ...terminal]);
    const kinds = new Map();
    for (const lead of waiting) {
      let courseIds = [];
      try { courseIds = JSON.parse(lead.courses || '[]') || []; } catch { courseIds = []; }
      const key = JSON.stringify([lead.branch || '', lead.source || '', courseIds.slice().sort()]);
      const entry = kinds.get(key) || { branch: lead.branch || '(none)', source: lead.source || '(none)', courseIds, n: 0 };
      entry.n += 1; kinds.set(key, entry);
    }
    console.log('\nWaiting leads — how many reps could take each kind right now (0 = the capture path finds nobody):');
    const rows = [];
    for (const entry of kinds.values()) {
      const reps = await listDistributableReps(TENANT, pool, {
        branch: entry.branch === '(none)' ? undefined : entry.branch,
        lead: { source: entry.source === '(none)' ? '' : entry.source, courseIds: entry.courseIds },
      });
      rows.push({ ...entry, reps: reps.length });
    }
    rows.sort((a, b) => a.reps - b.reps || b.n - a.n).slice(0, 25).forEach(row => console.log(
      `  ${String(row.n).padStart(4)} leads  reps=${row.reps}  branch=${row.branch}  source=${row.source}${row.courseIds.length ? '  courses=' + row.courseIds.length : ''}`));
  } catch (error) {
    console.log('\nWaiting leads per kind: could not read —', error.message);
  }

  console.log('\nNew leads per day, last 14 days — and what became of them:');
  const perDay = await one(
    `SELECT DATE(created_at) AS day, COUNT(*) AS created,
            SUM(hidden=1) AS hidden_now,
            SUM(hidden=0 AND assigned_sales_id IS NOT NULL) AS with_rep,
            SUM(hidden=0 AND ${noOwner} AND LOWER(status) IN (${terminal.map(() => '?').join(',')})) AS unowned_final,
            SUM(hidden=0 AND ${noOwner} AND LOWER(status) NOT IN (${terminal.map(() => '?').join(',')})) AS unowned_waiting
       FROM leads WHERE ${live} AND created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
      GROUP BY DATE(created_at) ORDER BY day DESC`, [...terminal, ...terminal, TENANT]);
  console.log('  day         created  with-rep  unowned-waiting  unowned-final  hidden');
  perDay.forEach(row => console.log(
    `  ${String(row.day instanceof Date ? row.day.toISOString().slice(0, 10) : row.day).padEnd(11)} ${String(row.created).padStart(7)} ${String(row.with_rep || 0).padStart(9)} ${String(row.unowned_waiting || 0).padStart(16)} ${String(row.unowned_final || 0).padStart(14)} ${String(row.hidden_now || 0).padStart(7)}`));

  const bySource = await one(
    `SELECT COALESCE(NULLIF(TRIM(source),''),'(بدون مصدر)') AS source, COUNT(*) AS n FROM leads
      WHERE ${live} AND hidden=0 AND ${noOwner} AND LOWER(status) NOT IN (${terminal.map(() => '?').join(',')})
      GROUP BY 1 ORDER BY n DESC LIMIT 12`, [TENANT, ...terminal]);
  console.log('\nWaiting pool by source (top 12):');
  bySource.forEach(row => console.log(`  ${row.n}\t${row.source}`));

  await pool.end().catch(() => {});
})().catch(error => { console.error('leads-pool-diagnostic:', error.message); process.exit(2); });
