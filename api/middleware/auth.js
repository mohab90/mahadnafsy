'use strict';
const logger = require('../lib/logger');
// ── Auth Middleware ───────────────────────────────────────────────────────────
const jwt  = require('jsonwebtoken');
const { pool } = require('../lib/db');
const { JWT_SECRET, tokenBlacklist } = require('../lib/token');
const {
  FULL_ACCESS_ROLES,
  ROLE_PERMS,
  resolvePermissions,
  hasPermission: _hasPermission,
} = require('../constants/permissions');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').filter(Boolean);
const ADMIN_UIDS   = (process.env.ADMIN_UIDS   || '').split(',').filter(Boolean);

// Optional auth — populates req.user if a valid token is present, but never rejects
async function optionalAuth(req, res, next) {
  let token = null;
  const cookieHeader = req.headers.cookie || '';
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)authToken=([^;]+)/);
  if (cookieMatch) token = decodeURIComponent(cookieMatch[1]);
  if (!token) {
    const header = req.headers.authorization || '';
    token = header.startsWith('Bearer ') ? header.slice(7) : null;
  }
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (!payload.jti || !tokenBlacklist.has(payload.jti)) {
        req.user = { uid: payload.uid, email: payload.email, jti: payload.jti };
      }
    } catch { /* invalid token — proceed as unauthenticated */ }
  }
  next();
}

async function requireAuth(req, res, next) {
  let token = null;
  const cookieHeader = req.headers.cookie || '';
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)authToken=([^;]+)/);
  if (cookieMatch) token = decodeURIComponent(cookieMatch[1]);
  if (!token) {
    const header = req.headers.authorization || '';
    token = header.startsWith('Bearer ') ? header.slice(7) : null;
  }
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.jti && tokenBlacklist.has(payload.jti)) {
      return res.status(401).json({ error: 'Token revoked' });
    }
    req.user = { uid: payload.uid, email: payload.email, jti: payload.jti };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Roles that grant full admin-level access — imported from master constants
// const FULL_ACCESS_ROLES is already imported above

async function requireAdmin(req, res, next) {
  const { email, uid } = req.user || {};
  if (ADMIN_EMAILS.includes(email) || ADMIN_UIDS.includes(uid)) return next();
  // Also allow staff members whose role grants full (*) permissions
  try {
    const [[staff]] = await pool.query(
      `SELECT id, role FROM staff WHERE LOWER(TRIM(email)) COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1`,
      [(email || '').toLowerCase().trim()]
    );
    if (staff && FULL_ACCESS_ROLES.includes((staff.role || '').toLowerCase())) {
      req.staffRecord = staff;
      req.isSuperAdmin = true;
      return next();
    }
  } catch (e) { logger.error('[requireAdmin]', e.message); }
  res.status(403).json({ error: 'Admin only' });
}

async function requireAdminOrOnlineManager(req, res, next) {
  const { email, uid } = req.user || {};
  if (ADMIN_EMAILS.includes(email) || ADMIN_UIDS.includes(uid)) { req.isSuperAdmin = true; return next(); }
  try {
    const [[staff]] = await pool.query(
      `SELECT id, role FROM staff WHERE LOWER(TRIM(email)) COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1`,
      [(email || '').toLowerCase().trim()]
    );
    if (staff && (staff.role || '').toLowerCase() === 'online_manager') { req.staffRecord = staff; return next(); }
  } catch (e) { logger.error('[requireAdminOrOnlineManager]', e.message); }
  res.status(403).json({ error: 'Insufficient permissions' });
}

async function requireAdminOrOnlineManagerOrCollection(req, res, next) {
  const { email, uid } = req.user || {};
  if (ADMIN_EMAILS.includes(email) || ADMIN_UIDS.includes(uid)) { req.isSuperAdmin = true; return next(); }
  try {
    const [[staff]] = await pool.query(
      `SELECT id, role FROM staff WHERE LOWER(TRIM(email)) COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1`,
      [(email || '').toLowerCase().trim()]
    );
    if (staff && ['online_manager', 'collection'].includes((staff.role || '').toLowerCase())) { req.staffRecord = staff; return next(); }
  } catch (e) { logger.error('[requireAdminOrOnlineManagerOrCollection]', e.message); }
  res.status(403).json({ error: 'Insufficient permissions' });
}

async function requireAdminOrStaff(req, res, next) {
  const { email } = req.user || {};
  if (ADMIN_EMAILS.includes(email)) {
    req.isSuperAdmin = true;
    return next();
  }
  try {
    const [[staff]] = await pool.query(
      'SELECT id, role, permissions_json FROM staff WHERE email COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1',
      [email]
    );
    if (staff) {
      req.staffRecord = staff;
      if (staff.permissions_json && typeof staff.permissions_json === 'string') {
        try { req.staffRecord.permissionsArr = JSON.parse(staff.permissions_json); } catch (_) { req.staffRecord.permissionsArr = []; }
      } else if (Array.isArray(staff.permissions_json)) {
        req.staffRecord.permissionsArr = staff.permissions_json;
      } else {
        req.staffRecord.permissionsArr = [];
      }
      return next();
    }
  } catch (e) { logger.error('[requireAdminOrStaff]', e.message); }
  res.status(403).json({ error: 'Admin only' });
}

// Role-based default permissions — imported from master constants (api/constants/permissions.js)
// DO NOT duplicate here. Use ROLE_PERMS from the import above.
const ROLE_DEFAULT_PERMISSIONS_BE = ROLE_PERMS; // backwards-compat alias

function requirePermission(permission) {
  return function(req, res, next) {
    if (req.isSuperAdmin) return next();
    if (!req.staffRecord) return res.status(403).json({ error: 'Staff record not found' });
    if (_hasPermission(req.staffRecord, permission)) return next();
    res.status(403).json({ error: `Permission denied: ${permission}` });
  };
}

module.exports = {
  ADMIN_EMAILS, ADMIN_UIDS, ROLE_DEFAULT_PERMISSIONS_BE,
  optionalAuth, requireAuth, requireAdmin,
  requireAdminOrOnlineManager, requireAdminOrOnlineManagerOrCollection,
  requireAdminOrStaff, requirePermission,
};
