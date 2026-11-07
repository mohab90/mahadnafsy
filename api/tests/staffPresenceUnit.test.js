'use strict';
/**
 * «مين فاتح السيستم دلوقتي»: the thresholds (online < 2 min, idle < 15 min), how a time is worded on the screen (the admin's own presenceFormat.ts, bundled with
 * esbuild and run), and who holds view_presence — the wildcard roles and nobody else, until the owner ticks it for a person.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderAdmin } = require('./_renderAdmin');
const { statusOf, ONLINE_MS, IDLE_MS } = require('../lib/staffPresence');
const { hasPermission, ROLES, PERMISSIONS } = require('../constants/permissions');

const fmt = renderAdmin('admin/lib/presenceFormat.ts');
const skip = !fmt && 'admin dependencies are not installed';
const MIN = 60 * 1000;

test('online under two minutes, idle under fifteen, offline after; nobody seen is offline', () => {
  const now = Date.now();
  assert.equal(statusOf(now - (ONLINE_MS - 1000), now), 'online');
  assert.equal(statusOf(now - ONLINE_MS, now), 'idle');
  assert.equal(statusOf(now - (IDLE_MS - 1000), now), 'idle');
  assert.equal(statusOf(now - IDLE_MS, now), 'offline');
  assert.equal(statusOf(undefined, now), 'offline');
  assert.equal(statusOf(null, now), 'offline');
});

test('how long ago is said the way people say it', { skip }, () => {
  const { agoAr, agoFrom } = fmt.module;
  const said = {
    0: 'دلوقتي', 59_000: 'دلوقتي', [MIN]: 'من دقيقة', [2 * MIN]: 'من دقيقتين', [7 * MIN]: 'من 7 دقايق', [11 * MIN]: 'من 11 دقيقة',
    [60 * MIN]: 'من ساعة', [120 * MIN]: 'من ساعتين', [5 * 60 * MIN]: 'من 5 ساعات', [24 * 60 * MIN]: 'من يوم', [3 * 24 * 60 * MIN]: 'من 3 أيام',
  };
  for (const [ms, text] of Object.entries(said)) assert.equal(agoAr(Number(ms)), text, ms);
  assert.equal(agoAr(-5000), 'دلوقتي', 'a clock a little ahead is still «now»');
  assert.equal(agoFrom(null, 0), '—');
  assert.equal(agoFrom('not a time', 0), '—');
  assert.equal(agoFrom(new Date(1_000_000).toISOString(), 1_000_000 + 7 * MIN), 'من 7 دقايق');
});

test('view_presence is the owner\'s and the managers\' — no other role has it by default, a ticked grid gives it to one person', () => {
  assert.ok(PERMISSIONS.VIEW_PRESENCE);
  for (const role of ['admin', 'manager']) assert.equal(hasPermission({ role, tenant_id: 't' }, 'view_presence'), true, role);
  for (const role of Object.values(ROLES).filter(r => !['admin', 'manager'].includes(r))) {
    assert.equal(hasPermission({ role, tenant_id: 't' }, 'view_presence'), false, role);
  }
  assert.equal(hasPermission({ role: 'sales', tenant_id: 't', permissions_json: JSON.stringify(['view_presence']) }, 'view_presence'), true);
});
