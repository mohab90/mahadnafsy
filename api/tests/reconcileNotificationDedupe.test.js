'use strict';
// The integrity monitor raises an admin notification when a critical check
// fails. It runs three minutes after every boot as well as daily, so every
// deploy raised another identical alert: 732 of them, 633 unread, a sixth of
// every notification in the system. An alert that repeats unchanged is one
// people learn to scroll past, which costs exactly the attention it buys.
//
// Two properties keep it useful, and both are easy to lose in a later edit.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'reconcileJob.js'), 'utf8');

// The comments in that file name the constructs these tests forbid, in order to
// explain why they are forbidden. Assertions run against the code alone.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');

test('an identical finding is not raised twice in a day', () => {
  // The lookup must happen, and it must gate the notification rather than sit
  // beside it: assert the order, not merely the presence.
  const lookup = source.indexOf('FROM notifications');
  const create = source.indexOf('createNotification(');
  assert.ok(lookup > 0, 'the job must look for an alert it already raised');
  assert.ok(create > 0, 'the job must still be able to raise one');
  assert.ok(lookup < create, 'the lookup must come before the notification');
  assert.match(source, /INTERVAL 1 DAY/, 'the window is one day');
  assert.match(source, /if \(dupe\)/, 'a hit must skip the notification');
});

test('the finding set is compared as text, because MariaDB has no CAST AS JSON', () => {
  // CAST(? AS JSON) is a parse error on MariaDB. The throw lands in the catch
  // around this block, so the alert is lost entirely — silence being the one
  // outcome worse than repetition.
  assert.doesNotMatch(code, /CAST\(\s*\?\s*AS\s+JSON\s*\)/i,
    'CAST AS JSON does not parse on MariaDB and would swallow the alert');
  assert.doesNotMatch(code, /JSON_EXTRACT/i,
    'the comparison must not depend on JSON functions');
  assert.match(code, /data_json\s*=\s*\?/,
    'the stored payload is compared as text');
});

test('the keys are sorted, so the same findings serialise the same way', () => {
  // Without this the signature depends on check order and the comparison above
  // silently stops matching.
  assert.match(source, /criticals\.map\(c => c\.key\)\.sort\(\)/);
});

test('every finding still reaches the log even when the notification is skipped', () => {
  // Deduplicating the notification must not deduplicate the record.
  const logLine = source.indexOf('[reconcile-job] ${v.severity.toUpperCase()}');
  const dedupe = source.indexOf('if (dupe)');
  assert.ok(logLine > 0, 'each violation must still be logged');
  assert.ok(logLine < dedupe, 'logging happens before the notification decision');
});
