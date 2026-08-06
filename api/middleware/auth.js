'use strict';
const logger = require('../lib/logger');
// ── Auth Middleware ───────────────────────────────────────────────────────────
const jwt  = require('jsonwebtoken');
const { pool } = require('../lib/db');
const { JWT_SECRET, tokenBlacklist } = require('../lib/token');
const { writeAuditEvent } = require('../lib/auditTrail');
const {
  listEnv,
  PLATFORM_ADMIN_EMAILS,
  PLATFORM_ADMIN_UIDS,
  isPlatformAdminIdentity,
} = require('../lib/platformAccess');
const {
  findActiveStaff: findTenantStaff,
  getTrustedTenantId,
  tenantIdFromPayload,
} = require('../lib/authTenant');
const {
  FULL_ACCESS_ROLES,
  ROLE_PERMS,
  resolvePermissions,
  hasPermission: _hasPermission,
} = require('../constants/permissions');
const { getMfaPolicy, policyRequiresStaff } = require('../lib/mfaPolicy');
const { getClientIp, hashClientIp } = require('../lib/clientContext');

const ADMIN_EMAILS = listEnv('ADMIN_EMAILS');
const ADMIN_UIDS = listEnv('ADMIN_UIDS');
async function activeIdentity(tenantId, payload) {
  if (!payload.uid && !payload.email) return null;
  const [[user]] = await pool.query(
    `SELECT is_active,session_version,totp_enabled,active_session_id,active_session_ip_hash,name FROM users
      WHERE tenant_id=? AND (id=? OR (?<>'' AND LOWER(TRIM(email))=?)) LIMIT 1`,
    [tenantId, payload.uid || '', String(payload.email || '').toLowerCase().trim(),
      String(payload.email || '').toLowerCase().trim()]
  );
  const identity = user
    ? {
      active: Boolean(user.is_active),
      sessionVersion: Number(user.session_version),
      mfaEnrolled: Boolean(user.totp_enabled),
      sessionId: user.active_session_id || null,
      sessionIpHash: user.active_session_ip_hash || null,
      name: user.name || null,
    }
    : null;
  return identity;
}

// Pin the session to the exact IP it was opened from? Off by default.
//
// It used to be unconditional, and it was ejecting people constantly: `trust
// proxy` is on, so req.ip is the real client address, and Egyptian mobile
// carriers (the 196.x / 178.x CGNAT ranges in login_history) hand out a new
// address whenever a phone changes cell or moves between WiFi and data. Every
// one of those rotations failed the equality check and forced a fresh sign-in,
// which is what "بيخرج كل شوية" was.
//
// What actually stops account sharing is the pair below it — one live session
// id per account, so a second sign-in evicts the first — plus
// lib/accountSharingGuard.js, which locks an account that logs in from more
// than ACCOUNT_MAX_DISTINCT_IPS networks inside a rolling window. That guard
// exists precisely because, in its own words, phones re-IP constantly; hard
// pinning contradicted it. Set SESSION_PIN_IP=true to restore the old
// behaviour on a fixed-line-only deployment.
const SESSION_PIN_IP = String(process.env.SESSION_PIN_IP || '').toLowerCase() === 'true';

function hasCurrentSession(payload, identity, req) {
  if (!identity?.active) return false;

  // session_version is the revocation counter: a password change, a forced
  // sign-out, or a sharing lock bumps it and every existing token dies. That
  // check applies to everybody.
  if (!Number.isInteger(Number(payload.sv)) || Number(payload.sv) !== identity.sessionVersion) return false;
  if (!payload.sid) return false;

  // active_session_id is the ONE-DEVICE rule, and it only makes sense for
  // customers. It is there to stop a paid account being shared around, so the
  // asset it protects is course video.
  //
  // Applying it to staff was the remaining cause of "the system logs me out
  // every few minutes": every login rotates session_version and replaces
  // active_session_id, so an owner with the dashboard open on a laptop and
  // anything else open on a phone — or the admin panel plus the public site,
  // which are the same account — evicted himself on each sign-in. Staff sharing
  // a password is not the piracy threat; content piracy is. Staff therefore get
  // concurrent devices, and lose nothing else: revocation, MFA and the sharing
  // guard all still apply to them.
  if (payload.stf !== true && payload.sid !== identity.sessionId) return false;

  if (!SESSION_PIN_IP) return true;
  const requestIp = getClientIp(req);
  return Boolean(requestIp && hashClientIp(requestIp) === identity.sessionIpHash);
}

// Kept as a compatibility hook for callers. Session truth is intentionally
// read from MySQL on every authenticated request so another instance/login
// cannot remain valid behind a process-local cache.
function invalidateIdentity() {}

