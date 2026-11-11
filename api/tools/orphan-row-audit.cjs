'use strict';
// Orphan-row audit: READ-ONLY.
//
// The schema declares only a minority of its references as FOREIGN KEYs; the rest
// (refunds.payment_id, orders.subscriber_id, installment_entries.plan_id ...) are
// kept consistent by application code alone, so the database will happily accept a
// row that points at nothing. Before any of them can become a constraint, someone
// has to know whether production already holds such rows - a FOREIGN KEY cannot be
// added over existing orphans. This tool counts them, relation by relation.
//
// It only ever issues SELECT / SHOW statements (assertReadOnly refuses anything
// else, and the session is put in READ ONLY mode), and it will not start unless the
// DB_* variables are in the environment - it deliberately does not read a .env, so
// it can never pick up a stale or production login by accident.
//
//   DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=... DB_PASSWORD=... DB_NAME=... \
//     node tools/orphan-row-audit.cjs [--tier 1] [--json] [--only refunds.payment_id]
//   node tools/orphan-row-audit.cjs --emit-sql [--tier 1]   (no database needed)
//
// Exit code: 0 = no orphans anywhere, 1 = orphans found, 2 = could not run.

const SEPARATOR = '>';

// "child_table.child_column>parent_table" - the parent key is always its `id`.
// Tier 1: money (payments, orders, installments, refunds, journals, payroll).
// Tier 2: enrolments and access.   Tier 3: everything else that is clearly a reference.
const TIER1 = [
  'accounts_payable_invoices.approval_journal_id>journal_entries',
  'accounts_payable_payments.journal_entry_id>journal_entries',
  'checkout_reminders.order_id>orders',
  'client_item_money.subscriber_id>subscribers',
  'crm_commissions.staff_id>staff',
  'crm_commissions.payment_id>payments',
  'crm_commissions.rule_id>commission_rules',
  'crm_commissions.payroll_run_id>payroll_runs',
  'installment_entries.payment_id>payments',
  'installment_entries.subscriber_id>subscribers',
  'installment_plans.subscriber_id>subscribers',
  'installment_plans.payment_id>payments',
  'installment_plans.course_id>courses',
  'installment_plans.bundle_id>bundles',
  'instructor_fees.staff_id>staff',
  'instructor_fees.course_id>courses',
  'instructor_fees.source_payment_id>payments',
  'instructor_fees.payroll_run_id>payroll_runs',
  'orders.subscriber_id>subscribers',
  'orders.course_id>courses',
  'orders.bundle_id>bundles',
  'orders.staff_id>staff',
  'payment_attempts.proof_id>payment_proofs',
  'payment_attempts.payment_id>payments',
  'payment_intents.subscriber_id>subscribers',
  'payment_intents.payment_id>payments',
  'payment_links.subscriber_id>subscribers',
  'payment_proofs.order_id>orders',
  'payment_proofs.payment_attempt_id>payment_attempts',
  'payment_proofs.course_id>courses',
  'payment_proofs.bundle_id>bundles',
  'payments.staff_id>staff',
  'paymob_order_links.order_id>orders',
  'payroll_items.payroll_run_id>payroll_runs',
  'payroll_items.staff_id>staff',
  'refund_requests.subscriber_id>subscribers',
  'refund_requests.payment_id>payments',
  'refunds.payment_id>payments',
  'refunds.subscriber_id>subscribers',
  'salary_advances.staff_id>staff',
  'salary_advances.journal_entry_id>journal_entries',
  'box_withdrawals.journal_entry_id>journal_entries',
  'incoming_transfers.payment_id>payments',
  'subscriber_requests.payment_id>payments',
  'bonus_adjustments.payment_id>payments',
  'orders.linked_transfer_id>incoming_transfers',
  'payments.linked_transfer_id>incoming_transfers',
  'installment_entries.plan_id>installment_plans',
  'salary_advances.deducted_payroll_run_id>payroll_runs',
];

