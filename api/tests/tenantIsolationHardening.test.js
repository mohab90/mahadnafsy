'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Normalise CRLF away. Assertions below locate regions of a file with indexOf
// on literals containing "\n"; on a Windows checkout those markers never match,
// the extracted region is empty, and the test fails against correct code.
const normalise = source => source.replace(/\r\n/g, '\n');
const read = relativePath =>
  normalise(fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'));

test('archived subscribers are excluded from canonical lists and client-code lookup', () => {
  const catalog = read('routes/core/catalog.js');
  const staffLists = read('routes/admin/stafflists.js');
  const subscribers = read('routes/admin/subscribers.js');

  assert.match(catalog, /SET is_active=0, deleted_at=NOW\(\), updated_at=NOW\(\)/);
  assert.match(staffLists, /s\.deleted_at IS NULL AND s\.is_active=1/);
  assert.match(subscribers, /deleted_at IS NULL AND is_active=1 AND \(id=\? OR client_code=\?\)/);
});
