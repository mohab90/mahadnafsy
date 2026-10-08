'use strict';

// From the production log, 5–7 Oct 2026: screens an online or collection
// account opens asked for data behind view_leads, a key those accounts do not
// hold — the online clients' custom tabs (88 refusals) and the targets of
// «فريق الأونلاين والتحصيل» (113, shown as «تعذر تحميل أهداف فريق الأونلاين
// والتحصيل»). Each read now takes the keys of the screens that show it; HR,
// whose screens show neither, is still refused.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-online-reads-secret-0123456789-abcdefghijklm';

const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/mfaPolicy', { getMfaPolicy: async () => ({ enabled: false }), policyRequiresStaff: () => false });

const guardOf = (router, path) => {
  const layers = router.stack.find(l => l.route && l.route.path === path && l.route.methods.get).route.stack;
  return layers[layers.length - 2].handle; // the permission check, just before the handler
};
async function allowed(guard, staffRecord) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() { return this; } };
  let through = false;
  await guard({ staffRecord, tenantId: 'tenant-default', user: { uid: 'u' } }, res, () => { through = true; });
  return through;
}

const officer = { id: 'st-coll', role: 'collection', permissions_json: null };
const onlineManager = { id: 'st-om', role: 'online_manager', permissions_json: null };
const hr = { id: 'st-hr', role: 'hr', permissions_json: null };

test('the online clients screen reads its own custom tabs', async () => {
  const guard = guardOf(require('../routes/section-tabs'), '/api/admin/section-tabs');
  assert.equal(await allowed(guard, officer), true);
  assert.equal(await allowed(guard, hr), false);
});

test('«فريق الأونلاين والتحصيل» reads its targets', async () => {
  const guard = guardOf(require('../routes/analytics/sales'), '/api/admin/sales-targets');
  assert.equal(await allowed(guard, onlineManager), true);
  assert.equal(await allowed(guard, hr), false);
});
