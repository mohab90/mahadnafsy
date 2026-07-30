'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listOnlineUsers, onlineMap, setOnlineUser } = require('../lib/onlineUsers');

test('development presence is tenant isolated', async () => {
  const previous = process.env.RATE_LIMIT_REDIS_ENABLED;
  process.env.RATE_LIMIT_REDIS_ENABLED = 'false';
  onlineMap.clear();
  await setOnlineUser('tenant-a', 'same-user', { name: 'A', email: 'a@example.com' });
  await setOnlineUser('tenant-b', 'same-user', { name: 'B', email: 'b@example.com' });
  const a = await listOnlineUsers('tenant-a');
  const b = await listOnlineUsers('tenant-b');
  assert.deepEqual(a.map(user => user.name), ['A']);
  assert.deepEqual(b.map(user => user.name), ['B']);
  onlineMap.clear();
  if (previous === undefined) delete process.env.RATE_LIMIT_REDIS_ENABLED;
  else process.env.RATE_LIMIT_REDIS_ENABLED = previous;
});

test('production presence uses the distributed store and canonical authenticated name', () => {
  const moduleSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'onlineUsers.js'), 'utf8');
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'public.js'), 'utf8');
  assert.match(moduleSource, /redis\.pipeline\(\)/);
  assert.match(moduleSource, /hashKey\(tenantId\)/);
  assert.match(routeSource, /name: req\.user\.name \|\| req\.user\.email/);
  assert.doesNotMatch(routeSource, /name: \(req\.body\?\.name/);
});
