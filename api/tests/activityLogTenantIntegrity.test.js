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
  // Plain INSERT, not INSERT IGNORE. This test is about tenant ownership and
  // the tenant column is still first — the IGNORE went because the row id used
  // to come from the request body, so a caller who chose an id could pre-insert
  // it and have a later genuine row silently dropped. See auditIntegrity.test.js.
  assert.match(operations, /INSERT INTO activity_logs \(id, tenant_id/);
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
