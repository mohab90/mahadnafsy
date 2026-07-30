'use strict';

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
          pool.query(
            'INSERT INTO activity_logs (id, tenant_id, action, entity, entity_id, label, actor) VALUES (?,?,?,?,?,?,?)',
            [uuidv4(), req.tenantId, action, entity, entityId || null, label, actor]
          ).catch(() => {});
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
