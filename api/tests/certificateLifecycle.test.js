'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { reissueCertificate, revokeCertificate } = require('../lib/certificateLifecycle');

function mockConnection(completion) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM course_completions')) return [[completion]];
      return [{ affectedRows: 1 }];
    },
  };
}

test('certificate revoke is tenant-scoped, stateful and audited', async () => {
  const conn = mockConnection({
    id: 'cc1', certificate_code: 'MHAD-OLD', status: 'active', version: 1,
  });
  const result = await revokeCertificate({
    tenantId: 'tenant-a', completionId: 'cc1', actor: 'admin@example.com', reason: 'Incorrect student identity',
  }, conn);

  assert.equal(result.status, 'revoked');
  assert.equal(result.changed, true);
  const update = conn.calls.find(call => call.sql.includes("SET status='revoked'"));
  assert.deepEqual(update.params.slice(-2), ['cc1', 'tenant-a']);
  const event = conn.calls.find(call => call.sql.includes('INSERT INTO certificate_lifecycle_events'));
  assert.equal(event.params[3], 'revoked');
  assert.equal(event.params[4], 'MHAD-OLD');
});

test('certificate revoke is idempotent when it is already revoked', async () => {
  const conn = mockConnection({
    id: 'cc1', certificate_code: 'MHAD-OLD', status: 'revoked', version: 1,
  });
  const result = await revokeCertificate({
    tenantId: 'tenant-a', completionId: 'cc1', actor: 'admin@example.com', reason: 'Repeat request',
  }, conn);
  assert.equal(result.changed, false);
  assert.equal(conn.calls.length, 1);
});

test('certificate reissue rotates the public code, increments version and keeps an audit trail', async () => {
  const conn = mockConnection({
    id: 'cc1', certificate_code: 'MHAD-OLD', status: 'revoked', version: 2,
  });
  const result = await reissueCertificate({
    tenantId: 'tenant-a', completionId: 'cc1', actor: 'admin@example.com', reason: 'Corrected legal name',
  }, conn);

  assert.equal(result.status, 'active');
  assert.equal(result.version, 3);
  assert.notEqual(result.certificate_code, 'MHAD-OLD');
  const event = conn.calls.find(call => call.sql.includes('INSERT INTO certificate_lifecycle_events'));
  assert.equal(event.params[3], 'reissued');
  assert.equal(event.params[4], 'MHAD-OLD');
  assert.equal(event.params[5], result.certificate_code);
});

test('certificate mutations require a reason before touching storage', async () => {
  await assert.rejects(
    () => revokeCertificate({ tenantId: 't1', completionId: 'cc1', actor: 'admin' }, {}),
    error => error.statusCode === 400
  );
});

test('public and admin certificate routes enforce lifecycle state and permissions', () => {
  const publicRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'public.js'), 'utf8');
  const adminRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'lms.js'), 'utf8');
  assert.match(publicRoute, /cc\.status='active'/);
  assert.match(publicRoute, /res\.status\(410\)/);
  assert.match(adminRoute, /completions\/:id\/revoke'[\s\S]*requirePermission\('manage_courses'\)/);
  assert.match(adminRoute, /completions\/:id\/reissue'[\s\S]*requirePermission\('manage_courses'\)/);
  assert.match(adminRoute, /certificate_lifecycle_events/);
});
