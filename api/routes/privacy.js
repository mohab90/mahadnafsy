'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { sanitize } = require('../lib/helpers');
const { writeAuditEvent } = require('../lib/auditTrail');
const {
  anonymizeSubscriber,
  buildSubscriberExport,
  findSubscriberForIdentity,
  getPrivacyPolicy,
} = require('../lib/privacyService');
const {
  requireAuth,
  requireAdminOrStaff,
  requirePermission,
  invalidateIdentity,
} = require('../middleware/auth');
const { bulkOperationLimiter } = require('../middleware/rateLimits');
const logger = require('../lib/logger').child({ route: 'privacy' });

const identity = req => req.user?.uid || req.user?.email || 'system';
const attachment = (res, name, data) => {
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.send(JSON.stringify(data, null, 2));
};

async function consistentExport(req, subscriberId) {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.beginTransaction();
    const data = await buildSubscriberExport({ tenantId: req.tenantId, subscriberId, db: conn });
    if (!data) {
      await conn.rollback();
      return null;
    }
    await writeAuditEvent({
      action: 'subscriber_data_exported',
      entityType: 'subscriber',
      entityId: subscriberId,
      severity: 'warning',
      metadata: { requester: req.path.startsWith('/api/me/') ? 'client' : 'admin' },
      req,
      db: conn,
    });
    await conn.commit();
    return data;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

router.get('/api/me/privacy/export', requireAuth, bulkOperationLimiter, async (req, res) => {
  try {
    const subscriber = await findSubscriberForIdentity(req.tenantId, req.user);
    if (!subscriber) return res.status(404).json({ error: 'Subscriber profile not found' });
    const policy = await getPrivacyPolicy(req.tenantId);
    if (!policy.allow_self_service) return res.status(403).json({ error: 'Self-service privacy requests are disabled' });
    const data = await consistentExport(req, subscriber.id);
    return attachment(res, `my-data-${new Date().toISOString().slice(0, 10)}.json`, data);
  } catch (error) {
    logger.error('self export failed', { error: error.message, tenantId: req.tenantId });
    return res.status(500).json({ error: 'Unable to export data' });
  }
});

router.get('/api/me/privacy/requests', requireAuth, async (req, res) => {
  try {
    const subscriber = await findSubscriberForIdentity(req.tenantId, req.user);
    if (!subscriber) return res.json([]);
    const [rows] = await pool.query(
      `SELECT id,request_type,status,reason,decision_note,legal_hold_reason,due_at,completed_at,created_at
       FROM privacy_requests WHERE tenant_id=? AND subscriber_id=?
       ORDER BY created_at DESC LIMIT 20`,
      [req.tenantId, subscriber.id]
    );
    return res.json(rows);
  } catch (error) {
    logger.error('self privacy request list failed', { error: error.message });
    return res.status(500).json({ error: 'Unable to load privacy requests' });
  }
});

router.post('/api/me/privacy/requests', requireAuth, bulkOperationLimiter, async (req, res) => {
  let conn;
  try {
    if (req.body?.request_type !== 'erasure') {
      return res.status(400).json({ error: 'Use the immediate export endpoint for data exports' });
    }
    const policy = await getPrivacyPolicy(req.tenantId);
    if (!policy.allow_self_service) return res.status(403).json({ error: 'Self-service privacy requests are disabled' });
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const subscriber = await findSubscriberForIdentity(req.tenantId, req.user, conn, true);
    if (!subscriber) {
      await conn.rollback();
      return res.status(404).json({ error: 'Subscriber profile not found' });
    }
    const [[open]] = await conn.query(
      `SELECT id,status FROM privacy_requests
       WHERE tenant_id=? AND subscriber_id=? AND request_type='erasure'
         AND status IN ('pending','processing','blocked')
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [req.tenantId, subscriber.id]
    );
    if (open) {
      await conn.rollback();
      return res.status(409).json({ error: 'An erasure request is already open', request: open });
    }
    const id = uuidv4();
    const reason = sanitize(req.body?.reason || '', 1000) || null;
    await conn.query(
      `INSERT INTO privacy_requests
       (id,tenant_id,subscriber_id,requester_user_id,requester_type,request_type,status,reason,due_at)
       VALUES (?,?,?,?,?,'erasure','pending',?,DATE_ADD(NOW(), INTERVAL ? DAY))`,
      [id, req.tenantId, subscriber.id, identity(req), 'client', reason, policy.erasure_sla_days]
    );
    await writeAuditEvent({
      action: 'privacy_erasure_requested',
      entityType: 'privacy_request',
      entityId: id,
      severity: 'warning',
      req,
      db: conn,
    });
    await conn.commit();
    return res.status(201).json({ ok: true, id, status: 'pending' });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    logger.error('privacy request create failed', { error: error.message });
    return res.status(500).json({ error: 'Unable to create privacy request' });
  } finally {
    conn?.release();
  }
});

router.get(
  '/api/admin/privacy/requests',
  requireAuth,
  requireAdminOrStaff,
  requirePermission('view_subscribers'),
  bulkOperationLimiter,
  async (req, res) => {
    try {
      const status = String(req.query.status || '').trim();
      const params = [req.tenantId];
      const filter = status ? ' AND pr.status=?' : '';
      if (status) params.push(status);
      const [rows] = await pool.query(
        `SELECT pr.*,s.name AS subscriber_name,s.email AS subscriber_email,s.client_code
         FROM privacy_requests pr
         LEFT JOIN subscribers s ON s.id=pr.subscriber_id AND s.tenant_id=pr.tenant_id
         WHERE pr.tenant_id=?${filter}
         ORDER BY FIELD(pr.status,'pending','processing','blocked','failed','completed','rejected'),pr.due_at ASC
         LIMIT 500`,
        params
      );
      return res.json(rows);
    } catch (error) {
      logger.error('admin privacy request list failed', { error: error.message });
      return res.status(500).json({ error: 'Unable to load privacy requests' });
    }
  }
);

router.post(
  '/api/admin/privacy/requests/:id/decision',
  requireAuth,
  requireAdminOrStaff,
  requirePermission('delete_subscribers'),
  bulkOperationLimiter,
  async (req, res) => {
    let conn;
    try {
      const decision = String(req.body?.decision || '').toLowerCase();
      const note = sanitize(req.body?.note || '', 1000);
      if (!['approve', 'reject', 'block'].includes(decision)) {
        return res.status(400).json({ error: 'decision must be approve, reject or block' });
      }
      if (decision !== 'approve' && !note) return res.status(400).json({ error: 'A reason is required' });
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [[request]] = await conn.query(
        `SELECT * FROM privacy_requests
         WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
        [req.params.id, req.tenantId]
      );
      if (!request) {
        await conn.rollback();
        return res.status(404).json({ error: 'Privacy request not found' });
      }
      if (!['pending', 'blocked', 'failed'].includes(request.status)) {
        await conn.rollback();
        return res.status(409).json({ error: `Request is already ${request.status}` });
      }
      if (decision === 'reject' || decision === 'block') {
        const status = decision === 'block' ? 'blocked' : 'rejected';
        await conn.query(
          `UPDATE privacy_requests SET status=?,decision_note=?,legal_hold_reason=?,
             handled_by=?,completed_at=IF(?='rejected',NOW(),NULL)
           WHERE id=? AND tenant_id=?`,
          [status, note, decision === 'block' ? note : null, identity(req), status, request.id, req.tenantId]
        );
        await writeAuditEvent({
          action: `privacy_erasure_${status}`,
          entityType: 'privacy_request',
          entityId: request.id,
          severity: 'warning',
          metadata: { decision: status },
          req,
          db: conn,
        });
        await conn.commit();
        return res.json({ ok: true, status });
      }

      await conn.query(
        `UPDATE privacy_requests SET status='processing',decision_note=?,handled_by=?
         WHERE id=? AND tenant_id=?`,
        [note || null, identity(req), request.id, req.tenantId]
      );
      let result;
      try {
        result = await anonymizeSubscriber({
          tenantId: req.tenantId,
          subscriberId: request.subscriber_id,
          actorId: identity(req),
          db: conn,
        });
      } catch (error) {
        if (error.code !== 'ERASURE_BLOCKED_ACTIVE_OBLIGATIONS') throw error;
        await conn.query(
          `UPDATE privacy_requests SET status='blocked',legal_hold_reason=?,evidence_json=?
           WHERE id=? AND tenant_id=?`,
          ['Active customer obligations', JSON.stringify({ obligations: error.obligations }), request.id, req.tenantId]
        );
        await writeAuditEvent({
          action: 'privacy_erasure_blocked',
          entityType: 'privacy_request',
          entityId: request.id,
          severity: 'warning',
          metadata: { obligations: error.obligations },
          req,
          db: conn,
        });
        await conn.commit();
        return res.status(409).json({ error: error.message, code: error.code, obligations: error.obligations });
      }
      await conn.query(
        `UPDATE privacy_requests SET status='completed',completed_at=NOW(),legal_hold_reason=NULL,
           evidence_json=?,evidence_hash=? WHERE id=? AND tenant_id=?`,
        [JSON.stringify(result.evidence), result.hash, request.id, req.tenantId]
      );
      await writeAuditEvent({
        action: 'privacy_erasure_completed',
        entityType: 'privacy_request',
        entityId: request.id,
        severity: 'critical',
        metadata: { evidence_hash: result.hash, verified: result.evidence.verified },
        req,
        db: conn,
      });
      await conn.commit();
      invalidateIdentity(req.tenantId);
      return res.json({ ok: true, status: 'completed', evidence: result.evidence, evidenceHash: result.hash });
    } catch (error) {
      if (conn) await conn.rollback().catch(() => {});
      logger.error('privacy decision failed', { error: error.message, requestId: req.params.id });
      return res.status(error.code === 'SUBSCRIBER_NOT_FOUND' ? 404 : 500).json({ error: error.message || 'Unable to process privacy request' });
    } finally {
      conn?.release();
    }
  }
);

router.get(
  '/api/admin/privacy/policy',
  requireAuth,
  requireAdminOrStaff,
  requirePermission('manage_settings'),
  async (req, res) => {
    try {
      const policy = await getPrivacyPolicy(req.tenantId);
      const deploymentRegion = process.env.DATA_RESIDENCY_REGION || 'not_configured';
      return res.json({
        ...policy,
        deployment_region: deploymentRegion,
        residency_verified: deploymentRegion !== 'not_configured' && deploymentRegion === policy.residency_region,
      });
    } catch (error) {
      logger.error('privacy policy load failed', { error: error.message });
      return res.status(500).json({ error: 'Unable to load privacy policy' });
    }
  }
);

router.put(
  '/api/admin/privacy/policy',
  requireAuth,
  requireAdminOrStaff,
  requirePermission('manage_settings'),
  async (req, res) => {
    let conn;
    try {
      const residency = String(req.body?.residency_region || '').trim().toLowerCase();
      const deployment = String(process.env.DATA_RESIDENCY_REGION || '').trim().toLowerCase();
      const exportDays = Number(req.body?.export_sla_days);
      const erasureDays = Number(req.body?.erasure_sla_days);
      const retentionDays = Number(req.body?.financial_retention_days);
      if (!/^[a-z0-9_-]{2,40}$/.test(residency)) return res.status(400).json({ error: 'Invalid residency region' });
      if (!deployment) return res.status(409).json({ error: 'DATA_RESIDENCY_REGION must be configured on the deployment first' });
      if (residency !== deployment) return res.status(409).json({ error: 'Declared region does not match the deployment region' });
      if (!Number.isInteger(exportDays) || exportDays < 1 || exportDays > 30
        || !Number.isInteger(erasureDays) || erasureDays < 1 || erasureDays > 90
        || !Number.isInteger(retentionDays) || retentionDays < 365 || retentionDays > 3650) {
        return res.status(400).json({ error: 'Invalid privacy SLA or retention period' });
      }
      conn = await pool.getConnection();
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO tenant_privacy_policies
         (tenant_id,residency_region,export_sla_days,erasure_sla_days,financial_retention_days,allow_self_service,updated_by)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE residency_region=VALUES(residency_region),
           export_sla_days=VALUES(export_sla_days),erasure_sla_days=VALUES(erasure_sla_days),
           financial_retention_days=VALUES(financial_retention_days),
           allow_self_service=VALUES(allow_self_service),updated_by=VALUES(updated_by)`,
        [req.tenantId, residency, exportDays, erasureDays, retentionDays,
          req.body?.allow_self_service === false ? 0 : 1, identity(req)]
      );
      await writeAuditEvent({
        action: 'privacy_policy_updated',
        entityType: 'tenant_privacy_policy',
        entityId: req.tenantId,
        severity: 'warning',
        metadata: { residency, exportDays, erasureDays, retentionDays },
        req,
        db: conn,
      });
      const policy = await getPrivacyPolicy(req.tenantId, conn);
      await conn.commit();
      return res.json({ ok: true, policy, residency_verified: true });
    } catch (error) {
      if (conn) await conn.rollback().catch(() => {});
      logger.error('privacy policy update failed', { error: error.message });
      return res.status(500).json({ error: 'Unable to update privacy policy' });
    } finally {
      conn?.release();
    }
  }
);

router.get(
  '/api/admin/subscribers/:id/privacy-export',
  requireAuth,
  requireAdminOrStaff,
  requirePermission('export_subscribers'),
  bulkOperationLimiter,
  async (req, res) => {
    try {
      const data = await consistentExport(req, req.params.id);
      if (!data) return res.status(404).json({ error: 'Subscriber not found' });
      return attachment(res, `subscriber-${req.params.id}-data.json`, data);
    } catch (error) {
      logger.error('admin privacy export failed', { error: error.message });
      return res.status(500).json({ error: 'Unable to export subscriber data' });
    }
  }
);

module.exports = router;
