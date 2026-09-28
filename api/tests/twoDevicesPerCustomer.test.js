'use strict';

// «مسموح له 2 ip فقط يعني لو حب يدخل من جهاز تالت تقف وتظهرله رساله انت فتحت
// اكتر من جهاز ضروري الرساله دي».

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-device-limit-secret-0123456789-abcdefghijklmnopqrstuvwxyz';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { registerCustomerDevice, DEVICE_LIMIT_MESSAGE } = require('../lib/customerDevices');
// token.js opens the database pool, which would keep this process alive; only
// its cookie writer is under test.
const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: {} } };
const { setAuthCookie } = require('../lib/token');

function fakeConn() {
  const rows = [];
  return {
    rows,
    async query(sql, params) {
      if (/^SELECT id, device_hash FROM customer_devices/.test(sql)) return [rows.filter(row => row.user_id === params[1])];
      if (/^UPDATE customer_devices/.test(sql)) { Object.assign(rows.find(row => row.id === params[2]), { last_ip: params[0] }); return [{}]; }
      if (/^INSERT INTO customer_devices/.test(sql)) {
        const [id, , userId, deviceHash, lastIp] = params;
        rows.push({ id, user_id: userId, device_hash: deviceHash, last_ip: lastIp });
        return [{}];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

// A browser: keeps the device cookie the server gives it, like a real one.
function browser(ip) {
  let cookie = '';
  return {
    request() {
      const set = [];
      const req = {
        ip, headers: { cookie }, get: name => (name === 'user-agent' ? 'Mozilla/5.0 (iPhone)' : undefined),
        res: { append: (_name, value) => set.push(value) },
      };
      return { req, keep: () => { const got = set.find(value => value.startsWith('mahadDevice=')); if (got) cookie = got.split(';')[0]; }, set };
    },
  };
}

async function signIn(conn, device) {
  const { req, keep, set } = device.request();
  const result = await registerCustomerDevice(conn, { tenantId: 't1', userId: 'u1', req });
  keep();
  return { result, set };
}

test('two devices sign in; the third is refused with the message', async () => {
  const conn = fakeConn();
  const phone = browser('41.1.1.1');
  const laptop = browser('41.2.2.2');
  assert.equal((await signIn(conn, phone)).result.deviceCount, 1);
  assert.equal((await signIn(conn, laptop)).result.deviceCount, 2);
  await assert.rejects(signIn(conn, browser('41.3.3.3')), error => {
    assert.equal(error.code, 'DEVICE_LIMIT');
    assert.equal(error.statusCode, 403);
    assert.match(error.message, /انت فتحت حسابك من أكتر من جهاز/);
    return true;
  });
  assert.equal(conn.rows.length, 2, 'the refused device took no place');
  assert.equal(DEVICE_LIMIT_MESSAGE.includes('جهازين'), true);
});

test('the same device on a new network is still the same device, and its IP is kept', async () => {
  const conn = fakeConn();
  const phone = browser('41.1.1.1');
  await signIn(conn, phone);
  await signIn(conn, browser('41.2.2.2'));
  // Mobile data hands the phone a new address: not a third device.
  const again = phone.request();
  again.req.ip = '197.9.9.9';
  const { known } = await registerCustomerDevice(conn, { tenantId: 't1', userId: 'u1', req: again.req });
  assert.equal(known, true);
  assert.equal(conn.rows[0].last_ip, '197.9.9.9');
  assert.equal(again.set.length, 0, 'a known device is not given a new cookie');
});

test('the cookie holds a random id; the table holds only its keyed hash', async () => {
  const conn = fakeConn();
  const { set } = await signIn(conn, browser('41.1.1.1'));
  const id = set[0].match(/^mahadDevice=([0-9a-f-]{36});/)[1];
  assert.match(set[0], /HttpOnly; Path=\/; Max-Age=\d+; SameSite=None; Secure/);
  assert.notEqual(conn.rows[0].device_hash, id);
  assert.match(conn.rows[0].device_hash, /^[0-9a-f]{64}$/);
});

test('signing in keeps the device cookie beside the session cookies', () => {
  const headers = {};
  const res = { getHeader: name => headers[name], setHeader: (name, value) => { headers[name] = value; } };
  res.setHeader('Set-Cookie', ['mahadDevice=abc; HttpOnly']);
  setAuthCookie(res, 'token-1');
  assert.equal(headers['Set-Cookie'][0], 'mahadDevice=abc; HttpOnly');
  assert.ok(headers['Set-Cookie'].some(cookie => cookie.startsWith('authToken=token-1;')));
  // Signing in twice in one response does not stack two tokens.
  setAuthCookie(res, 'token-2');
  assert.equal(headers['Set-Cookie'].filter(cookie => cookie.startsWith('authToken=')).length, 1);
});

test('customers are counted at every sign-in, staff never; the screen shows the message', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
  const session = read('api/lib/singleSession.js');
  assert.match(session, /if \(!allowConcurrent\) await registerCustomerDevice\(conn, \{ tenantId, userId, req \}\);/);
  const auth = read('api/routes/auth.js');
  assert.equal(auth.split('await registerCustomerDevice(conn, { tenantId, userId: id, req });').length - 1, 2, 'both sign-ups');
  assert.match(auth, /err\?\.code === 'DEVICE_LIMIT' && !res\.headersSent/);
  const screen = read('client/pages/Auth.tsx');
  assert.match(screen, /\['DEVICE_LIMIT', 'ACCOUNT_SHARING_LOCKED'\]\.includes/);
  const migration = read('api/migrations/221_v26_customer_devices.sql');
  assert.match(migration, /UNIQUE KEY uq_customer_device \(tenant_id, user_id, device_hash\)/);
});
