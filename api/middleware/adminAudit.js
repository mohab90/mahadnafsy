'use strict';
const logger = require('../lib/logger');

function createAdminAuditMiddleware({ pool, uuidv4, publishRealtimeEvent }) {
  return function auditAdmin(req, res, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const actor = req.user?.email || req.user?.uid || 'admin';
          const rawPath = req.originalUrl.split('?')[0];
          const entity = rawPath.replace(/^\/api\/admin\//, '').split('/')[0] || 'admin';
          const action = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }[req.method];
          const entityId = (req.params?.id || req.body?.id || '').toString().substring(0, 36) || null;
          const label = `${action} ${rawPath}`.substring(0, 255);
          // A dropped audit row used to leave nothing behind — no row, no log
          // line, no way to know the trail has a hole in it. 52,047 rows say
          // this works; the point is being able to say so.
          pool.query(
            'INSERT INTO activity_logs (id, tenant_id, action, entity, entity_id, label, actor) VALUES (?,?,?,?,?,?,?)',
            [uuidv4(), req.tenantId, action, entity, entityId || null, label, actor]
          ).catch(error => {
            logger.error('[audit] activity log write failed — the trail is incomplete', {
              action, entity, entityId, actor, path: rawPath, err: error.message,
            });
          });
          if (publishRealtimeEvent) {
            publishRealtimeEvent('admin:mutation', {
              action, entity, entityId, label, actor, path: rawPath, at: new Date().toISOString(),
            }).catch(() => {});
          }
        } catch (_) {}
      }
    });
    next();
  };
}

module.exports = { createAdminAuditMiddleware };
