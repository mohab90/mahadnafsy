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
  const cursor = encodeCursor('2026-01-01 03:04:05.000', 'abc');
  const k = keyset({ cursor });
  assert.match(k.where, /< \? OR/);
  assert.deepEqual(k.params, ['2026-01-01 03:04:05.000', '2026-01-01 03:04:05.000', 'abc']);
});

test('an old ISO cursor is read as the instant it names, in server-local time', () => {
  const instant = new Date('2026-01-01T00:00:00.000Z');
  const k = keyset({ cursor: encodeCursor(instant.toISOString(), 'abc') });
  const back = new Date(k.params[0].replace(' ', 'T'));
  assert.equal(back.getTime(), instant.getTime());
});

test('nextCursor reads aliased columns off the row and round-trips a DATETIME', () => {
  // Routes pass 'l.created_at'; mysql2 names the row key 'created_at'. Reading
  // the aliased name gave "undefined|undefined" and the second page never came.
  const k = keyset({ limit: '1' }, { col: 'l.created_at', idCol: 'l.id', limit: 1 });
  const at = new Date(2026, 4, 6, 7, 8, 9, 123);
  const next = k.nextCursor([{ created_at: at, id: 'lead-9' }]);
  assert.ok(next);
  const page2 = keyset({ cursor: next }, { col: 'l.created_at', idCol: 'l.id' });
  assert.deepEqual(page2.params, ['2026-05-06 07:08:09.123', '2026-05-06 07:08:09.123', 'lead-9']);
});

test('nextCursor gives up rather than emit an undefined cursor', () => {
  const k = keyset({ limit: '1' }, { col: 'x.missing', limit: 1 });
  assert.equal(k.nextCursor([{ id: '1' }]), null);
  assert.equal(keyset({ cursor: encodeCursor('undefined', 'undefined') }).where, '1=1');
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