async function requirePlatformAdmin(req, res, next) {
  const allowed = isPlatformAdminIdentity(req.user);
  if (!allowed) {
    writeAuditEvent({
      action: 'platform_access_denied',
      entityType: 'control_plane',
      entityId: `${req.method} ${req.originalUrl || req.path || ''}`.slice(0, 255),
      severity: 'warning',
      metadata: { method: req.method, path: req.originalUrl || req.path || '' },
      req,
    }).catch(error => logger.error('[requirePlatformAdmin audit denied]', error.message));
    return res.status(403).json({ error: 'Platform administrator only', code: 'PLATFORM_ADMIN_REQUIRED' });
  }

  req.isPlatformAdmin = true;
  if (!await enforceMfa(req, res, null, [], true)) return;
  try {
    await writeAuditEvent({
      action: 'platform_access_granted',
      entityType: 'control_plane',
      entityId: `${req.method} ${req.originalUrl || req.path || ''}`.slice(0, 255),
      severity: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? 'info' : 'critical',
      metadata: { method: req.method, path: req.originalUrl || req.path || '' },
      req,
    });
    return next();
  } catch (error) {
    logger.error('[requirePlatformAdmin audit]', error.message);
    return res.status(503).json({ error: 'Platform audit unavailable', code: 'PLATFORM_AUDIT_REQUIRED' });
  }
}

async function findActiveStaff(req, email, includePermissions = false) {
  return findTenantStaff(req, email, {
    includePermissions,
    query: pool.query.bind(pool),
  });
}

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
        const tenantId = getTrustedTenantId(req, tenantIdFromPayload(payload));
        if (!tenantId) return next();
        const identity = await activeIdentity(tenantId, payload);
        if (!hasCurrentSession(payload, identity, req)) return next();
        req.user = {
          uid: payload.uid,
          email: payload.email,
          jti: payload.jti,
          session_version: identity.sessionVersion,
          session_id: identity.sessionId,
          mfa_enrolled: identity.mfaEnrolled,
          mfa_verified: payload.mfa === true,
          name: identity.name,
          tenant_id: tenantId,
        };
      }
    } catch { /* invalid token — proceed as unauthenticated */ }
  }
  next();
}

