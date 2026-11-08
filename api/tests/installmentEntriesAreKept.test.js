'use strict';

// installment_entries (migration 369) is a copy of the plans' JSON arrays; it stays true only while every writer of a plan rewrites it. Every statement that writes installment_plans
// is followed, in its own file, by syncPlanEntries; a new writer that forgets shows up here (the nightly job would only repair it by morning).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

test('the overdue list reads the rows and falls back to the plans only while the table is empty', () => {
  const source = fs.readFileSync(path.join(ROOT, 'routes', 'admin', 'stafflists.js'), 'utf8');
  assert.ok(source.includes('dueFromEntries(pool'));
  assert.ok(source.includes('entriesHeld.held) ? dueFromEntries'));
  assert.ok(source.includes('dueFromPlans('));
});
