'use strict';

const { pool } = require('../lib/db');
const logger = require('../lib/logger').child({ middleware: 'tenantQuota' });
const { loadTenantContext } = require('../lib/tenantScope');

const RESOURCES = Object.freeze({
  staff: {
    countSql: 'SELECT COUNT(*) AS total FROM staff WHERE tenant_id=? AND deleted_at IS NULL',
    existsSql: `SELECT id FROM staff
      WHERE tenant_id=? AND (id=? OR (?<>'' AND LOWER(TRIM(email))=?)) LIMIT 1`,
  },
  courses: {
    countSql: 'SELECT COUNT(*) AS total FROM courses WHERE tenant_id=? AND deleted_at IS NULL',
    existsSql: `SELECT id FROM courses
      WHERE tenant_id=? AND (id=? OR (?<>'' AND slug=?)) LIMIT 1`,
  },
  users: {
    countSql: 'SELECT COUNT(*) AS total FROM users WHERE tenant_id=? AND is_active=1',
    existsSql: `SELECT id FROM users
      WHERE tenant_id=? AND (id=? OR (?<>'' AND LOWER(TRIM(email))=?)) LIMIT 1`,
  },
  branches: {
    countSql: 'SELECT COUNT(*) AS total FROM branches WHERE tenant_id=? AND is_active=1',
    existsSql: `SELECT id FROM branches
      WHERE tenant_id=? AND (id=? OR (?<>'' AND slug=?)) LIMIT 1`,
  },
});

function positiveLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function quotaIdentity(req, resource) {
  const body = req.body || {};
  if (resource === 'staff' || resource === 'users') {
    return { id: String(body.id || body.staffId || ''), secondary: String(body.email || '').toLowerCase().trim() };
  }
  return { id: String(body.id || ''), secondary: String(body.slug || '').trim() };
}

async function releaseQuotaLock(conn, name) {
  if (!conn) return;
  await conn.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => {});
  conn.release();
}

function requireTenantQuota(resource, { increment = 1 } = {}) {
  const definition = RESOURCES[resource];
  if (!definition) throw new Error(`Unsupported tenant quota resource: ${resource}`);
  return async function tenantQuotaGuard(req, res, next) {
    let conn;
    let lockName;
    try {
      const tenantId = String(req.tenantId || 'tenant-default');
      const context = req.tenantContext || await loadTenantContext(tenantId);
      const limit = positiveLimit(context.planLimits?.[resource]);
      if (limit === null) return next();
      const requested = Math.max(1, Number(typeof increment === 'function' ? increment(req) : increment) || 1);

      const identity = quotaIdentity(req, resource);
      const normalizedSecondary = identity.secondary;
      const [[existing]] = await pool.query(definition.existsSql, [
        tenantId, identity.id, normalizedSecondary, normalizedSecondary,
      ]);
      if (existing) return next();

      conn = await pool.getConnection();
      lockName = `quota:${tenantId}:${resource}`.slice(0, 64);
      const [[lock]] = await conn.query('SELECT GET_LOCK(?, 5) AS acquired', [lockName]);
      if (Number(lock?.acquired) !== 1) {
        await releaseQuotaLock(conn, lockName);
        return res.status(503).json({ error: 'Quota check busy; retry shortly', code: 'QUOTA_CHECK_BUSY' });
      }
      const [[usage]] = await conn.query(definition.countSql, [tenantId]);
      if (Number(usage?.total || 0) + requested > limit) {
        await releaseQuotaLock(conn, lockName);
        return res.status(409).json({
          error: `Tenant plan ${resource} quota exceeded`,
          code: 'PLAN_QUOTA_EXCEEDED',
          resource,
          limit,
          used: Number(usage?.total || 0),
          requested,
        });
      }

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        releaseQuotaLock(conn, lockName).catch(error => logger.error('quota lock release failed', error));
      };
      res.once('finish', release);
      res.once('close', release);
      return next();
    } catch (error) {
      if (conn) await releaseQuotaLock(conn, lockName);
      logger.error('quota check failed', error);
      return res.status(503).json({ error: 'Tenant quota check failed', code: 'QUOTA_CHECK_FAILED' });
    }
  };
}

module.exports = { requireTenantQuota, _test: { positiveLimit, quotaIdentity } };
