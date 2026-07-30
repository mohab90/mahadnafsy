'use strict';

const { tryJson } = require('./helpers');
const { createUnsubscribeToken, filterSuppressed } = require('./marketingConsent');
const { uuidv4 } = require('./id');
const outbox = require('./outbox');

const clampLimit = value => Math.min(Math.max(Number(value) || 50, 1), 200);

async function recordStepExecution(conn, enrollment, dedupeKey) {
  const proposedId = uuidv4();
  await conn.query(
    `INSERT INTO crm_sequence_step_executions
       (id,tenant_id,enrollment_id,sequence_id,sequence_version,step_index,channel,status,due_at,dedupe_key)
     VALUES (?,?,?,?,?,?,'email','queued',?,?)
     ON DUPLICATE KEY UPDATE updated_at=updated_at`,
    [
      proposedId,
      enrollment.tenant_id,
      enrollment.id,
      enrollment.sequence_id,
      enrollment.sequence_version,
      enrollment.current_step,
      enrollment.next_send_at,
      dedupeKey,
    ]
  );
  const [[row]] = await conn.query(
    `SELECT id FROM crm_sequence_step_executions
      WHERE tenant_id=? AND enrollment_id=? AND step_index=? LIMIT 1`,
    [enrollment.tenant_id, enrollment.id, enrollment.current_step]
  );
  return row.id;
}

async function closeEnrollment(conn, enrollment, status, reason = null) {
  const timestampColumn = {
    completed: 'completed_at',
    failed: 'failed_at',
    unsubscribed: 'unsubscribed_at',
    unenrolled: 'unenrolled_at',
  }[status];
  if (!timestampColumn) throw new Error(`Unsupported CRM sequence terminal status: ${status}`);
  await conn.query(
    `UPDATE drip_enrollments
        SET status=?,${timestampColumn}=NOW(),exit_reason=?,
            last_activity_at=NOW(),last_error=NULL
      WHERE id=? AND tenant_id=?`,
    [status, reason, enrollment.id, enrollment.tenant_id]
  );
}

async function processDripCampaigns({ pool, logger, limit = 50 }) {
  const conn = await pool.getConnection();
  let queued = 0;
  try {
    await conn.beginTransaction();
    const [pending] = await conn.query(
      `SELECT de.*,COALESCE(de.steps_snapshot,ds.steps) AS effective_steps,
              ds.name AS sequence_name
         FROM drip_enrollments de
         JOIN drip_sequences ds
           ON ds.id=de.sequence_id AND ds.tenant_id=de.tenant_id
        WHERE de.next_send_at<=NOW()
          AND de.status='active'
          AND de.completed_at IS NULL
          AND de.unsubscribed_at IS NULL
          AND de.failed_at IS NULL
          AND ds.archived_at IS NULL
          AND ds.is_active=1
        ORDER BY de.next_send_at,de.id
        LIMIT ? FOR UPDATE`,
      [clampLimit(limit)]
    );
    for (const enrollment of pending) {
      const steps = tryJson(enrollment.effective_steps, []);
      const step = steps[enrollment.current_step];
      if (!step) {
        await closeEnrollment(conn, enrollment, 'completed', 'all_steps_completed');
        continue;
      }
      const subjectType = enrollment.lead_id ? 'lead' : enrollment.subscriber_id ? 'subscriber' : null;
      const subjectId = enrollment.lead_id || enrollment.subscriber_id;
      if (!subjectType || !subjectId) {
        await closeEnrollment(conn, enrollment, 'failed', 'missing_crm_subject');
        await conn.query(
          'UPDATE drip_enrollments SET last_error=? WHERE id=? AND tenant_id=?',
          ['CRM sequence enrollment has no subject', enrollment.id, enrollment.tenant_id]
        );
        continue;
      }
      const allowed = await filterSuppressed(enrollment.tenant_id, 'email', [enrollment], 'email', conn);
      if (!allowed.length) {
        await closeEnrollment(conn, enrollment, 'unsubscribed', 'consent_suppressed');
        continue;
      }
      const token = createUnsubscribeToken({
        tenantId: enrollment.tenant_id,
        subjectType,
        subjectId,
        channel: 'email',
      });
      const baseUrl = String(process.env.PUBLIC_SITE_URL || 'https://mahadnafsy.com').replace(/\/+$/, '');
      const unsubscribeUrl = `${baseUrl}/api/public/marketing/unsubscribe?token=${encodeURIComponent(token)}`;
      const html = `${step.body_html || ''}
        <p style="margin-top:24px;color:#6b7280;font-size:12px;text-align:center">
          <a href="${unsubscribeUrl}" style="color:#6b7280">إلغاء الاشتراك من رسائل المتابعة</a>
        </p>`;
      const dedupeKey = `drip:${enrollment.tenant_id}:${enrollment.id}:${enrollment.current_step}`;
      const executionId = await recordStepExecution(conn, enrollment, dedupeKey);
      await outbox.enqueue({
        channel: 'email',
        recipient: enrollment.email,
        subject: step.subject || 'رسالة من معهد الدراسات النفسية',
        payload: { html },
        tenantId: enrollment.tenant_id,
        dedupeKey,
        refType: 'crm_sequence_step',
        refId: executionId,
      }, conn);
      const next = steps[enrollment.current_step + 1];
      if (next) {
        const delayDays = Math.max(Number(next.delay_days) || 1, 0);
        await conn.query(
          `UPDATE drip_enrollments
              SET current_step=current_step+1,
                  next_send_at=DATE_ADD(NOW(),INTERVAL ? DAY),
                  retry_count=0,last_error=NULL,last_activity_at=NOW()
            WHERE id=? AND tenant_id=?`,
          [delayDays, enrollment.id, enrollment.tenant_id]
        );
      } else {
        await closeEnrollment(conn, enrollment, 'completed', 'all_steps_completed');
      }
      queued += 1;
    }
    await conn.commit();
    if (queued) logger.info(`[jobs] CRM sequence messages queued=${queued}`);
    return { scanned: pending.length, queued };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { processDripCampaigns, recordStepExecution, closeEnrollment };
