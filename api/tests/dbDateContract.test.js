'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('database keeps MySQL DATE values as date-only strings without timezone drift', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db.js'), 'utf8');
  assert.match(source, /dateStrings:\s*\['DATE'\]/);
});
