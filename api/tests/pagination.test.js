'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { offsetPage, keyset, encodeCursor } = require('../lib/pagination');

test('offsetPage clamps to safe bounds', () => {
  assert.deepEqual(offsetPage({}), { page: 1, limit: 50, offset: 0 });
  assert.deepEqual(offsetPage({ page: '3', limit: '20' }), { page: 3, limit: 20, offset: 40 });
  assert.equal(offsetPage({ limit: '99999' }).limit, 200);   // capped at maxLimit
  assert.equal(offsetPage({ page: '-5' }).page, 1);          // floored at 1
});

test('keyset returns no filter on first page', () => {
  const k = keyset({});
  assert.equal(k.where, '1=1');
  assert.deepEqual(k.params, []);
  assert.equal(k.limit, 50);
});

test('keyset decodes a cursor into a keyset predicate', () => {
  const cursor = encodeCursor('2026-01-01T00:00:00.000Z', 'abc');
  const k = keyset({ cursor });
  assert.match(k.where, /< \? OR/);
  assert.deepEqual(k.params, ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'abc']);
});

test('keyset ignores a malformed cursor (falls back to first page)', () => {
  const k = keyset({ cursor: '!!!not-base64!!!' });
  assert.equal(k.where, '1=1');
});

test('nextCursor is null when fewer rows than limit (last page)', () => {
  const k = keyset({ limit: '2' });
  assert.equal(k.nextCursor([{ created_at: 'x', id: '1' }]), null);
  const next = k.nextCursor([{ created_at: '2026-01-01', id: '1' }, { created_at: '2026-01-02', id: '2' }]);
  assert.equal(typeof next, 'string');
});
