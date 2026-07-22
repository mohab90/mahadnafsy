'use strict';

const express = require('express');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { connectorDiagnosticLimiter: assetUploadLimiter } = require('../middleware/rateLimits');
const { getTenantSetting, setTenantSetting } = require('../lib/tenantSettings');
const { deleteStoredBrandAsset, inspectBrandAsset, storeBrandAsset } = require('../lib/brandAssetStorage');
const { writeAuditEvent } = require('../lib/auditTrail');
const logger = require('../lib/logger').child({ route: 'branding-assets' });

const router = express.Router();

router.post(
  '/api/admin/sys-config/general/logo',
  requireAuth,
  requireAdminOrStaff,
  requirePermission('manage_settings'),
  assetUploadLimiter,
  async (req, res) => {
    const kind = String(req.body?.kind || '');
    let storedAsset;
    let configSaved = false;
    try {
      const asset = await inspectBrandAsset({
        dataUrl: req.body?.dataUrl,
        declaredMime: req.body?.mime,
        kind,
      });
      const current = await getTenantSetting('sys_general', { tenantId: req.tenantId, fallback: {} });
      const field = kind === 'favicon' ? 'brand_favicon_url' : 'brand_logo_url';
      const previousUrl = current?.[field] || '';

      // Audit intent first: if audit persistence is unavailable, no file or DB
      // mutation is allowed to proceed.
      await writeAuditEvent({
        req,
        action: 'branding.asset.update_requested',
        entityType: 'system_setting',
        entityId: kind,
        metadata: { kind, size: asset.buffer.length, width: asset.width, height: asset.height },
      });
      storedAsset = await storeBrandAsset({ tenantId: req.tenantId, asset });
      await setTenantSetting('sys_general', { ...current, [field]: storedAsset.url }, {
        tenantId: req.tenantId,
        actorId: req.user?.uid || req.user?.email,
      });
      configSaved = true;
      writeAuditEvent({
        req,
        action: 'branding.asset.updated',
        entityType: 'system_setting',
        entityId: kind,
        metadata: { kind, size: storedAsset.size, width: storedAsset.width, height: storedAsset.height },
      }).catch(error => logger.error('brand asset completion audit failed', { err: error.message, kind, tenantId: req.tenantId }));
      if (previousUrl && previousUrl !== storedAsset.url) {
        deleteStoredBrandAsset(previousUrl).catch(error => logger.warn('old brand asset cleanup failed', { err: error.message }));
      }
      res.json({ ok: true, url: storedAsset.url, size: storedAsset.size, width: storedAsset.width, height: storedAsset.height, kind });
    } catch (error) {
      if (!configSaved && storedAsset?.url) await deleteStoredBrandAsset(storedAsset.url).catch(() => {});
      const inputError = /invalid|unsupported|signature|dimensions|1mb|image/i.test(error.message || '');
      logger[inputError ? 'warn' : 'error']('brand asset upload failed', { kind, err: error.message, tenantId: req.tenantId });
      res.status(inputError ? 400 : 500).json({ error: inputError ? error.message : 'Brand asset upload failed' });
    }
  }
);

module.exports = router;
