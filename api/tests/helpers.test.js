'use strict';
/**
 * Unit tests for input-safety helpers (parsing/JSON). These guard every list
 * endpoint (pagination) and crm_json parsing. Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tryJson, parseLimit, parseOffset } = require('../lib/helpers');

test('tryJson: parses valid JSON, falls back on garbage/empty', () => {
  assert.deepEqual(tryJson('{"a":1}', {}), { a: 1 });
  assert.deepEqual(tryJson('not json', { fallback: true }), { fallback: true });
  assert.deepEqual(tryJson('', []), []);
  assert.deepEqual(tryJson(null, 'X'), 'X');
});

test('parseLimit: clamps to [default..max], rejects non-numeric', () => {
  assert.equal(parseLimit('50'), 50);
  assert.equal(parseLimit(undefined), 100);   // default
  assert.equal(parseLimit('99999'), 1000);    // capped at max
  assert.equal(parseLimit('abc'), 100);       // NaN → default
  assert.equal(parseLimit('20', 10, 30), 20);
});

test('parseOffset: numeric or 0, never negative-NaN', () => {
  assert.equal(parseOffset('40'), 40);
  assert.equal(parseOffset(undefined), 0);
  assert.equal(parseOffset('xyz'), 0);
});
