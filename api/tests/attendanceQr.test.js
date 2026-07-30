'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAttendanceQr, verifyAttendanceQr } = require('../lib/attendanceQr');

test('attendance QR is signed, tenant-bound and resolves only the encoded subscriber', () => {
  const token = createAttendanceQr({
    tenantId: 'tenant-a', subscriberId: 'sub-1', expiresInDays: 1,
  });
  assert.deepEqual(verifyAttendanceQr(token, 'tenant-a').subscriberId, 'sub-1');
  assert.equal(verifyAttendanceQr(token, 'tenant-b'), null);
  assert.equal(verifyAttendanceQr(`${token.slice(0, -1)}x`, 'tenant-a'), null);
});

test('raw subscriber ids are not valid attendance QR credentials', () => {
  assert.equal(verifyAttendanceQr('sub-1', 'tenant-a'), null);
});
