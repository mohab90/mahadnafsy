'use strict';

// Values the customer-facing app had more than one copy of, and two screens
// that told the customer something that was not true.

const { authRouteSource } = require('./_authRouteSource');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, read, codeOnly } = require('./support/repo');


const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
};


test("the institute's WhatsApp number is written once", () => {
  const files = walk(path.join(ROOT, 'client'));
  assert.ok(files.length > 50, `expected to walk the client app, saw ${files.length} files`);

  const carriers = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (!codeOnly(fs.readFileSync(file, 'utf8')).includes('201096203090')) continue;
    carriers.push(rel);
  }
  // content['footer.whatsapp'] already seeds this default, so every
  // `|| '201096203090'` at a call site was a second copy that could never fire
  // and would be missed the day the institute changes its number. One left: the
  // seed itself, which since 5 Nov 2026 is shared/siteContentDefaults.ts for the site and the admin's editor alike.
  assert.deepEqual(carriers, []);
  
  
});












