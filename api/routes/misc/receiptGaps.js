'use strict';

// GET /api/admin/receipts/gaps — a branch's receipts that are not where they should be.
//
// «ولو وقع رقم يظهر للمديرين ان في مشكلة في ايصال رقم كذا مش موجود» (13 Oct 2026). Dokki's
// and Tagamoa's receipts run 1, 2, 3… (payments.receipt_no, lib/receiptNumbers.js). A number
// below the highest with no payment is MISSING; one whose payment was deleted is REMOVED.
// The managers are shown which, per branch — a branch's own manager, only theirs.

const express = require('express');
const { pool } = require('../../lib/db');
const logger = require('../../lib/logger');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { PHYSICAL_BRANCHES, PHYSICAL_BRANCH_KEYS, boundBranch } = require('../../lib/physicalBranches');
const { findReceiptGaps } = require('../../lib/receiptNumbers');

const router = express.Router();
// The people this is for: the owner, the managers, accounts and a branch's own manager.
const GAP_VIEWERS = new Set(['admin', 'manager', 'accountant', 'online_manager', 'sales_collection_manager', 'daqqi_manager', 'tagamoa_manager']);

router.get('/api/admin/receipts/gaps', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    if (!req.isSuperAdmin && !GAP_VIEWERS.has(String(req.staffRecord?.role || '').toLowerCase())) {
      return res.status(403).json({ error: 'غير مصرح', code: 'MANAGERS_ONLY' });
    }
    const bound = boundBranch(req);
    const branches = bound ? [bound] : PHYSICAL_BRANCH_KEYS;
    const found = await findReceiptGaps(pool, { tenantId: req.tenantId, branches });
    const result = found.map(entry => ({
      branch: entry.branch,
      label: PHYSICAL_BRANCHES[entry.branch]?.label || entry.branch,
      highest: entry.highest,
      count: entry.count,
      missing: entry.missing,
      removed: entry.removed.map(row => ({
        receiptNo: row.receiptNo, paymentId: row.paymentId, amount: row.amount, currency: row.currency, date: row.date, staffName: row.staffName,
      })),
      ok: entry.missing.length === 0 && entry.removed.length === 0,
    }));
    res.json({ branches: result, problems: result.reduce((sum, entry) => sum + entry.missing.length + entry.removed.length, 0) });
  } catch (error) {
    logger.error('[receipt-gaps]', error.message);
    res.status(500).json({ error: 'تعذّر فحص تسلسل الإيصالات' });
  }
});

module.exports = router;
