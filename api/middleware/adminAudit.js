'use strict';
const logger = require('../lib/logger');
const { departmentOf, describeRequest, summarizeBody } = require('../lib/activityDescribe');

// Marking a notification read is not an act anyone looks for in the log, and a
// WhatsApp or team message an employee sends is kept with its conversation.
const NOT_WORTH_A_ROW = /^\/api\/admin\/notifications\/[^/]+\/read$|^\/api\/staff\/(whatsapp-web\/send|me\/messages)$/;

function createAdminAuditMiddleware({ pool, uuidv4, publishRealtimeEvent }) {
  return function auditAdmin(req, res, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const actor = req.user?.email || req.user?.uid || 'admin';
          const rawPath = req.originalUrl.split('?')[0];
          if (NOT_WORTH_A_ROW.test(rawPath)) return;
          const entity = rawPath.replace(/^\/api\/(admin|staff)\//, '').split('/')[0] || 'admin';
          const action = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }[req.method];
          const entityId = (req.params?.id || req.body?.id || '').toString().substring(0, 36) || null;
          // «واسم المسئول مش ايميله ومحتاجين يضاف القسم»: who, by name, in which
          // department, did what — in words — and with what. The path is kept
          // in the details so nothing the old label said is lost.
          const described = describeRequest(req.method, rawPath);
          const label = described.text.substring(0, 255);
          const actorName = req.staffRecord?.name || req.user?.name || (req.isSuperAdmin ? 'المالك' : null);
          const department = departmentOf({ role: req.staffRecord?.role, isOwner: !!req.isSuperAdmin && !req.staffRecord });
          const summary = summarizeBody(req.body);
          const details = `${req.method} ${rawPath}${summary ? `\n${summary}` : ''}`.substring(0, 2000);
          // A dropped audit row used to leave nothing behind — no row, no log
          // line, no way to know the trail has a hole in it. 52,047 rows say
          // this works; the point is being able to say so.
          pool.query(
            `INSERT INTO activity_logs (id, tenant_id, action, entity, entity_id, label, actor, actor_name, department, details)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [uuidv4(), req.tenantId, action, entity, entityId || null, label, actor, actorName, department, details]
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
