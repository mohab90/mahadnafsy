'use strict';

async function archiveTenantAudit({ pool, tenantId, cutoff }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT IGNORE INTO audit_logs_archive
       SELECT * FROM audit_logs
       WHERE tenant_id=? AND created_at<?
       ORDER BY created_at LIMIT 5000`,
      [tenantId, cutoff]
    );
    await conn.query(
      `DELETE live FROM audit_logs live
       JOIN audit_logs_archive archived ON archived.id=live.id
       WHERE live.tenant_id=? AND live.created_at<?`,
      [tenantId, cutoff]
    );
    await conn.query(
      'DELETE FROM hr_audit_logs WHERE tenant_id=? AND performed_at<? ORDER BY performed_at LIMIT 5000',
      [tenantId, cutoff]
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

async function runHrAuditRetention({ pool, logger }) {
  try {
    const [policies] = await pool.query(
      `SELECT p.tenant_id,p.audit_retention_days
       FROM hr_policy_versions p
       JOIN (
         SELECT tenant_id,MAX(effective_from) effective_from
         FROM hr_policy_versions
         WHERE effective_from<=CURDATE() AND (effective_to IS NULL OR effective_to>=CURDATE())
         GROUP BY tenant_id
       ) current ON current.tenant_id=p.tenant_id AND current.effective_from=p.effective_from`
    );
    for (const policy of policies) {
      const days = Math.min(3650, Math.max(365, Number(policy.audit_retention_days || 2555)));
      await archiveTenantAudit({
        pool,
        tenantId: policy.tenant_id,
        cutoff: new Date(Date.now() - days * 86_400_000),
      });
    }
  } catch (error) {
    logger.warn('[Cron] hrAuditRetention error:', error.message);
  }
}

function scheduleHrAuditRetention({ pool, logger }) {
  const run = () => runHrAuditRetention({ pool, logger });
  setTimeout(() => {
    run();
    setInterval(run, 24 * 60 * 60 * 1000);
  }, 12 * 60 * 1000);
}

module.exports = { archiveTenantAudit, runHrAuditRetention, scheduleHrAuditRetention };
