'use strict';
/**
 * «السيستم بيفضل يعمل ريفريش كتير لكل الموظفين» (1 Nov 2026). Every successful write emptied the held counters of every screen
 * (lib/httpApp.js dropFiguresAfterWrites). A student's open page posts /api/me/heartbeat every minute and a lecture patches its progress,
 * so with thirty people online the counters were dropped every two seconds and no dashboard ever read a held figure.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-quiet-writes-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isQuietWrite, dropFiguresAfterWrites } = require('../lib/httpApp');
const { cached, cacheInvalidateLocal } = require('../lib/db');

test('the writes that touch no figure are named, and a real write is not one of them', () => {
  for (const path of ['/api/me/heartbeat', '/api/me/progress', '/api/lectures/abc-123/view', '/api/push/subscribe', '/api/auth/refresh', '/api/staff/me/preferences', '/api/staff/announcements/7/seen', '/api/admin/hr/staff-messages/mark-read', '/api/me/heartbeat?x=1']) {
    assert.equal(isQuietWrite(path), true, path);
  }
  for (const path of ['/api/admin/leads', '/api/admin/leads/abc/status', '/api/leads-public', '/api/admin/payments', '/api/me/orders', '/api/me/payment-proofs', '/api/admin/team-inbox/threads/1/reply', '/api/me/tickets', '/api/orders/reserve']) {
    assert.equal(isQuietWrite(path), false, path);
  }
});

async function write(method, url, status = 200) {
  let finish;
  const res = { statusCode: status, on(event, fn) { if (event === 'finish') finish = fn; } };
  await new Promise(resolve => dropFiguresAfterWrites({ method, originalUrl: url, url }, res, resolve));
  if (finish) finish();
}

test('a heartbeat leaves a held figure alone; a lead write drops it', async () => {
  let computed = 0;
  const read = () => cached('figures:test:quiet', 60_000, async () => { computed += 1; return computed; });
  cacheInvalidateLocal('figures:');
  assert.equal(await read(), 1);
  await write('POST', '/api/me/heartbeat');
  await write('PATCH', '/api/me/progress');
  assert.equal(await read(), 1, 'still held');
  await write('PATCH', '/api/admin/leads/abc/status');
  assert.equal(await read(), 2, 'a lead moved: counted again');
  await write('POST', '/api/admin/leads', 400);
  assert.equal(await read(), 2, 'a refused write changed nothing');
  cacheInvalidateLocal('figures:');
});
