'use strict';
/**
 * «عملاء الصفحة»: who wrote to the Facebook page and Instagram, and the ways
 * Meta allows reaching them again (lib/pageAudience.js).
 */
const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'page-audience-route' });
const audience = require('../lib/pageAudience');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { bulkOperationLimiter } = require('../middleware/rateLimits');

const guard = [requireAuth, requireAdminOrStaff, requirePermission('manage_channel_settings')];
const PLATFORMS = ['messenger', 'instagram'];

function fail(res, error, where) {
  if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message });
  logger.error(where, error);
  return res.status(500).json({ error: 'Internal server error' });
}

router.get('/api/admin/page-audience', ...guard, async (req, res) => {
  try { res.json(await audience.audienceSummary(req.tenantId)); } catch (error) { fail(res, error, '[page-audience summary]'); }
});

/** Numbers the customers wrote in past chats, onto their leads. */
router.post('/api/admin/page-audience/backfill-phones', ...guard, bulkOperationLimiter, async (req, res) => {
  try { res.json(await audience.backfillPhones(req.tenantId)); } catch (error) { fail(res, error, '[page-audience backfill]'); }
});

/** One message to everyone whose 24-hour window is open. */
router.post('/api/admin/page-audience/message-open', ...guard, bulkOperationLimiter, async (req, res) => {
  try {
    const platform = PLATFORMS.includes(req.body?.platform) ? req.body.platform : 'messenger';
    res.json(await audience.messageOpenWindow({ tenantId: req.tenantId, platform, text: req.body?.text, staffId: req.staffRecord?.id || null }));
  } catch (error) { fail(res, error, '[page-audience message-open]'); }
});

/** The page's past conversations into the CRM and the team inbox. */
router.post('/api/admin/page-audience/import', ...guard, bulkOperationLimiter, async (req, res) => {
  try {
    const platform = PLATFORMS.includes(req.body?.platform) ? req.body.platform : 'messenger';
    const maxConversations = Math.min(2000, Math.max(10, Number(req.body?.max) || 300));
    res.json(await audience.importPageHistory({ tenantId: req.tenantId, platform, maxConversations }));
  } catch (error) { fail(res, error, '[page-audience import]'); }
});

/** Name and number of everyone who wrote and left a number — for a campaign or a custom audience. */
router.get('/api/admin/page-audience/contacts', ...guard, async (req, res) => {
  try { res.json(await audience.audienceRows(req.tenantId)); } catch (error) { fail(res, error, '[page-audience contacts]'); }
});

module.exports = router;
