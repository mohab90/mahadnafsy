'use strict';

const express = require('express');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { connectorDiagnosticLimiter } = require('../middleware/rateLimits');
const {
  PROVIDERS,
  diagnoseFacebook,
  diagnoseGoogleSheets,
  diagnoseOtp,
  diagnosePayment,
} = require('../lib/connectorDiagnostics');
const {
  getLeadSourceConnectorSettings,
  getOtpProviderSettings,
  getPaymentGatewaySettings,
} = require('../lib/saasSettings');
const { getTenantSetting } = require('../lib/tenantSettings');
const { writeAuditEvent } = require('../lib/auditTrail');
const logger = require('../lib/logger').child({ route: 'connector-diagnostics' });

const router = express.Router();
async function audit(req, action, provider, outcome = {}) {
  await writeAuditEvent({
    req,
    action,
    entityType: 'connector_diagnostic',
    entityId: provider,
    severity: outcome.ok === false ? 'warning' : 'info',
    metadata: {
      provider,
      mode: outcome.mode || 'requested',
      ok: outcome.ok,
      has_recipient: !!outcome.hasRecipient,
    },
  });
}

router.post('/api/admin/payment-gateway/test', requireAuth, requireAdminOrStaff, requirePermission('manage_settings'), connectorDiagnosticLimiter, async (req, res) => {
  try {
    await audit(req, 'connector.diagnostic.requested', 'payment_gateway');
    const config = await getPaymentGatewaySettings(req.tenantId);
    const outcome = diagnosePayment(config);
    await audit(req, 'connector.diagnostic.completed', 'payment_gateway', outcome);
    res.json(outcome);
  } catch (error) {
    logger.error('payment diagnostic failed', { err: error.message, tenantId: req.tenantId });
    res.status(500).json({ ok: false, message: 'تعذر تنفيذ اختبار إعدادات الدفع.' });
  }
});

router.post('/api/admin/lead-sources/test', requireAuth, requireAdminOrStaff, requirePermission('manage_settings'), connectorDiagnosticLimiter, async (req, res) => {
  const provider = String(req.body?.provider || '').trim().toLowerCase();
  if (!PROVIDERS.has(provider)) return res.status(400).json({ ok: false, message: 'مصدر البيانات غير مدعوم.' });
  try {
    await audit(req, 'connector.diagnostic.requested', provider);
    const config = await getLeadSourceConnectorSettings(req.tenantId);
    const outcome = provider === 'facebook'
      ? await diagnoseFacebook(config)
      : await diagnoseGoogleSheets(
        config,
        await getTenantSetting('crm_settings', { tenantId: req.tenantId, fallback: {} })
      );
    await audit(req, 'connector.diagnostic.completed', provider, outcome);
    res.json(outcome);
  } catch (error) {
    logger.error('lead source diagnostic failed', { provider, err: error.message, tenantId: req.tenantId });
    res.status(500).json({ ok: false, message: 'تعذر تنفيذ اختبار مصدر البيانات.' });
  }
});

router.post('/api/admin/otp-provider/test', requireAuth, requireAdminOrStaff, requirePermission('manage_settings'), connectorDiagnosticLimiter, async (req, res) => {
  const channel = String(req.body?.channel || '').trim().toLowerCase();
  const to = String(req.body?.to || '').trim();
  if (!['email', 'whatsapp', 'sms'].includes(channel)) {
    return res.status(400).json({ ok: false, message: 'قناة OTP غير مدعومة.' });
  }
  if (to.length > 254) return res.status(400).json({ ok: false, message: 'بيانات المستلم غير صالحة.' });
  try {
    // The request event is committed before any real message can leave the system.
    await audit(req, 'connector.diagnostic.requested', `otp:${channel}`, { hasRecipient: !!to });
    const config = await getOtpProviderSettings(req.tenantId);
    const outcome = await diagnoseOtp(channel, to, config);
    await audit(req, 'connector.diagnostic.completed', `otp:${channel}`, { ...outcome, hasRecipient: !!to });
    res.json(outcome);
  } catch (error) {
    if (/invalid otp test recipient/i.test(error.message || '')) {
      return res.status(400).json({ ok: false, message: 'بيانات المستلم غير صالحة.' });
    }
    logger.error('OTP diagnostic failed', { channel, err: error.message, tenantId: req.tenantId });
    res.status(500).json({ ok: false, message: 'تعذر تنفيذ اختبار OTP.' });
  }
});

module.exports = router;
