'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { routeModules } = require('../lib/registerRoutes');

test('route registry preserves one ordered mount for every router module', () => {
  assert.equal(routeModules.length, 71);
  assert.deepEqual(routeModules[0], ['/', '../routes/auth']);
  assert.deepEqual(routeModules.at(-1), ['/', '../routes/tenant-domains']);

  const modules = routeModules.map(([, modulePath]) => modulePath);
  assert.equal(new Set(modules).size, modules.length);
  assert.ok(routeModules.some(([mountPath, modulePath]) => (
    mountPath === '/api/student-ai' && modulePath === '../routes/student-ai'
  )));
  assert.ok(routeModules.some(([mountPath, modulePath]) => (
    mountPath === '/' && modulePath === '../routes/whatsapp-webhook'
  )));
  // Messaging channels, the Messenger webhook and WhatsApp campaigns all mount
  // at the root alongside the existing webhooks.
  for (const modulePath of [
    '../routes/messenger-webhook',
    '../routes/messaging-channels',
    '../routes/whatsapp-campaigns',
    '../routes/messaging-inbox',
  ]) {
    assert.ok(routeModules.some(([mountPath, candidate]) => (
      mountPath === '/' && candidate === modulePath
    )), modulePath);
  }
  for (const modulePath of [
    '../routes/crm-forecast',
    '../routes/crm-sequences',
    '../routes/crm-quotes',
    '../routes/crm-coaching',
    '../routes/finance-operations',
  ]) {
    assert.ok(routeModules.some(([mountPath, candidate]) => (
      mountPath === '/' && candidate === modulePath
    )));
  }
});
