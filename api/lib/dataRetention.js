'use strict';

// Rows that only ever accumulated (21 Oct 2026, the disk at 88%): finished
// queue rows, processed webhook events, the bodies of messages sent long ago,
// old sign-in records and read notifications. Each rule works in small
// batches, so no statement holds a large lock or a long undo log while the
// API is busy, and stops after MAX_BATCHES so one night never runs long.
//
// InnoDB does not hand freed pages back to the disk; it reuses them, so this
// stops the growth rather than shrinking the files.
//
// Not touched, on purpose: activity_logs (lead timelines read them; moved by
// lib/archiveJob.js when ARCHIVE_ACTIVITY_LOGS=true), wa_web_messages (the
// reps' chat history is business data), finance_outbox (its dedupe keys guard
// commission and deal-value events per payment, forever) and the audit tables
// (lib/hrAuditRetentionJob.js follows the HR policy).
const BATCH = 2000;
const MAX_BATCHES = 250;

const days = (name, fallback, env = process.env) => {
  const raw = env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  // 0 switches a rule off; anything below a week is a typo, not a policy.
  if (n === 0) return 0;
  return Number.isFinite(n) ? Math.max(7, Math.floor(n)) : fallback;
};

function retentionRules(env = process.env) {
  return [
    {
      name: 'job_queue done',
      days: days('RETENTION_JOB_QUEUE_DAYS', 30, env),
      // Recurring dedupe keys are per time bucket (lib/jobQueue.js), so an old
      // finished row stops nothing from running again.
      table: 'job_queue',
      where: "status='done' AND done_at < ?",
    },
    {
      name: 'connector_events processed',
      days: days('RETENTION_CONNECTOR_EVENTS_DAYS', 90, env),
      // Providers redeliver a webhook within hours or days, never months.
      table: 'connector_events',
      where: "status='processed' AND received_at < ?",
    },
    {
      name: 'message_outbox sent bodies',
      days: days('RETENTION_OUTBOX_BODY_DAYS', 90, env),
      // The row stays: its dedupe key keeps a «once ever» message (a welcome,
      // a receipt) from going twice, and campaign reports join it. Only the
      // body goes; its category is kept for the screens that group by it.
      table: 'message_outbox',
      set: "payload_json = JSON_OBJECT('category', JSON_VALUE(payload_json, '$.category')), payload_pruned_at = NOW()",
      where: "status='sent' AND payload_pruned_at IS NULL AND created_at < ?",
    },
    {
      name: 'login_history',
      days: days('RETENTION_LOGIN_HISTORY_DAYS', 365, env),
      table: 'login_history',
      where: 'created_at < ?',
    },
    {
      name: 'notifications read',
      days: days('RETENTION_NOTIFICATIONS_DAYS', 180, env),
      table: 'notifications',
      where: 'read_at IS NOT NULL AND created_at < ?',
    },
    {
      name: 'admin_notifications read',
      days: days('RETENTION_NOTIFICATIONS_DAYS', 180, env),
      table: 'admin_notifications',
      where: 'is_read=1 AND created_at < ?',
    },
  ];
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// tenantId narrows a pass to one tenant (the tests share a database); the
// nightly job passes none and trims every tenant.
function ruleSql(rule, tenantId) {
  const where = `${rule.where}${tenantId ? ' AND tenant_id = ?' : ''}`;
  return rule.set
    ? `UPDATE ${rule.table} SET ${rule.set} WHERE ${where} LIMIT ?`
    : `DELETE FROM ${rule.table} WHERE ${where} LIMIT ?`;
}

/** One pass over every rule. Returns { [rule name]: rows affected }. */
async function runDataRetention({ pool, logger, env = process.env, now = Date.now(), batch = BATCH, maxBatches = MAX_BATCHES, gapMs = 50, tenantId = null }) {
  const summary = {};
  for (const rule of retentionRules(env)) {
    if (!rule.days) continue;
    const cutoff = new Date(now - rule.days * 86_400_000);
    let total = 0;
    try {
      for (let i = 0; i < maxBatches; i += 1) {
        const [result] = await pool.query(ruleSql(rule, tenantId), tenantId ? [cutoff, tenantId, batch] : [cutoff, batch]);
        const affected = Number(result?.affectedRows || 0);
        total += affected;
        if (affected < batch) break;
        if (gapMs) await pause(gapMs);
      }
    } catch (error) {
      // A table this database does not have (an older schema) skips its rule only.
      logger?.warn?.(`[retention] ${rule.name} failed:`, error.message);
    }
    summary[rule.name] = total;
  }
  const trimmed = Object.entries(summary).filter(([, n]) => n > 0);
  if (trimmed.length) logger?.info?.(`[retention] ${trimmed.map(([name, n]) => `${name}: ${n}`).join(', ')}`);
  return summary;
}

module.exports = { retentionRules, ruleSql, runDataRetention, BATCH, MAX_BATCHES };
