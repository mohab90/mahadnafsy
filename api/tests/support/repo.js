'use strict';

/**
 * What the unit tests that read the repository's own files share (5 Nov 2026): they each defined these, word for word, 3 to 120 times.
 * ROOT is the repository, `read` a file of it as text, `bundle` an admin/client TypeScript module compiled with the admin's esbuild so a test can call
 * the browser's own functions (null when esbuild is not installed, and the test skips that part), `codeOnly` a source without its comments, `browserSources`
 * every .ts/.tsx file of the admin, the client and shared, and `fakeDb` a database that answers by pattern and records what it was asked.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function bundle(entry) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

/** A source without block comments and without the `//` tail of a line. */
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

/** The same, by one regular expression: it keeps a `//` that follows a colon (a URL). */
const codeOnlyKeepingUrls = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

function browserSources() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  for (const app of ['admin', 'client', 'shared']) walk(path.join(ROOT, app));
  return out.map(f => path.relative(ROOT, f).split(path.sep).join('/'));
}

/** `answers`: [[pattern, answer]], the first pattern the whitespace-flattened SQL matches wins; anything else answers [{ affectedRows: 0 }]. */
function fakeDb(answers) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const flat = sql.replace(/\s+/g, ' ');
      calls.push({ sql: flat, params });
      for (const [pattern, answer] of answers) {
        if (pattern.test(flat)) return typeof answer === 'function' ? answer(params) : answer;
      }
      return [{ affectedRows: 0 }];
    },
  };
}

module.exports = { ROOT, read, bundle, codeOnly, codeOnlyKeepingUrls, browserSources, fakeDb };
