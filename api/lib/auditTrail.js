'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');

function safeMetadata(metadata) {
  const blocked = /secret|token|password|api[_-]?key|credential|authorization|code|recipient|\bto\b/i;
  const walk = (value, depth = 0) => {
    if (depth > 5) return '[truncated]';
    if (Array.isArray(value)) return value.slice(0, 50).map(item => walk(item, depth + 1));
    if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 500) : value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !blocked.test(key))
      .slice(0, 50)
      .map(([key, item]) => [key, walk(item, depth + 1)]));
  };
  return walk(metadata || {});
}

async function writeAuditEvent({
  action,
  entityType,
  entityId = null,
  severity = 'info',
  metadata = {},
  req,
  db = pool,
}) {
  if (!action || !entityType) throw new Error('Audit action and entity type are required');
  const actorId = req?.user?.uid || req?.user?.email || 'system';
  const actorRole = req?.user?.role || req?.staffRecord?.role || null;
  await db.query(
    `INSERT INTO audit_logs
      (id, tenant_id, actor_id, actor_role, action, entity_type, entity_id, severity, metadata_json, ip_address, user_agent)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      uuidv4(), req?.tenantId || 'tenant-default', String(actorId).slice(0, 100), actorRole,
      String(action).slice(0, 160), String(entityType).slice(0, 120), entityId,
      severity, JSON.stringify(safeMetadata(metadata)), req?.ip || null,
      String(req?.headers?.['user-agent'] || '').slice(0, 255) || null,
    ]
  );
}

module.exports = { safeMetadata, writeAuditEvent };
