'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('production CORS, CSP and API cache policy remain fail-closed', () => {
  const server = read('api/lib/httpApp.js');
  const sanitize = read('api/middleware/sanitize.js');

  assert.match(server, /NODE_ENV === 'production'[\s\S]{0,220}!origin\.includes\('localhost'\)/);
  assert.match(server, /allowed\.includes\(origin\)/);
  assert.match(server, /scriptSrc:\s+\["'none'"\]/);
  assert.match(server, /objectSrc:\s+\["'none'"\]/);
  assert.match(server, /frameSrc:\s+\["'none'"\]/);
  assert.match(sanitize, /Permissions-Policy', 'camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\)'/);
  assert.match(sanitize, /Cache-Control', 'no-store, no-cache, must-revalidate, private'/);
});

test('CI dependency gate only accepts the exact, expiring RSC-only advisory', async () => {
  const workflow = read('.github/workflows/ci.yml');
  const auditTool = await import(pathToFileURL(path.join(root, 'tools', 'dependency-audit.mjs')));

  assert.match(workflow, /npm run audit:dependencies/);
  assert.deepEqual(Object.keys(auditTool.ACCEPTED_RISKS), ['GHSA-QWWW-VCR4-C8H2']);
  const risk = auditTool.ACCEPTED_RISKS['GHSA-QWWW-VCR4-C8H2'];
  assert.equal(risk.version, '7.18.2');
  assert.match(risk.reason, /RSC-only/);
  assert.ok(new Date(`${risk.expires}T23:59:59Z`) > new Date('2026-07-25T00:00:00Z'));
});
