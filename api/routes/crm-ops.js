'use strict';

const { TERMINAL_SQL } = require('../lib/leadStatuses');
const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'crm-ops-route' });
const { pool, cached } = require('../lib/db');
const { queueLeadWhatsAppBatch } = require('../lib/leadInteractions');
const { leadScope } = require('../lib/leadAccess');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { whatsappSendLimiter } = require('../middleware/rateLimits');
const { sqlCairoToday } = require('../lib/dates');

function routeError(res, error, message = 'crm ops route failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

router.post('/api/admin/crm/bulk-whatsapp', requireAuth, requireAdminOrStaff, requirePermission('bulk_whatsapp'), whatsappSendLimiter, async (req, res) => {
  try {
    const { leads = [], message } = req.body || {};
    if (!message || !leads.length) return res.status(400).json({ error: 'leads[] and message required' });
    if (leads.length > 100) return res.status(400).json({ error: 'max 100 leads per batch' });
    const results = await queueLeadWhatsAppBatch({
      tenantId: req.tenantId,
      leadIds: leads.map(lead => lead.id),
      message,
      actor: { email: req.user?.email || null, name: req.staffRecord?.name || null },
      staffId: req.staffRecord?.id || null,
      accessScope: leadScope(req, 'l'),
    });
    res.json({ ok: true, sent: results.length, failed: 0, queued: results.length, results });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    routeError(res, error, 'crm whatsapp batch failed');
  }
});

module.exports = router;
