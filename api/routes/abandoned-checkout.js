'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'abandoned-checkout-route' });
const { sendAbandonedCheckoutReminders } = require('../lib/abandonedCheckout');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// POST /api/admin/automation/abandoned-checkout/run
// Sends one WhatsApp reminder per pending order older than N hours.
router.post('/api/admin/automation/abandoned-checkout/run', requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await sendAbandonedCheckoutReminders({
      hours: req.body?.hours || 24,
      limit: req.body?.limit || 100,
    });
    res.json({ ok: true, ...stats });
  } catch (error) {
    logger.error('abandoned checkout run failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
