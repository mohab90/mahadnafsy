'use strict';

// MED-13 of the external audit (7 Oct 2026): the /api/staff routes write — a
// welcome login with its password, a leave, a resignation, a client's contact —
// and the activity log covered /api/admin only. They are logged the same way
// now, without the secrets, and without every message an employee sends.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createAdminAuditMiddleware } = require('../middleware/adminAudit');

function logged(method, url, body = {}) {
  const rows = [];
  const pool = { query: async (_sql, params) => { rows.push(params); return [{}]; } };
  const audit = createAdminAuditMiddleware({ pool, uuidv4: () => 'id-1' });
  const res = Object.assign(new EventEmitter(), { statusCode: 200 });
  audit({ method, originalUrl: url, body, params: {}, tenantId: 'tenant-default', user: { email: 'rep@x.test' }, staffRecord: { name: 'سما', role: 'SALES' } }, res, () => {});
  res.emit('finish');
  return rows;
}

test('a staff write is in the log, named, and without its password', () => {
  const [row] = logged('POST', '/api/staff/enrollment-welcome', { subscriberId: 's-1', password: 'Secret#123', phone: '01000000000' });
  assert.ok(row, 'a row was written');
  assert.equal(row[3], 'enrollment-welcome', 'the entity is the route, not «api»');
  assert.equal(row[7], 'سما');
  assert.doesNotMatch(row[9], /Secret#123/);
  assert.match(row[9], /POST \/api\/staff\/enrollment-welcome/);
});

test('the messages an employee sends stay with their conversations', () => {
  assert.equal(logged('POST', '/api/staff/whatsapp-web/send', { to: '010', text: 'hi' }).length, 0);
  assert.equal(logged('POST', '/api/staff/me/messages', { text: 'hi' }).length, 0);
  assert.equal(logged('GET', '/api/staff/me').length, 0, 'reads are not acts');
});

test('the server puts the staff routes behind it', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'lib', 'httpApp.js'), 'utf8');
  assert.match(app, /app\.use\('\/api\/staff', auditWrites\);/);
});