const TIER2 = [
  'classroom_bookings.classroom_id>physical_classrooms',
  'classroom_bookings.course_id>courses',
  'classroom_bookings.staff_id>staff',
  'consultations.slot_id>therapist_slots',
  'consultations.assigned_staff_id>staff',
  'consultations.branch_id>branches',
  'consultations.order_id>orders',
  'course_ratings.course_id>courses',
  'course_ratings.subscriber_id>subscribers',
  'course_waitlist.course_id>courses',
  'course_waitlist.subscriber_id>subscribers',
  'daqqi_attendance_events.round_id>daqqi_rounds',
  'daqqi_attendance_events.subscriber_id>subscribers',
  'daqqi_waitlist.course_id>courses',
  'enrollments.branch_id>branches',
  'entitlement_events.subscriber_id>subscribers',
  'entitlement_events.course_id>courses',
  'lecture_completions.course_id>courses',
  'lecture_progress.subscriber_id>subscribers',
  'lecture_progress.course_id>courses',
  'live_sessions.course_id>courses',
  'loyalty_ledger.subscriber_id>subscribers',
  'physical_checkins.subscriber_id>subscribers',
  'physical_checkins.branch_id>branches',
  'referral_codes.subscriber_id>subscribers',
  'subscriber_subscriptions.subscriber_id>subscribers',
  'subscriber_course_branches.subscriber_id>subscribers',
  'subscriptions.subscriber_id>subscribers',
  'subscriptions.course_id>courses',
  'subscriptions.bundle_id>bundles',
  'consultation_ratings.consultation_id>consultations',
  'consultation_ratings.therapist_id>therapists',
  'consultation_reschedules.consultation_id>consultations',
  'consultation_reschedules.new_slot_id>therapist_slots',
  'client_ratings.subscriber_id>subscribers',
  'client_ratings.round_id>daqqi_rounds',
  'client_ratings.course_id>courses',
  'client_ratings.created_by_id>staff',
  'live_stream_attendance.stream_id>live_streams',
  'live_stream_attendance.subscriber_id>subscribers',
  'online_presence.course_id>courses',
];

