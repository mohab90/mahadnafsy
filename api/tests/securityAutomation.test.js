'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');



test('CI dependency gate only accepts the exact, expiring RSC-only advisory', async () => {
  const workflow = read('.github/workflows/ci.yml');
  const auditTool = await import(pathToFileURL(path.join(root, 'tools', 'dependency-audit.mjs')));

  
  assert.deepEqual(Object.keys(auditTool.ACCEPTED_RISKS), ['GHSA-QWWW-VCR4-C8H2']);
  const risk = auditTool.ACCEPTED_RISKS['GHSA-QWWW-VCR4-C8H2'];
  assert.equal(risk.version, '7.18.2');
  assert.match(risk.reason, /RSC-only/);
  assert.ok(new Date(`${risk.expires}T23:59:59Z`) > new Date('2026-07-25T00:00:00Z'));
});

// 11 Oct 2026: the production tree fails the gate; an advisory reached only
// through build tools (tailwind → braces, brace-expansion, source-map-js) is a
// warning, because none of it is in what ships.
test('dependency gate fails on shipped advisories and only warns on build-only ones', async () => {
  const auditTool = await import(pathToFileURL(path.join(root, 'tools', 'dependency-audit.mjs')));
  const shipped = { package: 'express', advisory: 'GHSA-AAAA', severity: 'high' };
  const buildTool = { package: 'braces', advisory: 'GHSA-VFJ7-8CJW-P6XM', severity: 'high' };
  const production = { failures: [shipped], accepted: [] };
  const full = { failures: [shipped, buildTool], accepted: [] };
  assert.deepEqual(auditTool.buildOnly(full, production), [buildTool]);
  const source = read('tools/dependency-audit.mjs');
  
  
});
