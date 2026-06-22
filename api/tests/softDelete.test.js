'use strict';
/**
 * Unit tests for lib/softDelete — the live-only SQL fragment used across every
 * expenses read so soft-deleted rows never leak into lists or financial totals.
 * Pure string builder, no DB. Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { liveOnly } = require('../lib/softDelete');

test('liveOnly() builds the unaliased deleted_at filter', () => {
  assert.equal(liveOnly(), 'deleted_at IS NULL');
});

test('liveOnly(alias) prefixes the table alias', () => {
  assert.equal(liveOnly('e'), 'e.deleted_at IS NULL');
  assert.equal(liveOnly('exp'), 'exp.deleted_at IS NULL');
});
