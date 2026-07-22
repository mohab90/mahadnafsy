'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin-utils.js'), 'utf8');

test('subscriber PII export scopes every business dataset to the request tenant and audits access', () => {
  const section = source.slice(source.indexOf("router.get('/api/admin/subscribers/:id/export-data'"), source.indexOf("router.delete('/api/admin/subscribers/:id/delete-data'"));
  assert.match(section, /subscribers WHERE id=\? AND tenant_id=\?/);
  for (const table of ['payments', 'enrollments', 'course_completions', 'support_tickets', 'nps_responses']) {
    assert.match(section, new RegExp(`FROM ${table} WHERE subscriber_id=\\? AND tenant_id=\\?`), table);
  }
  assert.match(section, /subscriber_data_exported/);
});

test('subscriber anonymization is tenant locked, transactional and audited', () => {
  const section = source.slice(source.indexOf("router.delete('/api/admin/subscribers/:id/delete-data'"), source.indexOf('// ═', source.indexOf("router.delete('/api/admin/subscribers/:id/delete-data'") + 10));
  assert.match(section, /WHERE id=\? AND tenant_id=\? LIMIT 1 FOR UPDATE/);
  assert.match(section, /UPDATE subscribers[\s\S]*WHERE id=\? AND tenant_id=\?/);
  assert.match(section, /support_tickets WHERE subscriber_id=\? AND tenant_id=\?/);
  assert.match(section, /lecture_progress WHERE subscriber_id=\? AND tenant_id=\?/);
  assert.match(section, /subscriber_data_anonymized/);
  assert.match(section, /await conn\.commit\(\)/);
  assert.match(section, /await conn\.rollback\(\)/);
});
