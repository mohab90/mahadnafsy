#!/usr/bin/env node
'use strict';

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pool } = require('../lib/db');

const migrationDir = path.join(__dirname, '..', 'migrations');
const requested = (process.env.MIGRATION_VERIFY_VERSIONS || '144,145,146,147,148,149,150,151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

function checksum(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8')).digest('hex').slice(0, 16);
}

(async () => {
  try {
    const [rows] = await pool.query(
      `SELECT version, checksum, status
         FROM schema_migrations
        WHERE ${requested.map(() => 'version LIKE ?').join(' OR ')}
        ORDER BY version`,
      requested.map(version => `${version}%`)
    );
    const byPrefix = new Map(rows.map(row => [String(row.version).slice(0, 3), row]));
    let failed = 0;
    for (const version of requested) {
      const row = byPrefix.get(version);
      const fileName = fs.readdirSync(migrationDir).find(name => name.startsWith(`${version}_`));
      const fileChecksum = fileName ? checksum(path.join(migrationDir, fileName)) : null;
      const ok = Boolean(row && fileName && row.status === 'applied' && row.checksum === fileChecksum);
      console.log(`${ok ? 'PASS' : 'FAIL'} migration-${version}: status=${row?.status || 'missing'} checksum=${row?.checksum === fileChecksum ? 'match' : 'mismatch'}`);
      if (!ok) failed++;
    }
    const requiredObjects = [
      ['support_tickets', 'idx_support_tickets_tenant_active', 'INDEX'],
      ['notifications', 'idx_notifications_recipient', 'INDEX'],
      ['notification_reads', 'PRIMARY', 'INDEX'],
      ['feature_flags', 'chk_feature_flags_scope', 'CONSTRAINT'],
      ['feature_flags', 'uq_feature_flags_scope_key', 'INDEX'],
      ['tenant_subscriptions', 'chk_tenant_subscription_active_scope', 'CONSTRAINT'],
      ['tenant_subscriptions', 'uq_tenant_subscription_active', 'INDEX'],
      ['message_outbox', 'uq_outbox_provider_message', 'INDEX'],
      ['message_outbox', 'idx_outbox_delivery_status', 'INDEX'],
      ['community_post_likes', 'PRIMARY', 'INDEX'],
      ['community_post_comments', 'idx_community_comments_post', 'INDEX'],
      ['users', 'uq_users_tenant_active_session', 'INDEX'],
      ['otp_codes', 'idx_otp_tenant_delivery', 'INDEX'],
      ['users', 'active_session_ip_hash', 'COLUMN'],
      ['otp_codes', 'delivery_status', 'COLUMN'],
      ['salary_advances', 'journal_entry_id', 'COLUMN'],
      ['employee_documents', 'deleted_at', 'COLUMN'],
      ['payroll_period_locks', 'PRIMARY', 'INDEX'],
      ['instructor_rate_change_requests', 'idx_rate_request_pending', 'INDEX'],
      ['instructor_fees', 'uq_instructor_fee_payment', 'INDEX'],
      ['crm_commissions', 'uq_commission_payment_staff', 'INDEX'],
      ['payments', 'idx_payments_tenant_branch_date_status', 'INDEX'],
      ['course_quizzes', 'required_for_completion', 'COLUMN'],
      ['quiz_attempts', 'idx_quiz_attempts_daily_limit', 'INDEX'],
      ['certificate_requests', 'uq_certificate_active_request', 'INDEX'],
      ['attendance_logs', 'idx_attendance_tenant_staff_date', 'INDEX'],
      ['support_tickets', 'idx_support_tenant_assignee_created', 'INDEX'],
      ['daqqi_attendees', 'idx_daqqi_attendees_tenant_round', 'INDEX'],
      ['daqqi_attendance_events', 'uq_daqqi_attendance_event', 'INDEX'],
      ['otp_codes', 'code', 'COLUMN'],
      ['leads', 'forecast_category', 'COLUMN'],
      ['leads', 'expected_close_date', 'COLUMN'],
      ['leads', 'forecast_probability', 'COLUMN'],
      ['leads', 'idx_leads_tenant_forecast_close', 'INDEX'],
      ['crm_forecast_submissions', 'idx_crm_forecast_submission_latest', 'INDEX'],
      ['crm_forecast_submissions', 'chk_crm_forecast_submission_amounts', 'CONSTRAINT'],
      ['drip_sequences', 'version', 'COLUMN'],
      ['drip_enrollments', 'steps_snapshot', 'COLUMN'],
      ['drip_enrollments', 'idx_drip_enrollments_tenant_status_due', 'INDEX'],
      ['crm_sequence_step_executions', 'uq_crm_sequence_step', 'INDEX'],
      ['crm_sequence_step_executions', 'uq_crm_sequence_dedupe', 'INDEX'],
      ['crm_quotes', 'uq_crm_quote_number', 'INDEX'],
      ['crm_quotes', 'chk_crm_quote_totals', 'CONSTRAINT'],
      ['crm_quote_items', 'uq_crm_quote_item', 'INDEX'],
      ['crm_quote_approvals', 'idx_crm_quote_approvals', 'INDEX'],
      ['crm_quote_orders', 'uq_crm_quote_order', 'INDEX'],
      ['lead_timeline', 'idx_lead_timeline_tenant_event_at', 'INDEX'],
      ['crm_quotes', 'approval_policy_snapshot', 'COLUMN'],
      ['crm_quotes', 'idx_crm_quotes_approval_queue', 'INDEX'],
      ['connector_events', 'uq_connector_external_event', 'INDEX'],
      ['connector_events', 'idx_connector_event_due', 'INDEX'],
      ['crm_communication_evidence', 'uq_crm_communication_evidence_hash', 'INDEX'],
      ['crm_coaching_reviews', 'uq_crm_coaching_review', 'INDEX'],
      ['finance_vendors', 'idx_finance_vendors_tenant_active', 'INDEX'],
      ['accounts_payable_invoices', 'uq_ap_vendor_invoice', 'INDEX'],
      ['accounts_payable_payments', 'uq_ap_payment_reference', 'INDEX'],
      ['bank_reconciliations', 'uq_bank_reconciliation_period', 'INDEX'],
      ['bank_reconciliation_items', 'idx_bank_reconciliation_items', 'INDEX'],
      ['accounting_close_requests', 'idx_close_request_period', 'INDEX'],
      ['accounting_close_requests', 'uq_accounting_close_request_active', 'INDEX'],
      ['bank_reconciliations', 'branch_scope', 'COLUMN'],
      ['payment_intents', 'uq_payment_intent_idempotency', 'INDEX'],
      ['payment_intents', 'uq_payment_intent_active_order', 'INDEX'],
      ['payment_attempts', 'uq_payment_attempt_proof', 'INDEX'],
      ['payment_proofs', 'payment_intent_id', 'COLUMN'],
      ['payment_proofs', 'payment_attempt_id', 'COLUMN'],
      ['finance_document_sequences', 'PRIMARY', 'INDEX'],
      ['financial_documents', 'uq_financial_document_number', 'INDEX'],
      ['financial_documents', 'uq_financial_document_source', 'INDEX'],
      ['payment_proofs', 'review_due_at', 'COLUMN'],
      ['payment_proofs', 'second_review_required', 'COLUMN'],
      ['payment_proofs', 'idx_payment_proof_sla', 'INDEX'],
      ['payment_proofs', 'idx_payment_proof_second_review', 'INDEX'],
      ['payment_links', 'used_by_order_id', 'COLUMN'],
      ['payment_links', 'idx_payment_link_redemption', 'INDEX'],
      ['payment_links', 'fk_payment_link_order', 'CONSTRAINT'],
      ['cash_flow_forecast_assumptions', 'idx_cash_forecast_window', 'INDEX'],
      ['cash_flow_forecast_assumptions', 'chk_cash_forecast_amount', 'CONSTRAINT'],
    ];
    for (const [table, name, kind] of requiredObjects) {
      const source = kind === 'INDEX' ? 'information_schema.statistics'
        : kind === 'COLUMN' ? 'information_schema.columns'
          : 'information_schema.table_constraints';
      const field = kind === 'INDEX' ? 'index_name' : kind === 'COLUMN' ? 'column_name' : 'constraint_name';
      const [[row]] = await pool.query(
        `SELECT EXISTS(
           SELECT 1 FROM ${source}
            WHERE table_schema=DATABASE() AND table_name=? AND ${field}=?
         ) AS present`,
        [table, name]
      );
      const ok = Number(row?.present) === 1;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${kind.toLowerCase()}-${table}.${name}`);
      if (!ok) failed++;
    }
    const [[otpShape]] = await pool.query(
      `SELECT column_type AS columnType
         FROM information_schema.columns
        WHERE table_schema=DATABASE() AND table_name='otp_codes' AND column_name='code'
        LIMIT 1`
    );
    const otpTypeOk = String(otpShape?.columnType || '').toLowerCase() === 'char(64)';
    console.log(`${otpTypeOk ? 'PASS' : 'FAIL'} column-otp_codes.code-type: ${otpShape?.columnType || 'missing'}`);
    if (!otpTypeOk) failed++;

    const [[unsafeOtp]] = await pool.query(
      `SELECT COUNT(*) AS count
         FROM otp_codes
        WHERE used=0 AND code NOT REGEXP '^[0-9a-f]{64}$'`
    );
    const otpRowsOk = Number(unsafeOtp?.count || 0) === 0;
    console.log(`${otpRowsOk ? 'PASS' : 'FAIL'} data-otp_codes.active-hmac-only: unsafe=${Number(unsafeOtp?.count || 0)}`);
    if (!otpRowsOk) failed++;
    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    console.error(`FAIL migration-verification: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
})();