const TIER3 = [
  'accounts_payable_invoices.branch_id>branches',
  'attendance_logs.staff_id>staff',
  'attendance_logs.leave_id>leaves',
  'automation_log.workflow_id>automation_workflows',
  'automation_log.lead_id>leads',
  'automation_log.subscriber_id>subscribers',
  'bank_reconciliations.branch_id>branches',
  'budgets.branch_id>branches',
  'cash_flow_forecast_assumptions.branch_id>branches',
  'commission_rules.staff_id>staff',
  'communications.staff_id>staff',
  'communications.channel_id>messaging_channels',
  'communications.thread_id>inbox_threads',
  'community_post_comments.subscriber_id>subscribers',
  'community_post_likes.subscriber_id>subscribers',
  'community_posts.subscriber_id>subscribers',
  'contact_messages.branch_id>branches',
  'contact_messages.converted_ticket_id>support_tickets',
  'courses.instructor_id>staff',
  'crm_coaching_reviews.staff_id>staff',
  'crm_coaching_reviews.reviewer_id>staff',
  'crm_commissions.branch_id>branches',
  'crm_forecast_submissions.staff_id>staff',
  'crm_quotes.lead_id>leads',
  'crm_quotes.subscriber_id>subscribers',
  'daqqi_rounds.instructor_id>staff',
  'disciplinary_records.staff_id>staff',
  'drip_enrollments.lead_id>leads',
  'drip_enrollments.subscriber_id>subscribers',
  'email_sequence_queue.step_id>email_sequence_steps',
  'email_verifications.user_id>users',
  'employee_bonuses.staff_id>staff',
  'employee_documents.staff_id>staff',
  'enps_responses.staff_id>staff',
  'expenses.staff_id>staff',
  'expenses.branch_id>branches',
  'financial_documents.branch_id>branches',
  'forum_posts.course_id>courses',
  'forum_upvotes.subscriber_id>subscribers',
  'hr_departments.manager_id>staff',
  'inbox_notes.thread_id>inbox_threads',
  'inbox_notes.staff_id>staff',
  'inbox_threads.channel_id>messaging_channels',
  'inbox_threads.lead_id>leads',
  'inbox_threads.subscriber_id>subscribers',
  'inbox_threads.assigned_staff_id>staff',
  'inbox_conversations.assigned_to_staff_id>staff',
  'inbox_conversations.linked_lead_id>leads',
  'inbox_conversations.linked_subscriber_id>subscribers',
  'instructor_fees.daqqi_round_id>daqqi_rounds',
  'instructor_rate_change_requests.staff_id>staff',
  'instructor_rates.staff_id>staff',
  'inventory_items.branch_id>branches',
  'job_applicants.hired_staff_id>staff',
  'job_postings.department_id>hr_departments',
  'join_us_applications.branch_id>branches',
  'journal_entries.branch_id>branches',
  'kpi_actuals.staff_id>staff',
  'kpi_targets.staff_id>staff',
  'lead_timeline.lead_id>leads',
  'leads.enrolled_course_id>courses',
  'leads.assigned_sales_id>staff',
  'leads.assigned_cs_id>staff',
  'leads.branch_id>branches',
  'leads.merged_into_lead_id>leads',
  'leaves.staff_id>staff',
  'live_streams.instructor_id>staff',
  'login_history.user_id>users',
  'message_outbox.channel_id>messaging_channels',
  'notification_reads.notification_id>notifications',
  'notifications.subscriber_id>subscribers',
  'notifications.recipient_staff_id>staff',
  'nps_responses.subscriber_id>subscribers',
  'nps_responses.payment_id>payments',
  'nps_responses.branch_id>branches',
  'orders.branch_id>branches',
  'otp_codes.user_id>users',
  'payment_links.branch_id>branches',
  'payment_proofs.reviewer_id>staff',
  'payment_proofs.first_reviewer_id>staff',
  'payment_proofs.branch_id>branches',
  'payments.branch_id>branches',
  'payroll_items.branch_id>branches',
  'payroll_runs.branch_id>branches',
  'performance_appraisals.staff_id>staff',
  'performance_appraisals.reviewer_id>staff',
  'physical_classrooms.branch_id>branches',
  'privacy_requests.subscriber_id>subscribers',
  'push_subscriptions.subscriber_id>subscribers',
  'push_subscriptions.staff_id>staff',
  'recurring_expenses.branch_id>branches',
  'staff_documents.staff_id>staff',
  'refund_requests.branch_id>branches',
  'refund_requests.blamed_staff_id>staff',
  'refund_requests.ticket_id>support_tickets',
  'salary_structures.staff_id>staff',
  'sales_targets.staff_id>staff',
  'staff.branch_id>branches',
  'staff.department_id>hr_departments',
  'staff.manager_id>staff',
  'staff_absences.staff_id>staff',
  'staff_announcement_seen.staff_id>staff',
  'staff_messages.staff_id>staff',
  'staff_messages.author_staff_id>staff',
  'staff_offboarding.staff_id>staff',
  'staff_resignations.staff_id>staff',
  'ticket_chat_presence.ticket_id>support_tickets',
  'subscribers.lead_id>leads',
  'subscribers.assigned_sales_id>staff',
  'subscribers.assigned_cs_id>staff',
  'subscribers.branch_id>branches',
  'support_messages.ticket_id>support_tickets',
  'support_tickets.assigned_to_id>staff',
  'support_tickets.branch_id>branches',
  'support_tickets.refund_request_id>refund_requests',
  'tasks.related_sub_id>subscribers',
  'tasks.related_lead_id>leads',
  'therapist_blocked_dates.therapist_id>therapists',
  'therapists.staff_id>staff',
  'ticket_events.ticket_id>support_tickets',
  'user_mfa_recovery_codes.user_id>users',
  'user_sessions.user_id>users',
  'wa_web_chats.staff_id>staff',
  'wa_web_chats.lead_id>leads',
  'wa_web_chats.subscriber_id>subscribers',
  'wa_web_messages.staff_id>staff',
  'wa_web_scheduled.staff_id>staff',
  'wa_web_sessions.staff_id>staff',
  'whatsapp_campaign_recipients.outbox_id>message_outbox',
  'whatsapp_campaigns.channel_id>messaging_channels',
  'work_schedules.staff_id>staff',
  'community_event_registrations.event_id>community_events',
  'customer_devices.user_id>users',
  'subscriber_requests.lead_id>leads',
  'subscriber_requests.subscriber_id>subscribers',
  'login_email_codes.user_id>users',
  'bonus_adjustments.staff_id>staff',
];

