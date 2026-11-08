'use strict';

// «في مشكلة عند الرجوع داخل السيستم بيرجع للصفحة الرئيسية مش مكان ما كنت موجود»
// (13 Oct 2026). Back is the browser's own step in the app's history; only a page
// opened from a link has nowhere to go back to, and goes to the fallback.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

async function loadGoBack(navigate) {
  const ADMIN_MODULES = path.join(__dirname, '../../admin/node_modules');
  let esbuild;
  try { esbuild = require(path.join(ADMIN_MODULES, 'esbuild')); } catch { return null; }
  const stubs = {
    react: 'export const useCallback = fn => fn;',
    'react-router-dom': 'export const useNavigate = () => globalThis.__navigate;',
  };
  const out = await esbuild.build({
    entryPoints: [path.join(__dirname, '../../admin/lib/useGoBack.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    plugins: [{
      name: 'stubs',
      setup(build) {
        build.onResolve({ filter: /^(react|react-router-dom)$/ }, args => ({ path: args.path, namespace: 'stub' }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      },
    }],
  });
  globalThis.__navigate = navigate;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports.useGoBack;
}

test('with an earlier page of the app, back goes one step in its history', async () => {
  const calls = [];
  const useGoBack = await loadGoBack(target => calls.push(target));
  if (!useGoBack) return;
  globalThis.window = { history: { state: { idx: 3, key: 'k', usr: null } } };
  useGoBack('/dashboard')();
  assert.deepEqual(calls, [-1]);
});

test('opened from a link (the first entry), back goes to the fallback, not out of the app', async () => {
  const calls = [];
  const useGoBack = await loadGoBack(target => calls.push(target));
  if (!useGoBack) return;
  for (const state of [{ idx: 0 }, null, {}]) {
    globalThis.window = { history: { state } };
    useGoBack('/dashboard')('/dashboard/subscribers');
  }
  assert.deepEqual(calls, ['/dashboard/subscribers', '/dashboard/subscribers', '/dashboard/subscribers']);
  globalThis.window = { history: { state: null } };
  useGoBack('/dashboard/hr')();
  assert.equal(calls.at(-1), '/dashboard/hr');
  delete globalThis.window;
});




