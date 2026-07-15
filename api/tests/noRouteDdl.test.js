const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routesDir = path.join(__dirname, '..', 'routes');
const ddlPattern = /\b(CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+TABLE|ADD\s+COLUMN|MODIFY\s+COLUMN)\b/i;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
  });
}

test('route files do not execute or contain runtime DDL', () => {
  const offenders = walk(routesDir)
    .map((file) => ({ file, body: fs.readFileSync(file, 'utf8') }))
    .filter(({ body }) => ddlPattern.test(body))
    .map(({ file }) => path.relative(path.join(__dirname, '..'), file));

  assert.deepEqual(offenders, []);
});
