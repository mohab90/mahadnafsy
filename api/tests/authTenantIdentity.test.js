'use strict';
const { authRouteSource, sourceOf } = require('./_authRouteSource');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');



test('all account creation paths persist tenant ownership', () => {
  for (const relative of ['routes/auth.js', 'routes/admin/leads.js', 'routes/admin/subscribers.js', 'routes/misc/admincfg.js']) {
    const source = sourceOf(relative);
    assert.doesNotMatch(source, /INSERT INTO users \(id, email/);
  }
});