async function requireAuth(req, res, next) {
  if (req.user?.uid && req.user?.tenant_id === req.tenantId) return next();
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
    const tenantId = getTrustedTenantId(req, tenantIdFromPayload(payload));
    if (!tenantId) {
      return res.status(403).json({ error: 'Token tenant does not match request tenant', code: 'TENANT_MISMATCH' });
    }
    const identity = await activeIdentity(tenantId, payload);
    if (!identity?.active) {
      return res.status(401).json({ error: 'Account disabled or unavailable', code: 'ACCOUNT_UNAVAILABLE' });
    }
    if (!hasCurrentSession(payload, identity, req)) {
      return res.status(401).json({
        error: 'Session expired, replaced, or opened from another IP; please sign in again',
        code: 'SESSION_REVOKED',
      });
    }
    req.user = {
      uid: payload.uid,
      email: payload.email,
      jti: payload.jti,
      exp: payload.exp,
      session_version: identity.sessionVersion,
      session_id: identity.sessionId,
      mfa_enrolled: identity.mfaEnrolled,
      mfa_verified: payload.mfa === true,
      name: identity.name,
      tenant_id: tenantId,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Roles that grant full admin-level access — imported from master constants
// const FULL_ACCESS_ROLES is already imported above

async function requireAdmin(req, res, next) {
  const { email, uid } = req.user || {};
  if (ADMIN_EMAILS.includes(email) || ADMIN_UIDS.includes(uid)) {
    req.isSuperAdmin = true;
    if (await enforceMfa(req, res, null, [], true)) return next();
    return;
  }
  // Also allow staff members whose role grants full (*) permissions
  try {
    const staff = await findActiveStaff(req, email);
    if (staff && FULL_ACCESS_ROLES.includes((staff.role || '').toLowerCase())) {
      req.staffRecord = staff;
      req.isSuperAdmin = true;
      if (await enforceMfa(req, res, staff, [], true)) return next();
      return;
    }
  } catch (e) { logger.error('[requireAdmin]', e.message); }
  res.status(403).json({ error: 'Admin only' });
}

// Stricter than requireAdmin: ONLY true admins (ADMIN_EMAILS/UIDS) + the 'manager'
// role. Used for privilege-sensitive actions (create/delete staff, set password,
// toggle active, create staff accounts). Excludes online_manager/daqqi_manager so
// they cannot escalate privileges — their operational access (which uses
// requireAdmin) is unchanged.
const SUPER_ADMIN_ROLES = ['admin', 'manager'];
async function requireSuperAdmin(req, res, next) {
  const { email, uid } = req.user || {};
  if (ADMIN_EMAILS.includes(email) || ADMIN_UIDS.includes(uid)) {
    req.isSuperAdmin = true;
    if (await enforceMfa(req, res, null, [], true)) return next();
    return;
  }
  try {
    const staff = await findActiveStaff(req, email);
    if (staff && SUPER_ADMIN_ROLES.includes((staff.role || '').toLowerCase())) {
      req.staffRecord = staff;
      req.isSuperAdmin = true;
      if (await enforceMfa(req, res, staff, [], true)) return next();
      return;
    }
  } catch (e) { logger.error('[requireSuperAdmin]', e.message); }
  res.status(403).json({ error: 'غير مصرح — إدارة الموظفين للمدير العام فقط' });
}

async function requireAdminOrOnlineManager(req, res, next) {
  const { email, uid } = req.user || {};
  if (ADMIN_EMAILS.includes(email) || ADMIN_UIDS.includes(uid)) {
    req.isSuperAdmin = true;
    if (await enforceMfa(req, res, null, [], true)) return next();
    return;
  }
  try {
    const staff = await findActiveStaff(req, email);
    if (staff && (FULL_ACCESS_ROLES.includes((staff.role || '').toLowerCase()) || (staff.role || '').toLowerCase() === 'online_manager')) {
      req.staffRecord = staff;
      if (FULL_ACCESS_ROLES.includes((staff.role || '').toLowerCase())) req.isSuperAdmin = true;
      if (await enforceMfa(req, res, staff, [], Boolean(req.isSuperAdmin))) return next();
      return;
    }
  } catch (e) { logger.error('[requireAdminOrOnlineManager]', e.message); }
  res.status(403).json({ error: 'Insufficient permissions' });
}

async function requireAdminOrOnlineManagerOrCollection(req, res, next) {
  const { email, uid } = req.user || {};
  if (ADMIN_EMAILS.includes(email) || ADMIN_UIDS.includes(uid)) {
    req.isSuperAdmin = true;
    if (await enforceMfa(req, res, null, [], true)) return next();
    return;
  }
  try {
    const staff = await findActiveStaff(req, email);
    if (staff && (FULL_ACCESS_ROLES.includes((staff.role || '').toLowerCase()) || ['online_manager', 'collection'].includes((staff.role || '').toLowerCase()))) {
      req.staffRecord = staff;
      if (FULL_ACCESS_ROLES.includes((staff.role || '').toLowerCase())) req.isSuperAdmin = true;
      if (await enforceMfa(req, res, staff, [], Boolean(req.isSuperAdmin))) return next();
      return;
    }
  } catch (e) { logger.error('[requireAdminOrOnlineManagerOrCollection]', e.message); }
  res.status(403).json({ error: 'Insufficient permissions' });
}

async function requireAdminOrStaff(req, res, next) {
  const { email, uid } = req.user || {};
  if (ADMIN_EMAILS.includes(email) || ADMIN_UIDS.includes(uid)) {
    req.isSuperAdmin = true;
    return next();
  }
  try {
    const staff = await findActiveStaff(req, email, true);
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
  return async function(req, res, next) {
    if (req.isSuperAdmin) {
      if (await enforceMfa(req, res, req.staffRecord, [permission], true)) return next();
      return;
    }
    if (!req.staffRecord) return res.status(403).json({ error: 'Staff record not found' });
    if (_hasPermission(req.staffRecord, permission)) {
      if (await enforceMfa(req, res, req.staffRecord, [permission])) return next();
      return;
    }
    res.status(403).json({ error: `Permission denied: ${permission}` });
  };
}

async function enforceMfa(req, res, staff = req.staffRecord, requestedPermissions = [], force = false) {
  try {
    const policy = await getMfaPolicy(req.tenantId);
    if (!policy.enabled || (!force && !policyRequiresStaff(policy, staff, requestedPermissions))) return true;
    if (req.user?.mfa_verified) return true;
    const enrolled = Boolean(req.user?.mfa_enrolled);
    res.status(403).json({
      error: enrolled
        ? 'Multi-factor authentication is required for this action'
        : 'Multi-factor authentication enrollment is required for this account',
      code: enrolled ? 'MFA_REQUIRED' : 'MFA_ENROLLMENT_REQUIRED',
    });
    return false;
  } catch (error) {
    logger.error('[enforceMfa]', error.message);
    res.status(503).json({ error: 'MFA policy unavailable', code: 'MFA_POLICY_UNAVAILABLE' });
    return false;
  }
}

function requireAnyPermission(...permissions) {
  return async function(req, res, next) {
    if (req.isSuperAdmin) {
      if (await enforceMfa(req, res, req.staffRecord, permissions, true)) return next();
      return;
    }
    if (!req.staffRecord) return res.status(403).json({ error: 'Staff record not found' });
    if (permissions.some(permission => _hasPermission(req.staffRecord, permission))) {
      if (await enforceMfa(req, res, req.staffRecord, permissions)) return next();
      return;
    }
    return res.status(403).json({ error: `Permission denied: one of ${permissions.join(', ')}` });
  };
}

module.exports = {
  ADMIN_EMAILS, ADMIN_UIDS, PLATFORM_ADMIN_EMAILS, PLATFORM_ADMIN_UIDS,
  ROLE_DEFAULT_PERMISSIONS_BE, isPlatformAdminIdentity,
  optionalAuth, requireAuth, requireAdmin, requireSuperAdmin, requirePlatformAdmin,
  requireAdminOrOnlineManager, requireAdminOrOnlineManagerOrCollection,
  requireAdminOrStaff, requirePermission, requireAnyPermission, enforceMfa, invalidateIdentity,
};