// Tables with no tenant_id column, so a cross-tenant comparison is meaningless there.
const TENANTLESS_TABLES = new Set(['therapist_slots', 'lecture_progress', 'kpi_actuals', 'support_messages']);
// Tables whose rows are soft-deleted (deleted_at). A soft-deleted PARENT is still a
// row, so it satisfies a foreign key; a soft-deleted CHILD still blocks one, which is
// why the audit reports both the total and the live-only count.
const SOFT_DELETE_TABLES = new Set([
  'orders', 'subscribers', 'staff', 'payments', 'courses', 'bundles', 'refund_requests', 'consultations',
  'client_ratings', 'leads', 'support_tickets', 'employee_documents', 'expenses', 'recurring_expenses',
]);

const IDENT = /^[A-Za-z0-9_]+$/;
const q = (name) => {
  if (!IDENT.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return `\`${name}\``;
};

function parseCandidate(spec, tier) {
  const [left, parent] = spec.split(SEPARATOR);
  const [table, column] = left.split('.');
  if (!table || !column || !parent) throw new Error(`bad candidate: ${spec}`);
  return {
    key: left, spec, tier, table, column, parent, parentColumn: 'id',
    tenant: !TENANTLESS_TABLES.has(table) && !TENANTLESS_TABLES.has(parent),
    softDelete: SOFT_DELETE_TABLES.has(table),
  };
}

const CANDIDATES = [
  ...TIER1.map(s => parseCandidate(s, 1)),
  ...TIER2.map(s => parseCandidate(s, 2)),
  ...TIER3.map(s => parseCandidate(s, 3)),
];

// Counting query for one relation. Pure: no database, no I/O. Parent ids are unique,
// so the LEFT JOIN cannot fan out and COUNT(*) is the number of child rows.
//   references   child rows whose reference is not NULL
//   orphans      of those, rows whose parent id does not exist (a '' counts: an FK rejects it)
//   blank        the subset of orphans that hold an empty string rather than NULL
//   live_orphans orphans among child rows that are not soft-deleted (if the child soft-deletes)
//   cross_tenant parent exists but under another tenant (an FK on id alone cannot see this)
function buildOrphanQuery(rel) {
  const c = q(rel.table), p = q(rel.parent), col = q(rel.column), pk = q(rel.parentColumn);
  const parts = [
    'COUNT(*) AS `references`',
    `COALESCE(SUM(p.${pk} IS NULL), 0) AS orphans`,
    `COALESCE(SUM(p.${pk} IS NULL AND c.${col} = ''), 0) AS blank`,
    rel.softDelete
      ? `COALESCE(SUM(p.${pk} IS NULL AND c.\`deleted_at\` IS NULL), 0) AS live_orphans`
      : 'NULL AS live_orphans',
    rel.tenant
      ? `COALESCE(SUM(p.${pk} IS NOT NULL AND p.\`tenant_id\` <> c.\`tenant_id\`), 0) AS cross_tenant`
      : 'NULL AS cross_tenant',
  ];
  return `SELECT ${parts.join(', ')} FROM ${c} c LEFT JOIN ${p} p ON p.${pk} = c.${col} WHERE c.${col} IS NOT NULL`;
}

// Up to `limit` example orphan ids, for relations the counting query flagged.
function buildSampleQuery(rel, limit = 5) {
  const c = q(rel.table), p = q(rel.parent), col = q(rel.column), pk = q(rel.parentColumn);
  const n = Math.max(1, Math.min(20, Number(limit) || 5));
  return `SELECT DISTINCT c.${col} AS ref_value FROM ${c} c LEFT JOIN ${p} p ON p.${pk} = c.${col} `
    + `WHERE c.${col} IS NOT NULL AND p.${pk} IS NULL LIMIT ${n}`;
}

// Type/collation of both sides, from information_schema. An FK needs the same base
// type and the same character set and collation on both columns.
function buildCompatQuery(rel) {
  return 'SELECT table_name AS t, column_name AS c, column_type AS column_type, '
    + 'character_set_name AS charset, collation_name AS collation '
    + 'FROM information_schema.columns WHERE table_schema = DATABASE() AND '
    + `((table_name = '${q(rel.table).slice(1, -1)}' AND column_name = '${q(rel.column).slice(1, -1)}') OR `
    + `(table_name = '${q(rel.parent).slice(1, -1)}' AND column_name = '${q(rel.parentColumn).slice(1, -1)}'))`;
}

// Decide from two information_schema rows whether an FK could be created.
function compareColumnTypes(child, parent) {
  if (!child || !parent) return { ok: false, reason: 'column or parent table not found' };
  const base = (t) => String(t).toLowerCase().replace(/\(.*\)/, '').trim();
  if (base(child.column_type) !== base(parent.column_type)) {
    return { ok: false, reason: `type ${child.column_type} vs ${parent.column_type}` };
  }
  if ((child.charset || null) !== (parent.charset || null)) {
    return { ok: false, reason: `charset ${child.charset} vs ${parent.charset}` };
  }
  if ((child.collation || null) !== (parent.collation || null)) {
    return { ok: false, reason: `collation ${child.collation} vs ${parent.collation}` };
  }
  return { ok: true, reason: '' };
}

// The statement the owner applies, per relation, once the audit shows zero orphans.
// RESTRICT: a parent with children cannot be deleted. Never CASCADE on a financial row.
function buildAddForeignKeySql(rel) {
  const name = `fk_${rel.table}_${rel.column}`.slice(0, 64);
  // No explicit index: InnoDB reuses an existing index that starts with the column and
  // creates one itself when there is none, so a second one is never added by hand.
  return `ALTER TABLE ${q(rel.table)}\n`
    + `  ADD CONSTRAINT ${q(name)} FOREIGN KEY (${q(rel.column)}) REFERENCES ${q(rel.parent)} (${q(rel.parentColumn)})\n`
    + '  ON DELETE RESTRICT ON UPDATE RESTRICT;';
}

// The audit must never write. Every statement the runner sends passes through here.
function assertReadOnly(sql) {
  const text = String(sql).trim().replace(/;+\s*$/, '');
  if (text.includes(';')) throw new Error('refusing a multi-statement query');
  if (!/^(SELECT|SHOW|SET\s+SESSION\s+TRANSACTION\s+READ\s+ONLY)\b/i.test(text)) {
    throw new Error(`refusing a non-SELECT statement: ${text.slice(0, 40)}`);
  }
  if (/\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE|GRANT|RENAME|CALL|LOCK|OUTFILE|DUMPFILE)\b/i.test(text)) {
    throw new Error(`refusing a statement with a write keyword: ${text.slice(0, 40)}`);
  }
  return text;
}

