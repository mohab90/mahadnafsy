'use strict';

// 26 Oct 2026, after the review of the production log and the code: the biggest piece of waste in the API's traffic, the delete right that
// followed a spelling, and the code that nothing used.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-cleanup-0123456789abcdef0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('the join-us list is downloaded again only when its fingerprint changed — it was 13% of the API\'s traffic', () => {
  const route = read('api/routes/admin-operations.js');
  const handler = route.slice(route.indexOf("router.get('/api/admin/join-us/fingerprint'"), route.indexOf("router.get('/api/admin/join-us', requireAuth,"));
  assert.match(handler, /requireAnyPermission\('view_join_us', 'branch_hr'\), requireRecruiting\('view_join_us'\)/, 'the same guards as the list');
  assert.match(handler, /const \{ where, params \} = joinUsWhere\(req\)/, 'the same scope as the list');
  assert.match(handler, /\$\{JOIN_US_FROM\} \$\{where\}/);
  assert.match(handler, /CRC32\(CONCAT_WS/);
  // Registered before the list (and the :id-style routes after it can never swallow it).
  assert.ok(route.indexOf("'/api/admin/join-us/fingerprint'") < route.indexOf("router.get('/api/admin/join-us', requireAuth,"));
  const client = read('admin/context/site-data-hooks/useCrmCoreState.ts');
  assert.match(client, /mysqlAdmin\.joinUsFingerprint\(\)/);
  assert.match(client, /known\.value === value && known\.quiet < 9/, 'a quiet poll downloads nothing, the tenth downloads anyway');
  assert.match(client, /if \(!options\?\.force\)/, 'an explicit reload is never skipped');
  assert.match(read('admin/lib/mysqlapi.ts'), /joinUsFingerprint:\s+\(\) => apiFetch<\{ fingerprint: string \}>\('\/admin\/join-us\/fingerprint'/);
});

test('the delete right that followed a spelling of a name is written down once, for the people it names today', async () => {
  const rights = require('../lib/deleteRights');
  const store = new Map();
  const staff = [{ id: 's-walid', name: 'وليد حسن' }, { id: 's-nashwa', name: 'نشوى' }, { id: 's-mohab', name: 'Mohab Mostafa' }];
  const db = {
    query: async (sql, params) => {
      if (/FROM staff/.test(sql)) return [staff];
      if (/FROM tenant_settings/.test(sql)) return [store.has(params[0]) ? [{ config_json: JSON.stringify(store.get(params[0])) }] : []];
      if (/FROM site_config/.test(sql)) return [[]];
      if (/INSERT INTO tenant_settings/.test(sql)) { store.set(params[1], JSON.parse(params[3])); return [{ affectedRows: 1 }]; }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  rights.invalidateDeleteRights();
  const first = await rights.freezeDefaultDeleteRights('t-freeze', { db });
  assert.equal(first.frozen, true);
  assert.deepEqual(first.names.sort(), ['Mohab Mostafa', 'وليد حسن'].sort());
  assert.deepEqual(store.get('t-freeze').staffIds.sort(), ['s-mohab', 's-walid']);
  // Saved: a second run changes nothing, and a person hired later with the same name does not get the right.
  staff.push({ id: 's-new-mohab', name: 'مهاب جديد' });
  rights.invalidateDeleteRights();
  assert.deepEqual(await rights.freezeDefaultDeleteRights('t-freeze', { db }), { frozen: false, reason: 'already saved' });
  const now = await rights.resolveDeleteRights('t-freeze', { db, fresh: true });
  assert.equal(now.saved, true);
  assert.deepEqual([...now.staffIds].sort(), ['s-mohab', 's-walid']);
  // Nobody matches yet: nothing is written, so the rule can still find the owner when they are added.
  const empty = await rights.freezeDefaultDeleteRights('t-empty', { db: { query: async sql => (/FROM staff/.test(sql) ? [[{ id: 'x', name: 'نشوى' }]] : [[]]) } });
  assert.equal(empty.frozen, false);
  assert.match(read('api/lib/backgroundScheduler.js'), /lockedJob\('delete_rights_freeze'/);
});

test('code nothing used is gone: the unreferenced openapi builder, and helpers only their own file named', () => {
  assert.equal(fs.existsSync(path.join(root, 'api/lib/openapi.js')), false);
  assert.equal(read('api/routes/docs.js').includes("lib/openapi"), false, 'the docs route serves the curated api/docs/openapi.json');
  assert.ok(fs.existsSync(path.join(root, 'api/docs/openapi.json')));
  assert.doesNotMatch(read('api/lib/branchesRepo.js'), /branchKeys/);
  assert.doesNotMatch(read('api/lib/saasSettings.js'), /getBranchWorkspaces|function tryParseJson/);
  assert.doesNotMatch(read('api/lib/crmSequences.js'), /TERMINAL_STATUSES/);
  assert.doesNotMatch(read('api/lib/physicalBranches.js'), /RECEPTION_ROLES/);
});
