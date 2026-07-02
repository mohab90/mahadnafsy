'use strict';
const logger = require('../../lib/logger');
const { pool, getStaffIdByEmail } = require('../../lib/db');
const { tryJson } = require('../../lib/helpers');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../../middleware/auth');
const { createNotification } = require('../../lib/notification');
const { uuidv4 } = require('../../lib/id');
const { postJournalEntry, toEgp, getFxToEgp, logFinancialAudit } = require('../../lib/finance');

async function _resolveStaffByUser(req) {
  const email = req.user?.email?.toLowerCase().trim();
  if (!email) return null;
  const [[st]] = await pool.query('SELECT id, name FROM staff WHERE LOWER(TRIM(email))=? LIMIT 1', [email]);
  return st || null;
}

module.exports = { logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, _resolveStaffByUser };
