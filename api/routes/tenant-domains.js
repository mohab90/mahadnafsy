'use strict';

const express = require('express');
const { uuidv4 } = require('../lib/id');
const { pool, cacheInvalidate } = require('../lib/db');
const logger = require('../lib/logger').child({ route: 'tenant-domains' });
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { connectorDiagnosticLimiter } = require('../middleware/rateLimits');
const { createDomainChallenge, verifyDnsOwnership } = require('../lib/tenantDomains');
const { writeAuditEvent } = require('../lib/auditTrail');
const { invalidateBrandSettings } = require('../lib/brandSettings');
const { invalidateEmailConfig } = require('../lib/email');

const router = express.Router();
const recordName = domain => `_mahad-verify.${domain}`;

function invalidateTenantIdentity(tenantId) {
  cacheInvalidate('tenant_index');
  invalidateBrandSettings(tenantId);
  invalidateEmailConfig(tenantId);
}

router.get(
  '/api/admin/tenant-domain',
  requireAuth, requireAdminOrStaff, requirePermission('manage_settings'),
  async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT domain, status, verified_at, created_at, updated_at
       FROM tenant_domains WHERE tenant_id=? LIMIT 1`,
      [req.tenantId]
    );
    res.json(row ? { ...row, record_name: recordName(row.domain) } : null);
  } catch (error) {
    logger.error('domain read failed', error);
    res.status(500).json({ error: 'Failed to load tenant domain' });
  }
});

router.put(
  '/api/admin/tenant-domain',
  requireAuth, requireAdminOrStaff, requirePermission('manage_settings'),
  async (req, res) => {
  try {
    const challenge = createDomainChallenge(req.body?.domain);
    await writeAuditEvent({
      req,
      action: 'tenant.domain.verification_requested',
      entityType: 'tenant_domain',
      entityId: challenge.domain,
      severity: 'warning',
    });
    const [[domainOwner]] = await pool.query(
      'SELECT tenant_id FROM tenant_domains WHERE domain=? LIMIT 1',
      [challenge.domain]
    );
    if (domainOwner && domainOwner.tenant_id !== req.tenantId) {
      return res.status(409).json({ error: 'Domain already belongs to another tenant', code: 'DOMAIN_IN_USE' });
    }
    const [[tenantDomain]] = await pool.query(
      'SELECT id FROM tenant_domains WHERE tenant_id=? LIMIT 1',
      [req.tenantId]
    );
    if (tenantDomain) {
      await pool.query(
        `UPDATE tenant_domains
         SET domain=?, status='pending', verification_token_hash=?, verified_at=NULL
         WHERE id=? AND tenant_id=?`,
        [challenge.domain, challenge.tokenHash, tenantDomain.id, req.tenantId]
      );
    } else {
      await pool.query(
        `INSERT INTO tenant_domains
           (id, tenant_id, domain, status, verification_token_hash, verified_at)
         VALUES (?, ?, ?, 'pending', ?, NULL)`,
        [uuidv4(), req.tenantId, challenge.domain, challenge.tokenHash]
      );
    }
    invalidateTenantIdentity(req.tenantId);
    res.json({
      ok: true,
      domain: challenge.domain,
      status: 'pending',
      record_name: challenge.recordName,
      record_value: challenge.recordValue,
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Domain already belongs to another tenant', code: 'DOMAIN_IN_USE' });
    }
    const inputError = /invalid.*domain/i.test(error.message || '');
    logger[inputError ? 'warn' : 'error']('domain request failed', error);
    res.status(inputError ? 400 : 500).json({ error: inputError ? error.message : 'Failed to request domain verification' });
  }
});

router.post(
  '/api/admin/tenant-domain/verify',
  requireAuth, requireAdminOrStaff, requirePermission('manage_settings'),
  connectorDiagnosticLimiter,
  async (req, res) => {
    try {
      const [[row]] = await pool.query(
        `SELECT domain, status, verification_token_hash
         FROM tenant_domains WHERE tenant_id=? LIMIT 1`,
        [req.tenantId]
      );
      if (!row) return res.status(404).json({ error: 'No domain verification request found' });
      if (row.status === 'verified') return res.json({ ok: true, domain: row.domain, status: 'verified' });
      if (!await verifyDnsOwnership(row.domain, row.verification_token_hash)) {
        return res.status(409).json({
          error: 'DNS verification record was not found yet',
          code: 'DOMAIN_DNS_NOT_VERIFIED',
          record_name: recordName(row.domain),
        });
      }
      await pool.query(
        `UPDATE tenant_domains SET status='verified', verified_at=NOW()
         WHERE tenant_id=? AND domain=? AND verification_token_hash=?`,
        [req.tenantId, row.domain, row.verification_token_hash]
      );
      await writeAuditEvent({
        req,
        action: 'tenant.domain.verified',
        entityType: 'tenant_domain',
        entityId: row.domain,
        severity: 'warning',
      });
      invalidateTenantIdentity(req.tenantId);
      res.json({ ok: true, domain: row.domain, status: 'verified' });
    } catch (error) {
      logger.error('domain verification failed', error);
      res.status(502).json({ error: 'Domain verification lookup failed' });
    }
  }
);

router.delete(
  '/api/admin/tenant-domain',
  requireAuth, requireAdminOrStaff, requirePermission('manage_settings'),
  async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM tenant_domains WHERE tenant_id=?', [req.tenantId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Tenant domain not found' });
    invalidateTenantIdentity(req.tenantId);
    res.json({ ok: true });
  } catch (error) {
    logger.error('domain removal failed', error);
    res.status(500).json({ error: 'Failed to remove tenant domain' });
  }
});

module.exports = router;
