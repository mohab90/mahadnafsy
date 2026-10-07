'use strict';

// PUT /api/admin/sys-config/:section refuses a section SYS_DEFAULTS does not
// declare («Unknown section»). Four screens read and write their own section;
// payment_gateway and otp_provider were found missing before, and on 7 Oct
// 2026 the owner connected the Facebook page in «مصادر الليد» and both saves
// were refused — lead_source_connectors was missing too, and so was
// «مساحات الفروع»'s branch_workspaces. Every section a screen names is checked.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
function sourcesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourcesUnder(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

test('every section a settings screen names is one the server accepts', () => {
  const shared = fs.readFileSync(path.join(ROOT, 'api/routes/misc/_shared.js'), 'utf8');
  const block = shared.slice(shared.indexOf('const SYS_DEFAULTS = {'), shared.indexOf('\n};', shared.indexOf('const SYS_DEFAULTS = {')));
  const declared = new Set([...block.matchAll(/\n {2}([a-z_]+):/g)].map(match => match[1]));
  const named = new Set();
  for (const file of sourcesUnder(path.join(ROOT, 'admin'))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/sys-config(?:\/|\?section=)([a-z_]+)/g)) named.add(match[1]);
  }
  assert.ok(named.has('lead_source_connectors') && named.has('payment_gateway'), 'the scan found the screens');
  for (const section of named) assert.ok(declared.has(section), `«${section}» is saved by a screen and unknown to the server`);
});
