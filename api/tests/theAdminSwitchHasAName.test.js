'use strict';
/**
 * A switch in the admin says what it switches and whether it is on (31 Oct 2026 audit).
 *
 * The toggles on the payment, lead-source and branch screens were a <button> holding an empty <span>: nothing a screen reader
 * or a voice control could name, and no state. The component is rendered for real here (bundled with esbuild, drawn with
 * react-dom/server), because a source regex would pass on a switch that never reaches the page.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const nm = path.join(ROOT, 'admin', 'node_modules');

function load() {
  let esbuild; let React; let server;
  try {
    esbuild = require(path.join(nm, 'esbuild'));
    React = require(path.join(nm, 'react'));
    server = require(path.join(nm, 'react-dom', 'server'));
  } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'admin/pages/dashboard/tabs/saasConnectorUi.tsx')], bundle: true, write: false, format: 'cjs',
    platform: 'node', jsx: 'transform', logLevel: 'silent', nodePaths: [nm], define: { 'import.meta.env': '{}' },
    external: ['react', 'react-dom'],
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, id => (id === 'react' ? React : require(path.join(nm, id))));
  return { Toggle: module.exports.Toggle, React, server };
}

test('a switch is a switch, with its state and its name', t => {
  const loaded = load();
  if (!loaded) return t.skip('admin dependencies are not installed here');
  const { Toggle, React, server } = loaded;
  const on = server.renderToStaticMarkup(React.createElement(Toggle, { checked: true, onChange() {}, label: 'تفعيل الدفع الإلكتروني' }));
  assert.match(on, /role="switch"/);
  assert.match(on, /aria-checked="true"/);
  assert.match(on, /aria-label="تفعيل الدفع الإلكتروني"/);
  const off = server.renderToStaticMarkup(React.createElement(Toggle, { checked: false, onChange() {}, label: 'x' }));
  assert.match(off, /aria-checked="false"/);
});

test('every switch on the settings screens is given a name', () => {
  const fs = require('node:fs');
  for (const rel of [
    'admin/pages/dashboard/tabs/BranchWorkspacesTab.tsx', 'admin/pages/dashboard/tabs/LeadSourcesSettingsTab.tsx',
    'admin/pages/dashboard/tabs/MetaCapiSettingsTab.tsx', 'admin/pages/dashboard/tabs/PaymentSettingsTab.tsx',
  ]) {
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const switches = source.match(/<Toggle\b[^>]*>/g) || [];
    assert.ok(switches.length > 0, rel);
    for (const tag of switches) assert.match(tag, /label=/, `${rel}: ${tag.slice(0, 60)}`);
  }
});