// Every DB_* variable must be set explicitly (DB_PASSWORD may be empty but must exist).
function requireDbEnv(env) {
  const missing = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME'].filter(k => !env[k]);
  if (env.DB_PASSWORD === undefined) missing.push('DB_PASSWORD');
  if (missing.length) {
    throw new Error(`refusing to run without explicit database settings; missing: ${missing.join(', ')}`);
  }
  return {
    host: env.DB_HOST, port: parseInt(env.DB_PORT, 10), user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME,
  };
}

function selectCandidates({ tier = null, only = null } = {}) {
  return CANDIDATES.filter(r => (tier == null || r.tier <= tier) && (!only || only.includes(r.key)));
}

function summarize(results) {
  const withOrphans = results.filter(r => r.orphans > 0);
  return {
    relations: results.length,
    with_orphans: withOrphans.length,
    orphan_rows: withOrphans.reduce((n, r) => n + r.orphans, 0),
    cross_tenant_rows: results.reduce((n, r) => n + (r.cross_tenant || 0), 0),
    incompatible_types: results.filter(r => r.compat && !r.compat.ok).length,
    skipped: results.filter(r => r.skipped).length,
    ready_for_fk: results.filter(r => !r.skipped && r.orphans === 0 && r.compat && r.compat.ok).map(r => r.spec),
  };
}

