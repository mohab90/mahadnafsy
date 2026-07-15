'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'loyalty-route' });
const { pool } = require('../lib/db');
const { awardPoints, redeemPoints, getBalance, listLedger } = require('../lib/loyalty');
const { requireAuth, requireAdmin } = require('../middleware/auth');

function sendError(res, error, message = 'loyalty route failed') {
  logger.error(message, error);
  return res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
}

async function subscriberIdForUser(req) {
  const email = String(req.user?.email || '').trim().toLowerCase();
  const uid = req.user?.uid || '';
  const [[row]] = await pool.query(
    `SELECT id FROM subscribers
     WHERE firebase_uid = ? OR LOWER(TRIM(email)) = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [uid, email]
  );
  return row?.id || null;
}

// GET /api/me/loyalty
router.get('/api/me/loyalty', requireAuth, async (req, res) => {
  try {
    const subscriberId = await subscriberIdForUser(req);
    if (!subscriberId) return res.status(404).json({ error: 'subscriber not found' });
    const [balance, ledger] = await Promise.all([
      getBalance(subscriberId),
      listLedger(subscriberId, req.query.limit),
    ]);
    res.json({ ok: true, subscriberId, balance, ledger });
  } catch (e) {
    sendError(res, e, 'my loyalty fetch failed');
  }
});

// GET /api/admin/subscribers/:id/loyalty
router.get('/api/admin/subscribers/:id/loyalty', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [balance, ledger] = await Promise.all([
      getBalance(req.params.id),
      listLedger(req.params.id, req.query.limit),
    ]);
    res.json({ ok: true, subscriberId: req.params.id, balance, ledger });
  } catch (e) {
    sendError(res, e, 'admin loyalty fetch failed');
  }
});

// POST /api/admin/subscribers/:id/loyalty/award
router.post('/api/admin/subscribers/:id/loyalty/award', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await awardPoints(req.params.id, req.body?.points, {
      reason: req.body?.reason || 'admin_award',
      referenceType: req.body?.referenceType || 'admin',
      referenceId: req.body?.referenceId || null,
      createdBy: req.user?.email || req.user?.uid || null,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    sendError(res, e, 'admin loyalty award failed');
  }
});

// POST /api/admin/subscribers/:id/loyalty/redeem
router.post('/api/admin/subscribers/:id/loyalty/redeem', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await redeemPoints(req.params.id, req.body?.points, {
      reason: req.body?.reason || 'admin_redeem',
      referenceType: req.body?.referenceType || 'admin',
      referenceId: req.body?.referenceId || null,
      createdBy: req.user?.email || req.user?.uid || null,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    sendError(res, e, 'admin loyalty redeem failed');
  }
});

module.exports = router;
