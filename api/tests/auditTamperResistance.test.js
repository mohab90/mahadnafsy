'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ZERO_HASH,
  eventHash,
  verifyAuditRows,
} = require('../lib/auditTrail');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

function row(previousHash, overrides = {}) {
  const base = {
    id: 'audit-1',
    tenant_id: 'tenant-a',
    actor_id: 'user-1',
    actor_role: 'manager',
    action: 'payment.approved',
    entity_type: 'payment',
    entity_id: 'pay-1',
    severity: 'critical',
    metadata_json: '{"amount":100}',
    ip_address: '127.0.0.1',
    user_agent: 'unit-test',
    created_at_canonical: '2026-07-25 12:00:00',
    previous_hash: previousHash,
    hash_version: 1,
    ...overrides,
  };
  base.event_hash = eventHash(previousHash, {
    id: base.id,
    tenantId: base.tenant_id,
    actorId: base.actor_id,
    actorRole: base.actor_role,
    action: base.action,
    entityType: base.entity_type,
    entityId: base.entity_id,
    severity: base.severity,
    metadataJson: base.metadata_json,
    ipAddress: base.ip_address,
    userAgent: base.user_agent,
    createdAt: base.created_at_canonical,
  }, 'audit-test-secret');
  return base;
}

test('audit chain verifies intact events and detects field or link tampering', () => {
  const first = row(ZERO_HASH);
  const second = row(first.event_hash, { id: 'audit-2', action: 'refund.approved' });
  assert.equal(verifyAuditRows([first, second], 'audit-test-secret').valid, true);
  assert.equal(verifyAuditRows([{ ...first, entity_id: 'tampered' }, second], 'audit-test-secret').valid, false);
  assert.equal(verifyAuditRows([first, { ...second, previous_hash: ZERO_HASH }], 'audit-test-secret').valid, false);
});

test('writer serializes each tenant chain head inside the caller transaction', () => {
  const source = read('lib/auditTrail.js');
  assert.match(source, /audit_chain_heads[\s\S]*FOR UPDATE/);
  assert.match(source, /INSERT INTO audit_logs[\s\S]*previous_hash, event_hash, hash_version/);
  assert.match(source, /event_count=event_count\+1/);
  assert.match(source, /Audit chain head advance failed/);
});

test('retention archives immutable audit rows transactionally before deleting the hot copy', () => {
  const cron = read('lib/hrAuditRetentionJob.js');
  const archiveAt = cron.indexOf('INSERT IGNORE INTO audit_logs_archive');
  const deleteAt = cron.indexOf('DELETE live FROM audit_logs');
  assert.ok(archiveAt > 0 && deleteAt > archiveAt);
  assert.match(cron, /beginTransaction[\s\S]*INSERT IGNORE INTO audit_logs_archive[\s\S]*DELETE live FROM audit_logs[\s\S]*commit/);
});

test('security export includes hot and archived rows with server-side chain verification', () => {
  const route = read('routes/monitoring.js');
  assert.match(route, /\/api\/admin\/security\/audit-export/);
  assert.match(route, /FROM audit_logs_archive/);
  assert.match(route, /verifyAuditRows\(rows\)/);
  assert.match(route, /requirePermission\('view_security'\)/);
  assert.match(route, /Content-Disposition/);
});
