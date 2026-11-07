'use strict';

// installment_entries (migration 369) is a copy of the plans' JSON arrays; it stays true only while every writer of a plan rewrites it. Every statement that writes installment_plans
// is followed, in its own file, by syncPlanEntries; a new writer that forgets shows up here (the nightly job would only repair it by morning).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

test('every statement that writes an installment plan is followed by the rewrite of its rows', () => {
  const files = [...walk(path.join(ROOT, 'routes')), ...walk(path.join(ROOT, 'lib'))].filter(file => file.endsWith('.js') && !file.endsWith('installmentEntries.js'));
  const writers = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const writes = [...source.matchAll(/(INSERT INTO installment_plans|UPDATE installment_plans|DELETE FROM installment_plans)/g)];
    if (!writes.length) continue;
    writers.push(path.relative(ROOT, file).split(path.sep).join('/'));
    const syncs = (source.match(/syncPlanEntries\(/g) || []).length;
    assert.ok(syncs >= writes.length, `${path.relative(ROOT, file)} writes a plan ${writes.length} time(s) and rewrites its rows ${syncs} time(s)`);
  }
  assert.deepEqual(writers.sort(), ['lib/planEntryPayment.js', 'routes/installments.js'], 'the places that write a plan: a new one has to rewrite the rows too');
});

test('the overdue list reads the rows and falls back to the plans only while the table is empty', () => {
  const source = fs.readFileSync(path.join(ROOT, 'routes', 'admin', 'stafflists.js'), 'utf8');
  assert.ok(source.includes('dueFromEntries(pool'));
  assert.ok(source.includes('entriesHeld.held) ? dueFromEntries'));
  assert.ok(source.includes('dueFromPlans('));
});
