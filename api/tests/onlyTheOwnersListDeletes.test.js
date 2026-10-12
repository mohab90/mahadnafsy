'use strict';
/**
 * «شيل من صلاحيات اي شخص غير المدير وليد وحازم ومهاب الحذف اي ما كان سواء نشوى
 * او خلود حذف عميل او حذف موظف او حذف حتي شخص منضم» — the owner, 12 Oct 2026.
 *
 * "Anything" is only true if it stays true as routes are added, so this walks
 * the stack the API actually builds: the guard must sit in front of every
 * router on /api/admin and /api/staff, and every DELETE route behind it must be
 * refused to someone off the list — except the few EXEMPT_DELETE_ROUTES names,
 * each with its reason. A new DELETE route is covered without anyone touching
 * this file; a new exemption has to be written down to pass.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-delete-rights-secret-0123456789-abcdef';
process.env.ADMIN_EMAILS = 'owner@unit.test';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const rights = require('../lib/deleteRights');

// Requiring every router opens the pools and timers they hold; nothing here
// needs them, so the file ends once its tests have.
after(() => setTimeout(() => process.exit(), 300).unref());

function routesOf(stack, out = []) {
  for (const layer of stack || []) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        for (const routePath of [].concat(layer.route.path)) out.push({ method: method.toUpperCase(), path: routePath, stack: layer.route.stack });
      }
    } else if (layer.handle?.stack) routesOf(layer.handle.stack, out);
  }
  return out;
}

function fakeResponse() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
}

test('the guard stands in front of every router, and every DELETE behind it is refused off the list', () => {
  const { createHttpApp } = require('../lib/httpApp');
  const app = createHttpApp({ pool: { query: async () => [[]] }, brandAssetRoot: os.tmpdir() });
  const stack = app._router.stack;
  const firstRouter = stack.findIndex(layer => layer.name === 'router');
  assert.ok(firstRouter > 0, 'the app mounts its routers');
  const guards = stack.map((layer, index) => ({ layer, index })).filter(({ layer }) => layer.handle?.name === 'deleteRightsGuard');
  for (const prefix of ['/api/admin/anything', '/api/staff/anything']) {
    const mounted = guards.find(({ layer }) => layer.regexp.test(prefix));
    assert.ok(mounted, `no delete guard on ${prefix}`);
    assert.ok(mounted.index < firstRouter, `the delete guard on ${prefix} runs after the routers — it would never be asked`);
  }

  const deletes = stack.slice(firstRouter)
    .flatMap(layer => (layer.name === 'router' ? routesOf(layer.handle.stack) : []))
    .filter(route => route.method === 'DELETE' && /^\/api\/(admin|staff)\//.test(String(route.path)));
  // A denominator, so «nothing slipped through» means nothing, not «read nothing».
  assert.ok(deletes.length >= 65, `only ${deletes.length} DELETE routes found under /api/admin and /api/staff`);

  const guard = rights.createDeleteRightsGuard({
    decide: (_req, res) => res.status(403).json({ code: rights.REFUSAL_CODE }),
  });
  const open = [];
  for (const route of deletes) {
    const url = String(route.path).replace(/:[A-Za-z_]+/g, 'x1');
    const res = fakeResponse();
    let passed = false;
    guard({ method: 'DELETE', originalUrl: url, url, user: { uid: 'u-nashwa' } }, res, () => { passed = true; });
    if (passed) open.push(`DELETE ${route.path}`);
    else assert.equal(res.statusCode, 403, `DELETE ${route.path} was neither refused nor let through`);
  }
  // Exactly the documented exemptions — no more, and none left behind for a
  // route that no longer exists.
  assert.deepEqual(open.sort(), rights.EXEMPT_DELETE_ROUTES.map(entry => entry.route).sort());
  for (const entry of rights.EXEMPT_DELETE_ROUTES) assert.ok(entry.reason && entry.reason.length > 30, `${entry.route} has no reason`);
});

test('the guard leaves every other method alone', () => {
  const guard = rights.createDeleteRightsGuard({ decide: () => assert.fail('decide asked for a read') });
  for (const method of ['GET', 'POST', 'PUT', 'PATCH']) {
    let passed = false;
    guard({ method, originalUrl: '/api/admin/subscribers/x1', user: { uid: 'u' } }, fakeResponse(), () => { passed = true; });
    assert.ok(passed, method);
  }
});

test('the deletions that travel as POST carry the same check', () => {
  const { routeModules } = require('../lib/registerRoutes');
  const all = routeModules.flatMap(([, mod]) => routesOf(require(path.join(__dirname, '..', 'lib', mod)).stack));
  const guarded = [
    'POST /api/admin/cleanup-junk-leads',
    'POST /api/admin/cleanup-staff-subscribers',
    'POST /api/admin/fix-auto-subscribers',
    'POST /api/admin/fix-all-codes',
    'POST /api/admin/leads/dedup-cleanup',
    'POST /api/admin/leads/gsheet-remove',
    'POST /api/admin/subscribers/:id/course-remove',
    'POST /api/admin/subscribers/:id/convert-to-lead',
    'POST /api/admin/privacy/requests/:id/decision',
  ];
  for (const key of guarded) {
    const route = all.find(item => `${item.method} ${item.path}` === key);
    assert.ok(route, `${key} is gone — move its check with it`);
    const names = route.stack.map(layer => layer.handle?.name);
    assert.ok(names.includes('requireDeleteRight') || names.includes('requireDeleteRightWhenAsked'), `${key} lost its delete check`);
  }
});

test('the two own-rows exemptions narrow to your own rows in the handler', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', 'routes', rel), 'utf8');
  const tasks = read('campaigns.js');
  const taskDelete = tasks.slice(tasks.indexOf("router.delete('/api/admin/tasks/:id'"));
  assert.match(taskDelete.slice(0, 900), /const ownOnly = !await canDelete\(req\);[\s\S]*ownOnly \? ' AND created_by=\?' : ''/);
  const inbox = read('team-inbox.js');
  const replyDelete = inbox.slice(inbox.indexOf("router.delete('/api/admin/team-inbox/quick-replies/:id'"));
  assert.match(replyDelete.slice(0, 1400), /row\.created_by !== me\(req\)\) && !await canDelete\(req\)/);
  for (const entry of rights.EXEMPT_DELETE_ROUTES.filter(item => item.ownRows)) {
    assert.ok(['DELETE /api/admin/tasks/:id', 'DELETE /api/admin/team-inbox/quick-replies/:id'].includes(entry.route), entry.route);
  }
});

test('the default list is Walid, Hazem and Mohab in either spelling, and nobody else', () => {
  for (const name of ['وليد حسن', 'م. حازم', 'مهاب', 'Walid Saeed', 'WALEED', 'Hazem Ali', 'hazim', 'Mohab Mostafa']) {
    assert.ok(rights.DEFAULT_NAME_PATTERN.test(name), name);
  }
  for (const name of ['نشوى', 'خلود سمير', 'Nashwa', 'Kholoud', 'دنيا وائل']) {
    assert.ok(!rights.DEFAULT_NAME_PATTERN.test(name), name);
  }
});

test('the refusal names the people who may', () => {
  assert.equal(rights.refusalMessage(['مهاب عبد الله', 'وليد حسن', 'حازم علي']), 'الحذف لمهاب ووليد وحازم بس');
  assert.equal(rights.refusalMessage(['خلود سمير']), 'الحذف لخلود بس');
  assert.equal(rights.refusalMessage([]), 'الحذف لصاحب المعهد بس');
});

// A stand-in for the pool: the active staff, and whatever tenant_settings holds.
function fakeDb({ staff, saved = null, callerRole = 'manager' }) {
  return {
    async query(sql, params) {
      if (/FROM tenant_settings/.test(sql)) return [saved ? [{ config_json: JSON.stringify(saved) }] : []];
      if (/FROM site_config/.test(sql)) return [[]];
      if (/LOWER\(TRIM\(email\)\)/.test(sql)) {
        const row = staff.find(item => item.email === params[1]);
        return [[row ? { id: row.id, role: callerRole, tenant_id: params[0] } : undefined]];
      }
      if (/FROM staff/.test(sql)) return [staff.map(({ id, name }) => ({ id, name }))];
      throw new Error(`unexpected query ${sql}`);
    },
  };
}

const STAFF = [
  { id: 's-walid', name: 'وليد حسن', email: 'walid@unit.test' },
  { id: 's-hazem', name: 'Hazem Ali', email: 'hazem@unit.test' },
  { id: 's-nashwa', name: 'نشوى', email: 'nashwa@unit.test' },
  { id: 's-kholoud', name: 'خلود', email: 'kholoud@unit.test' },
];
const asStaff = (email, tenantId) => ({ tenantId, user: { uid: `u-${email}`, email, tenant_id: tenantId } });

test('with nothing saved the names decide; once saved, only the saved list does', async () => {
  const tenant = 'tenant-unit-delete-default';
  rights.invalidateDeleteRights();
  const byName = fakeDb({ staff: STAFF });
  const view = await rights.resolveDeleteRights(tenant, { db: byName, fresh: true });
  assert.equal(view.saved, false);
  assert.deepEqual([...view.staffIds].sort(), ['s-hazem', 's-walid']);
  assert.equal(await rights.canDelete(asStaff('walid@unit.test', tenant), { db: byName }), true);
  assert.equal(await rights.canDelete(asStaff('nashwa@unit.test', tenant), { db: byName }), false);
  assert.equal(await rights.canDelete(asStaff('kholoud@unit.test', tenant), { db: byName }), false);

  const savedTenant = 'tenant-unit-delete-saved';
  const saved = fakeDb({ staff: STAFF, saved: { staffIds: ['s-kholoud'] } });
  const savedView = await rights.resolveDeleteRights(savedTenant, { db: saved, fresh: true });
  assert.equal(savedView.saved, true);
  assert.deepEqual([...savedView.staffIds], ['s-kholoud']);
  assert.equal(await rights.canDelete(asStaff('walid@unit.test', savedTenant), { db: saved }), false, 'the name no longer counts');
  assert.equal(await rights.canDelete(asStaff('kholoud@unit.test', savedTenant), { db: saved }), true);
  // An id saved for someone since switched off does not count either.
  const gone = fakeDb({ staff: STAFF.filter(row => row.id !== 's-kholoud'), saved: { staffIds: ['s-kholoud'] } });
  assert.deepEqual([...(await rights.resolveDeleteRights('tenant-unit-delete-gone', { db: gone, fresh: true })).staffIds], []);
});

test('the owner always may, even off a saved list that leaves everyone out', async () => {
  const { DEFAULT_TENANT_ID } = require('../lib/authTenant');
  rights.invalidateDeleteRights();
  const empty = fakeDb({ staff: STAFF, saved: { staffIds: [] } });
  const owner = { tenantId: DEFAULT_TENANT_ID, user: { uid: 'u-owner', email: 'owner@unit.test', tenant_id: DEFAULT_TENANT_ID } };
  assert.equal(await rights.canDelete(owner, { db: empty }), true);
  assert.equal(await rights.canDelete(asStaff('walid@unit.test', DEFAULT_TENANT_ID), { db: empty }), false);
  // In another institute the env list does not reach; its top role is its owner.
  const elsewhere = fakeDb({ staff: STAFF, saved: { staffIds: [] }, callerRole: 'ADMIN' });
  assert.equal(await rights.canDelete(asStaff('nashwa@unit.test', 'tenant-unit-other'), { db: elsewhere }), true);
});

test('the cache forgets a tenant the moment its list is saved', async () => {
  rights.invalidateDeleteRights();
  const tenant = 'tenant-unit-delete-cache';
  const first = fakeDb({ staff: STAFF });
  assert.deepEqual([...(await rights.resolveDeleteRights(tenant, { db: first })).staffIds].sort(), ['s-hazem', 's-walid']);
  const changed = fakeDb({ staff: STAFF, saved: { staffIds: ['s-nashwa'] } });
  assert.deepEqual([...(await rights.resolveDeleteRights(tenant, { db: changed })).staffIds].sort(), ['s-hazem', 's-walid'], 'cached');
  rights.invalidateDeleteRights(tenant);
  assert.deepEqual([...(await rights.resolveDeleteRights(tenant, { db: changed })).staffIds], ['s-nashwa']);
});

test('the panel hides every delete_ permission from someone off the list', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'constants', 'permissions.ts'), 'utf8');
  const fn = panel.slice(panel.indexOf('export function hasPermission('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  const deleteCheck = body.indexOf("startsWith('delete_')");
  assert.ok(deleteCheck > 0, 'hasPermission no longer asks canDelete for delete_ permissions');
  assert.ok(deleteCheck < body.indexOf('FULL_ACCESS_ROLES.includes'), 'a full-access role skips the delete check');
  const auth = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth', 'session.js'), 'utf8');
  assert.match(auth, /permissions: isAdmin \? '\*' : staffPermissions, canDelete, canManageDeleteRights/);
});
