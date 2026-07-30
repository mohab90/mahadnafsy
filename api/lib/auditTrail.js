'use strict';

const crypto = require('node:crypto');
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { auditSecretPolicy } = require('./productionConfig');
const { resolveSecret } = require('./secretResolver');

const ZERO_HASH = '0'.repeat(64);
const HASH_VERSION = 1;

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

function auditSecret() {
  const policy = auditSecretPolicy();
  if (process.env.NODE_ENV === 'production' && !policy.ok) {
    throw new Error(policy.errors.join('; '));
  }
  return resolveSecret('AUDIT_HMAC_SECRET')
    || resolveSecret('JWT_SECRET')
    || 'development-audit-key-not-for-production';
}

function canonicalAuditEvent(event) {
  return JSON.stringify([
    event.id, event.tenantId, event.actorId, event.actorRole || '',
    event.action, event.entityType, event.entityId || '', event.severity,
    event.metadataJson, event.ipAddress || '', event.userAgent || '', event.createdAt,
  ]);
}

function eventHash(previousHash, event, secret = auditSecret()) {
  return crypto.createHmac('sha256', secret)
    .update(`${previousHash || ZERO_HASH}\n${canonicalAuditEvent(event)}`)
    .digest('hex');
}

function mysqlTimestamp(value = new Date()) {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
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
  const ownsTransaction = db === pool;
  const conn = ownsTransaction ? await pool.getConnection() : db;
  const tenantId = req?.tenantId || 'tenant-default';
  const event = {
    id: uuidv4(),
    tenantId,
    actorId: String(req?.user?.uid || req?.user?.email || 'system').slice(0, 100),
    actorRole: req?.user?.role || req?.staffRecord?.role || null,
    action: String(action).slice(0, 160),
    entityType: String(entityType).slice(0, 120),
    entityId: entityId == null ? null : String(entityId).slice(0, 120),
    severity: ['info', 'warning', 'critical'].includes(severity) ? severity : 'info',
    metadataJson: JSON.stringify(safeMetadata(metadata)),
    ipAddress: req?.ip || null,
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 255) || null,
    createdAt: mysqlTimestamp(),
  };
  try {
    if (ownsTransaction) await conn.beginTransaction();
    await conn.query(
      `INSERT IGNORE INTO audit_chain_heads (tenant_id, last_hash, event_count)
       VALUES (?, ?, 0)`,
      [tenantId, ZERO_HASH]
    );
    const [[head]] = await conn.query(
      'SELECT last_hash FROM audit_chain_heads WHERE tenant_id=? FOR UPDATE',
      [tenantId]
    );
    const previousHash = head?.last_hash || ZERO_HASH;
    const hash = eventHash(previousHash, event);
    await conn.query(
      `INSERT INTO audit_logs
        (id, tenant_id, actor_id, actor_role, action, entity_type, entity_id, severity,
         metadata_json, ip_address, user_agent, previous_hash, event_hash, hash_version, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        event.id, tenantId, event.actorId, event.actorRole, event.action, event.entityType,
        event.entityId, event.severity, event.metadataJson, event.ipAddress, event.userAgent,
        previousHash, hash, HASH_VERSION, event.createdAt,
      ]
    );
    const [advanced] = await conn.query(
      `UPDATE audit_chain_heads
       SET last_hash=?, event_count=event_count+1
       WHERE tenant_id=? AND last_hash=?`,
      [hash, tenantId, previousHash]
    );
    if (advanced.affectedRows !== 1) throw new Error('Audit chain head advance failed');
    if (ownsTransaction) await conn.commit();
    return { id: event.id, eventHash: hash };
  } catch (error) {
    if (ownsTransaction) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (ownsTransaction) conn.release();
  }
}

function verifyAuditRows(rows, secret = auditSecret()) {
  let previous = null;
  let verified = 0;
  const failures = [];
  for (const row of rows) {
    if (Number(row.hash_version) !== HASH_VERSION || !row.event_hash || !row.previous_hash) continue;
    const event = {
      id: row.id,
      tenantId: row.tenant_id,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      severity: row.severity,
      metadataJson: typeof row.metadata_json === 'string' ? row.metadata_json : JSON.stringify(row.metadata_json || {}),
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at_canonical || mysqlTimestamp(row.created_at),
    };
    const hashMatches = eventHash(row.previous_hash, event, secret) === row.event_hash;
    const chainMatches = previous === null || row.previous_hash === previous;
    if (!hashMatches || !chainMatches) failures.push(row.id);
    else verified += 1;
    previous = row.event_hash;
  }
  return {
    valid: failures.length === 0,
    verified,
    legacy: rows.length - verified - failures.length,
    failures,
  };
}

module.exports = {
  HASH_VERSION,
  ZERO_HASH,
  auditSecretPolicy,
  canonicalAuditEvent,
  eventHash,
  mysqlTimestamp,
  safeMetadata,
  verifyAuditRows,
  writeAuditEvent,
};
