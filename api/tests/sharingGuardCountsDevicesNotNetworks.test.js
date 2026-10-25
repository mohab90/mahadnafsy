'use strict';

// 25 Oct 2026 — «لو فتح الموقع مرتين من نفس الجهاز على شبكتين مختلفتين بيتقفل عليه»: the sharing guard keys on the
// device, not the network. Two devices count as two; two networks on one device count as one.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-sharing-guard-secret-0123456789-abcdefghijklmnopqrstuvwxyz';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// An in-memory login_history the guard's pool reads and the audit writes.
const history = [];
const updates = [];
const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    pool: {
      query: async (sql, params = []) => {
        if (/COUNT\(DISTINCT device_hash\)/.test(sql)) {
          const rows = history.filter(row => row.email === params[1] && row.device_hash && ['success', '2fa_success'].includes(row.status));
          return [[{ distinct_devices: new Set(rows.map(row => row.device_hash)).size }]];
        }
        if (/^UPDATE users/.test(sql.trim())) { updates.push(params); return [{ affectedRows: 1 }]; }
        if (/^INSERT INTO login_history/.test(sql.trim())) {
          history.push({ ip: params[4], device_hash: params[5], email: params[2], status: params[7] });
          return [{}];
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    },
  },
};
const { enforceSharingLimit, MAX_DISTINCT_DEVICES } = require('../lib/accountSharingGuard');
const { logLoginAttempt } = require('../lib/loginAudit');
const { peekDeviceHash } = require('../lib/customerDevices');

const reqFor = (deviceId, ip) => ({
  tenantId: 't1', ip, headers: { cookie: deviceId ? `mahadDevice=${deviceId}` : '' }, get: () => 'Mozilla/5.0', socket: { remoteAddress: ip },
});
const DEVICES = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);

test('one device on many networks is never a sharing lock', async () => {
  history.length = 0; updates.length = 0;
  for (const ip of ['41.1.1.1', '196.2.2.2', '178.3.3.3', '102.4.4.4', '41.5.5.5', '196.6.6.6']) {
    await logLoginAttempt({ userId: 'u1', email: 'mona@example.com', req: reqFor(DEVICES[0], ip), status: 'success', tenantId: 't1' });
  }
  assert.equal(history.length, 6);
  const verdict = await enforceSharingLimit({ tenantId: 't1', userId: 'u1', email: 'mona@example.com' });
  assert.equal(verdict.locked, false);
  assert.equal(verdict.distinctDevices, 1);
  assert.equal(updates.length, 0);
});

test('more devices than allowed inside the window locks the account, however few the networks', async () => {
  history.length = 0; updates.length = 0;
  for (let i = 0; i <= MAX_DISTINCT_DEVICES; i += 1) {
    await logLoginAttempt({ userId: 'u2', email: 'ali@example.com', req: reqFor(DEVICES[i], '41.1.1.1'), status: 'success', tenantId: 't1' });
  }
  const verdict = await enforceSharingLimit({ tenantId: 't1', userId: 'u2', email: 'ali@example.com' });
  assert.equal(verdict.locked, true);
  assert.equal(verdict.distinctDevices, MAX_DISTINCT_DEVICES + 1);
  assert.equal(updates.length, 1);
});

test('two devices are two, and a sign-in with no device (staff) is not counted', async () => {
  history.length = 0;
  await logLoginAttempt({ userId: 'u3', email: 'sara@example.com', req: reqFor(DEVICES[0], '1.1.1.1'), status: 'success', tenantId: 't1' });
  await logLoginAttempt({ userId: 'u3', email: 'sara@example.com', req: reqFor(DEVICES[1], '2.2.2.2'), status: 'success', tenantId: 't1' });
  await logLoginAttempt({ userId: 'u3', email: 'sara@example.com', req: reqFor(null, '3.3.3.3'), status: 'success', tenantId: 't1' });
  assert.equal((await enforceSharingLimit({ tenantId: 't1', userId: 'u3', email: 'sara@example.com' })).distinctDevices, 2);
  assert.equal(peekDeviceHash(reqFor(null, '3.3.3.3')), null, 'asking never mints a device');
  assert.notEqual(peekDeviceHash(reqFor(DEVICES[0], '1.1.1.1')), peekDeviceHash(reqFor(DEVICES[1], '1.1.1.1')));
});

test('the guard no longer reads addresses, and the log keeps the device', () => {
  const guard = fs.readFileSync(path.join(__dirname, '../lib/accountSharingGuard.js'), 'utf8');
  assert.doesNotMatch(guard, /DISTINCT ip|ACCOUNT_MAX_DISTINCT_IPS|distinctIps/);
  assert.match(fs.readFileSync(path.join(__dirname, '../migrations/301_v26_login_history_device.sql'), 'utf8'), /ADD COLUMN IF NOT EXISTS device_hash/);
});
