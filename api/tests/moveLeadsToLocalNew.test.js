'use strict';

// «محتاج من صفحة الجدول او صفحة محلي قديم اقدر اوّل داتا لمحلي جديد واقدر احولها عميل
// عميل او دفعة كاملة» (13 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

const stub = (rel, exports) => { const file = require.resolve(rel); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };

let leadRows = [];
const statements = [];
const pool = {
  query: async (sql, params = []) => {
    const flat = String(sql).replace(/\s+/g, ' ').trim();
    statements.push({ sql: flat, params });
    if (/^SELECT l\.id, l\.source, l\.status, l\.crm_json FROM leads l/.test(flat)) return [leadRows];
    if (/^UPDATE leads/.test(flat)) return [{ affectedRows: params.filter(p => typeof p === 'string' && p.startsWith('lead-')).length }];
    return [[]];
  },
};
const pass = (req, res, next) => next();
stub('../routes/admin/leads/_shared', {
  pool, LEAD_STATUSES: new Set(), isOpenLeadStatus: () => true, sanitize: x => x, sendRouteError: (res, error) => res.status(500).json({ error: error.message }),
  createNotification: async () => {}, logLeadEventStrict: async () => {}, createRepRotation: () => ({}), distributionMode: () => 'rr',
  listDistributableReps: async () => [], excludeArchiveSourcesSql: () => ({ sql: '', params: [] }), queueLeadWhatsAppBatch: async () => {},
  leadScope: require('../lib/leadAccess').leadScope,
  uuidv4: (() => { let n = 0; return () => `tl-${++n}`; })(),
  requireAuth: pass, requireAdminOrStaff: pass, requirePermission: () => pass, bulkOperationLimiter: pass,
  logger: { info() {}, warn() {}, error() {} },
});

const router = require('../routes/admin/leads/assignment');
const layer = router.stack.find(l => l.route && l.route.path === '/api/admin/leads/move-to-local-new');
const handler = layer.route.stack[layer.route.stack.length - 1].handle;

const manager = { id: 'm1', role: 'online_manager', data_scope: 'all' };
async function call(body, staffRecord = manager) {
  statements.length = 0;
  const out = {};
  await handler({ tenantId: 't1', body, staffRecord, isSuperAdmin: false, user: { email: 'm@x.com' } }, {
    status(code) { out.status = code; return this; }, json(value) { out.body = value; return this; },
  });
  return out;
}

test('an archive lead gets its earlier source back, a table lead is taken from its rep', async () => {
  leadRows = [
    { id: 'lead-1', source: 'محلي قديم', status: 'new', crm_json: JSON.stringify({ archivedFromSource: 'فيسبوك' }) },
    { id: 'lead-2', source: 'محلي قديم — شيت 3', status: 'archived', crm_json: null },
    { id: 'lead-3', source: 'واتساب', status: 'contacted', crm_json: '{}' },
  ];
  const result = await call({ leadIds: ['lead-1', 'lead-2', 'lead-3'] });
  assert.equal(result.status, undefined);
  assert.deepEqual(result.body, { ok: true, moved: 3, skipped: 0 });
  const updates = statements.filter(s => /^UPDATE leads/.test(s.sql));
  const landings = updates.map(update => update.params[2]);
  assert.ok(landings.includes('فيسبوك'), 'the lead archived from «فيسبوك» goes back to it');
  assert.ok(landings.includes('محلي جديد — منقول'), 'one with no earlier source gets the default');
  for (const update of updates) {
    assert.match(update.sql, /assigned_sales_id = NULL, assigned_sales_name = NULL, assigned_cs_id = NULL, assigned_cs_name = NULL/);
    assert.match(update.sql, /hidden = 0/);
    assert.match(update.sql, /WHEN LOWER\(status\) IN \('archived', 'not_interested_hidden'\) THEN 'new'/);
    assert.match(update.sql, /NOT IN \('converted', 'won'\)/, 'a client is never moved');
  }
  const timeline = statements.filter(s => /^INSERT INTO lead_timeline/.test(s.sql));
  assert.ok(timeline.length >= 1);
  assert.ok(timeline.flatMap(s => s.params).includes('moved_to_local_new'));
});

test('a whole batch moves by its source, inside the caller’s scope, and a dry run only counts', async () => {
  leadRows = [{ id: 'lead-1', source: 'محلي قديم — شيت 3', status: 'new', crm_json: '{}' }, { id: 'lead-2', source: 'محلي قديم — شيت 3', status: 'new', crm_json: '{}' }];
  const dry = await call({ source: 'محلي قديم — شيت 3', dryRun: true });
  assert.deepEqual(dry.body, { ok: true, dryRun: true, matched: 2 });
  assert.equal(statements.filter(s => /^UPDATE/.test(s.sql)).length, 0, 'nothing written');
  const select = statements.find(s => /^SELECT l\.id/.test(s.sql));
  assert.match(select.sql, /TRIM\(l\.source\) = \?/);
  assert.ok(select.params.includes('محلي قديم — شيت 3'));
  assert.match(select.sql, /l\.merged_into_lead_id IS NULL AND l\.deleted_at IS NULL/);
});

test('a lead outside the caller’s own scope is not in the selection at all', async () => {
  leadRows = [];
  await call({ leadIds: ['lead-9'] }, { id: 'tm1', role: 'daqqi_manager', data_scope: 'branch:DAQQI' });
  const select = statements.find(s => /^SELECT l\.id/.test(s.sql));
  assert.match(select.sql, /l\.branch IN|assigned_sales_id IN|assigned_sales_id/, 'the lead scope’s own SQL is applied');
});

test('nothing chosen, a rep, or a collection officer is refused', async () => {
  assert.equal((await call({})).status, 400);
  assert.equal((await call({}, manager)).body.code, 'NOTHING_CHOSEN');
  assert.equal((await call({ leadIds: ['lead-1'] }, { id: 'r1', role: 'sales' })).status, 403);
  assert.equal((await call({ leadIds: ['lead-1'] }, { id: 'c1', role: 'collection' })).status, 403);
  assert.equal((await call({ leadIds: Array.from({ length: 20001 }, (_, i) => `lead-${i}`) })).body.code, 'TOO_MANY');
});

test('the table and «محلي قديم» both carry the controls — one at a time, a hand-picked group, a whole batch', () => {
  const table = read('admin/pages/dashboard/tabs/LeadTable.tsx');
  assert.match(table, /<MoveBatchToLocalNew rows=\{rows\} reloadLeads=\{reloadLeads\} \/>/);
  assert.match(table, /<MoveSelectedToLocalNew selectedIds=\{selectedIds\}/);
  assert.match(table, /canManageLeads && !isSalesOnly && <MoveBatchToLocalNew/);
  const controls = read('admin/pages/dashboard/tabs/leads/MoveToLocalNew.tsx');
  assert.match(controls, /\/admin\/leads\/move-to-local-new/);
  assert.match(controls, /moveToLocalNew\(\{ leadIds: selectedIds \}\)/);
  assert.match(controls, /moveToLocalNew\(\{ source \}\)/);
  // The archive tab and the data table are the same table component.
  assert.match(read('admin/pages/dashboard/tabs/leads/ArchiveTab.tsx'), /<LeadTable\s+rows=\{archiveLeads\}/);
});
