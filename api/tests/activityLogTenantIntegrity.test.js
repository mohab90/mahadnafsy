'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('activity log schema, writes and reads are tenant owned', () => {
  const migration = read('migrations', '139_v25_activity_log_tenant_integrity.sql');
  const operations = read('routes', 'admin-operations.js');
  const audit = read('middleware', 'adminAudit.js');
  assert.match(migration, /ALTER TABLE activity_logs[\s\S]*tenant_id/);
  assert.match(migration, /ALTER TABLE activity_logs_archive[\s\S]*tenant_id/);
  assert.match(operations, /FROM activity_logs WHERE tenant_id=\?/);
  assert.match(operations, /INSERT IGNORE INTO activity_logs \(id, tenant_id/);
  assert.match(audit, /INSERT INTO activity_logs \(id, tenant_id/);
});

test('activity archive uses the real timestamp and one transaction', () => {
  const archive = read('lib', 'archiveJob.js');
  assert.doesNotMatch(archive, /created_at/);
  assert.match(archive, /beginTransaction\(\)/);
  assert.match(archive, /INSERT IGNORE INTO activity_logs_archive/);
  assert.match(archive, /WHERE at < \?/);
  assert.match(archive, /commit\(\)/);
  assert.match(archive, /rollback\(\)/);
});
