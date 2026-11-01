'use strict';
// Draws an admin component for real in a test: bundled with esbuild from the admin's own dependencies, rendered to markup with
// react-dom/server. No browser and no DOM library — effects do not run, so what is drawn is the first render of the props given,
// which is what a header, a card or a switch is. (Whole screens, which fetch, are walked in a browser by e2e/tests/dashboard-screens.spec.ts.)
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const nm = path.join(ROOT, 'admin', 'node_modules');

/** Returns { module, React, markup(element) } or null where the admin's dependencies are not installed. */
function renderAdmin(relativeFile) {
  let esbuild; let React; let server;
  try {
    esbuild = require(path.join(nm, 'esbuild'));
    React = require(path.join(nm, 'react'));
    server = require(path.join(nm, 'react-dom', 'server'));
  } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, relativeFile)], bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'transform',
    logLevel: 'silent', nodePaths: [nm], define: { 'import.meta.env': '{}' }, external: ['react', 'react-dom'],
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, id => (id === 'react' ? React : require(path.join(nm, id))));
  return { module: module.exports, React, markup: element => server.renderToStaticMarkup(element) };
}

module.exports = { renderAdmin };