function parseArgs(argv) {
  const out = { tier: null, json: false, emitSql: false, only: null, samples: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--emit-sql') out.emitSql = true;
    else if (a === '--no-samples') out.samples = false;
    else if (a === '--tier') out.tier = parseInt(argv[++i], 10);
    else if (a === '--only') out.only = String(argv[++i]).split(',');
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function emitSql(rels) {
  return rels.map(r => `-- ${r.spec}\n${buildAddForeignKeySql(r)}`).join('\n\n') + '\n';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rels = selectCandidates({ tier: args.tier, only: args.only });
  if (args.emitSql) { process.stdout.write(emitSql(rels)); return 0; }

  let conf;
  try { conf = requireDbEnv(process.env); } catch (e) { console.error(e.message); return 2; }
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({ ...conf, connectTimeout: 20000 });
  const run = async (sql) => { const [rows] = await conn.query(assertReadOnly(sql)); return rows; };
  const results = [];
  try {
    await run('SET SESSION TRANSACTION READ ONLY');
    console.error(`[orphan-audit] ${conf.user}@${conf.host}:${conf.port}/${conf.database} - ${rels.length} relation(s), SELECT only`);
    const have = new Set((await run('SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE()'))
      .map(r => `${r.t}.${r.c}`.toLowerCase()));
    const existing = await run(
      'SELECT table_name AS t, column_name AS c FROM information_schema.key_column_usage '
      + 'WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL');
    const constrained = new Set(existing.map(r => `${r.t}.${r.c}`.toLowerCase()));
    for (const rel of rels) {
      const row = { ...rel };
      if (!have.has(`${rel.table}.${rel.column}`) || !have.has(`${rel.parent}.${rel.parentColumn}`)) {
        results.push({ ...row, skipped: 'table or column absent in this database', references: 0, orphans: 0 });
        continue;
      }
      if (constrained.has(`${rel.table}.${rel.column}`)) {
        results.push({ ...row, skipped: 'already has a foreign key', references: 0, orphans: 0 });
        continue;
      }
      const compat = await run(buildCompatQuery(rel));
      const side = (t, c) => compat.find(x => x.t.toLowerCase() === t && x.c.toLowerCase() === c);
      row.compat = compareColumnTypes(side(rel.table, rel.column), side(rel.parent, rel.parentColumn));
      const [counts] = await run(buildOrphanQuery(rel));
      row.references = Number(counts.references);
      row.orphans = Number(counts.orphans);
      row.blank = Number(counts.blank);
      row.live_orphans = counts.live_orphans == null ? null : Number(counts.live_orphans);
      row.cross_tenant = counts.cross_tenant == null ? null : Number(counts.cross_tenant);
      if (row.orphans > 0 && args.samples) {
        row.samples = (await run(buildSampleQuery(rel))).map(r => r.ref_value);
      }
      results.push(row);
    }
  } finally {
    await conn.end().catch(() => {});
  }

  const summary = summarize(results);
  if (!args.json) {
    console.log('tier relation'.padEnd(58) + 'refs'.padStart(10) + 'orphans'.padStart(9) + 'live'.padStart(8) + 'xtenant'.padStart(9) + '  types');
    for (const r of results) {
      const flag = r.skipped ? `skipped: ${r.skipped}` : (r.compat.ok ? 'ok' : `MISMATCH ${r.compat.reason}`);
      console.log(`${r.tier}    ${r.key} > ${r.parent}`.padEnd(58)
        + String(r.references).padStart(10) + String(r.orphans).padStart(9)
        + String(r.live_orphans ?? '-').padStart(8) + String(r.cross_tenant ?? '-').padStart(9) + '  ' + flag);
      if (r.samples && r.samples.length) console.log(`       e.g. ${r.samples.map(s => JSON.stringify(s)).join(', ')}`);
    }
    console.log('');
  }
  console.log(JSON.stringify({ summary, results }, null, args.json ? 2 : 0));
  return summary.with_orphans > 0 ? 1 : 0;
}

module.exports = {
  CANDIDATES, TENANTLESS_TABLES, SOFT_DELETE_TABLES, parseCandidate, buildOrphanQuery, buildSampleQuery,
  buildCompatQuery, compareColumnTypes, buildAddForeignKeySql, assertReadOnly, requireDbEnv,
  selectCandidates, summarize, parseArgs, emitSql,
};

if (require.main === module) {
  main().then(code => process.exit(code), (e) => { console.error('[orphan-audit] failed:', e.message); process.exit(2); });
}
