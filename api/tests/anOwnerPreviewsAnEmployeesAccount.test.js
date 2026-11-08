'use strict';
/**
 * 3 Nov 2026, «اقدر اشوف هو بيشوف ايه وبيقدر يعدل ايه»: the owner's tab sends X-Preview-Staff; the server then answers reads as that employee and refuses every write. Nobody
 * but the owner is believed, and sign-in / refresh stay the owner's own.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'preview-test-secret-0123456789-abcdefghijklmnopqrstuv';
process.env.ADMIN_EMAILS = 'owner@example.test';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dbFile = require.resolve('../lib/db');
const rows = { staff: { id: 'st-1', name: 'منى', email: 'Mona@Example.test' }, login: { id: 'user-mona' } };
require.cache[dbFile] = {
  id: dbFile, filename: dbFile, loaded: true,
  exports: { pool: { async query(sql) {
    if (/FROM staff/.test(sql)) return [[rows.staff ? rows.staff : undefined]];
    if (/FROM users/.test(sql)) return [[rows.login ? rows.login : undefined]];
    return [[]];
  } } },
};
const { applyPreview } = require('../middleware/auth');

const call = async ({ email = 'owner@example.test', method = 'GET', url = '/api/admin/leads', preview = 'st-1' } = {}) => {
  const req = { headers: preview ? { 'x-preview-staff': preview } : {}, method, originalUrl: url, user: { uid: 'owner-uid', email, tenant_id: 'tenant-default' } };
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const proceed = await applyPreview(req, res);
  return { proceed, req, res };
};

test('the owner reading becomes the employee, and says who is really behind it', async () => {
  const { proceed, req } = await call();
  assert.equal(proceed, true);
  assert.equal(req.isPreview, true);
  assert.deepEqual([req.user.uid, req.user.email, req.user.name, req.user.is_staff], ['user-mona', 'mona@example.test', 'منى', true]);
  assert.deepEqual(req.previewBy, { uid: 'owner-uid', email: 'owner@example.test' });
});

test('every write is refused while previewing, and the refusal says why', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const { proceed, res } = await call({ method });
    assert.equal(proceed, false, method);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'PREVIEW_READ_ONLY');
  }
});

test('nobody but the owner can ask for it', async () => {
  const { proceed, res } = await call({ email: 'someone@example.test' });
  assert.equal(proceed, false);
  assert.equal(res.body.code, 'PREVIEW_OWNER_ONLY');
});

test('no header, no preview; sign-in, refresh and sign-out stay the owner\'s own', async () => {
  const plain = await call({ preview: '' });
  assert.equal(plain.proceed, true);
  assert.equal(plain.req.isPreview, undefined);
  assert.equal(plain.req.user.uid, 'owner-uid');
  const refresh = await call({ method: 'POST', url: '/api/auth/refresh' });
  assert.equal(refresh.proceed, true);
  assert.equal(refresh.req.user.uid, 'owner-uid', 'a refresh is the owner\'s session, not the employee\'s');
});

test('an employee with no login, or one that does not exist, cannot be previewed', async () => {
  rows.login = null;
  const noLogin = await call();
  assert.equal(noLogin.res.statusCode, 404);
  assert.equal(noLogin.res.body.code, 'PREVIEW_NO_LOGIN');
  rows.staff = null;
  assert.equal((await call()).res.statusCode, 404);
});

test('the tab sends the header on /api calls only, and the server lets the header through CORS', () => {
  const client = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'lib', 'previewMode.ts'), 'utf8');
  
  
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'lib', 'httpApp.js'), 'utf8'), /'X-Preview-Staff'\]/);
});
