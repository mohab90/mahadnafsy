'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isFxSnapshotUsable } = require('../lib/finance');

const now = Date.parse('2026-07-29T12:00:00Z');

test('EGP postings never require an external FX snapshot', () => {
  assert.equal(isFxSnapshotUsable(null, 'EGP', now), true);
});

test('foreign currency rejects static, missing and stale FX snapshots', () => {
  assert.equal(isFxSnapshotUsable({
    source: 'static-fallback', rates: { USD: 50 }, updatedAt: '2026-07-29T11:00:00Z',
  }, 'USD', now), false);
  assert.equal(isFxSnapshotUsable({
    source: 'provider', rates: { USD: 50 }, updatedAt: null,
  }, 'USD', now), false);
  assert.equal(isFxSnapshotUsable({
    source: 'provider', rates: { USD: 50 }, updatedAt: '2026-07-20T11:00:00Z',
  }, 'USD', now), false);
});

test('fresh provider snapshots permit supported foreign currencies only', () => {
  const snapshot = {
    source: 'provider',
    rates: { USD: 50, SAR: 13.3 },
    updatedAt: '2026-07-29T11:00:00Z',
  };
  assert.equal(isFxSnapshotUsable(snapshot, 'USD', now), true);
  assert.equal(isFxSnapshotUsable(snapshot, 'SAR', now), true);
  assert.equal(isFxSnapshotUsable(snapshot, 'EUR', now), false);
});
