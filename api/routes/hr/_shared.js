'use strict';
const logger = require('../../lib/logger');
const { pool, getStaffIdByEmail } = require('../../lib/db');
const { tryJson } = require('../../lib/helpers');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission, requireAnyPermission, invalidateIdentity } = require('../../middleware/auth');
const { createNotification } = require('../../lib/notification');
const { uuidv4 } = require('../../lib/id');
const { postJournalEntry, toEgp, getFxToEgp, logFinancialAudit } = require('../../lib/finance');

async function _resolveStaffByUser(req) {
  const email = req.user?.email?.toLowerCase().trim();
  if (!email) return null;
  const [[st]] = await pool.query(
    'SELECT id, name FROM staff WHERE tenant_id=? AND LOWER(TRIM(email))=? AND is_active=1 AND deleted_at IS NULL LIMIT 1',
    [req.tenantId, email]
  );
  return st || null;
}

module.exports = { requirePermission, requireAnyPermission, logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, invalidateIdentity, _resolveStaffByUser };
