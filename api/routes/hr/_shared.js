'use strict';
const logger = require('../../lib/logger');
const { pool, getStaffIdByEmail } = require('../../lib/db');
const { tryJson } = require('../../lib/helpers');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission, requireAnyPermission, invalidateIdentity } = require('../../middleware/auth');
const { createNotification } = require('../../lib/notification');
const { uuidv4 } = require('../../lib/id');
const { postJournalEntry, toEgp, getFxToEgp, logFinancialAudit } = require('../../lib/finance');
const { sendWriteError } = require('../../lib/writeErrors');

async function _resolveStaffByUser(req) {
  const email = req.user?.email?.toLowerCase().trim();
  if (!email) return null;
  const [[st]] = await pool.query(
    'SELECT id, name FROM staff WHERE tenant_id=? AND LOWER(TRIM(email))=? AND is_active=1 AND deleted_at IS NULL LIMIT 1',
    [req.tenantId, email]
  );
  return st || null;
}

/**
 * What an HR handler answers with when a write is refused.
 *
 * Every handler in this directory ended with a bare 500, which the screens
 * print verbatim — so a duplicate row, a missing required field and a genuine
 * fault all read the same. The 500 stays for real faults; the conditions the
 * person at the keyboard can fix are named. The mapping lives in
 * lib/writeErrors.js so it can be tested without standing up auth and the pool.
 */
function hrError(res, error, message = 'HR route failed') {
  logger.error(message, error?.message || error);
  return sendWriteError(res, error);
}

module.exports = { hrError, requirePermission, requireAnyPermission, logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, invalidateIdentity, _resolveStaffByUser };
