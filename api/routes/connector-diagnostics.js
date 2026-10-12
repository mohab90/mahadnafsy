'use strict';

const express = require('express');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
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
const { pool } = require('../lib/db');
const metaCapi = require('../lib/metaCapi');
const logger = require('../lib/logger').child({ route: 'connector-diagnostics' });

const router = express.Router();
const manageConnectors = [requireAuth, requireAdminOrStaff, requirePermission('manage_settings')];
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

// Meta's Conversions API (lib/metaCapi.js). Admin-only, like the settings
// blob it reads: the token is in there, and a test sent without a test event
// code is counted by Meta as a real Lead. What it answers names where each
// part came from and whether a token exists — never the token.
router.get('/api/admin/meta-capi', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await metaCapi.describeConfig(req.tenantId));
  } catch (error) {
    logger.error('meta capi status failed', { err: error.message, tenantId: req.tenantId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/meta-capi/test', requireAuth, requireAdmin, connectorDiagnosticLimiter, async (req, res) => {
  try {
    await audit(req, 'connector.diagnostic.requested', 'meta_capi');
    const outcome = await metaCapi.sendTestEvent(req.tenantId, { userAgent: req.headers['user-agent'] });
    await audit(req, 'connector.diagnostic.completed', 'meta_capi', outcome);
    if (outcome.reason === 'not_configured') {
      return res.json({ ...outcome, message: 'الربط مش مكتمل: لازم Pixel ID صحيح وتوكن، والإرسال يكون شغّال.' });
    }
    res.json(outcome);
  } catch (error) {
    logger.error('meta capi test failed', { err: error.message, tenantId: req.tenantId });
    res.status(500).json({ ok: false, message: 'تعذر إرسال الحدث التجريبي.' });
  }
});

router.get('/api/admin/connectors/events', ...manageConnectors, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const params = [req.tenantId];
    let filter = '';
    if (req.query.provider) {
      filter += ' AND provider=?';
      params.push(String(req.query.provider));
    }
    if (req.query.status) {
      filter += ' AND status=?';
      params.push(String(req.query.status));
    }
    params.push(limit);
    const [events] = await pool.query(
      `SELECT id,provider,external_event_id,status,attempts,next_attempt_at,last_error,
              received_at,processed_at,updated_at
         FROM connector_events
        WHERE tenant_id=?${filter}
        ORDER BY received_at DESC LIMIT ?`,
      params
    );
    const [health] = await pool.query(
      `SELECT provider,status,COUNT(*) AS count,MIN(received_at) AS oldest_at,MAX(updated_at) AS latest_at
         FROM connector_events WHERE tenant_id=? GROUP BY provider,status`,
      [req.tenantId]
    );
    res.json({ events, health });
  } catch (error) {
    logger.error('connector event list failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/connectors/events/:id/replay', ...manageConnectors, connectorDiagnosticLimiter, async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE connector_events
          SET status='pending',attempts=0,next_attempt_at=NOW(),locked_at=NULL,locked_by=NULL,last_error=NULL
        WHERE id=? AND tenant_id=? AND status IN ('failed','dead')`,
      [req.params.id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(409).json({ error: 'Only failed or dead events can be replayed' });
    await audit(req, 'connector.event.replayed', 'connector_event', { ok: true });
    res.json({ ok: true, status: 'pending' });
  } catch (error) {
    logger.error('connector event replay failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
