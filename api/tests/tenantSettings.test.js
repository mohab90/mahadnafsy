'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getTenantSetting, setTenantSetting } = require('../lib/tenantSettings');

test('tenant settings are always queried by tenant and key', async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    return [[{ config_json: JSON.stringify({ enabled: true }) }]];
  } };
  const output = await getTenantSetting('sys_payment_gateway', { tenantId: 'tenant-a', db });
  assert.deepEqual(output, { enabled: true });
  assert.deepEqual(calls[0].params, ['tenant-a', 'sys_payment_gateway']);
});

test('legacy site_config fallback is restricted to the default tenant', async () => {
  const missing = new Error("Table 'tenant_settings' doesn't exist");
  const defaultDb = { query: async sql => {
    if (sql.includes('tenant_settings')) throw missing;
    return [[{ value: '{"legacy":true}' }]];
  } };
  assert.deepEqual(
    await getTenantSetting('sys_general', { tenantId: 'tenant-default', db: defaultDb }),
    { legacy: true }
  );

  const isolatedDb = { query: async () => { throw missing; } };
  await assert.rejects(
    () => getTenantSetting('sys_general', { tenantId: 'tenant-b', db: isolatedDb }),
    /doesn't exist/
  );
});

test('tenant settings upsert includes tenant identity and actor', async () => {
  let captured;
  const db = { query: async (sql, params) => { captured = { sql, params }; return [{}]; } };
  await setTenantSetting('sys_otp_provider', { enabled: true }, { tenantId: 'tenant-a', actorId: 'user-1', db });
  assert.match(captured.sql, /INSERT INTO tenant_settings/);
  assert.equal(captured.params[1], 'tenant-a');
  assert.equal(captured.params[2], 'sys_otp_provider');
  assert.equal(captured.params[3], '{"enabled":true}');
  assert.equal(captured.params[4], 1);
});
