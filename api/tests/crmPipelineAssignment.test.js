'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { listPipeline, savePipeline, validateTransition } = require('../lib/leadPipeline');
const { createRepRotation, getNextSalesRep, listDistributableReps } = require('../lib/leadAssignment');

function pipelineDb(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM crm_pipeline_stages')) return [rows];
      return [{ affectedRows: 1 }];
    },
  };
}

test('tenant pipeline controls order, visibility and allowed server transitions', async () => {
  const db = pipelineDb([
    {
      status_key: 'new', label: 'وارد جديد', position: 1, show_in_pipeline: 1,
      is_terminal: 0, allowed_next_json: '["contacted"]',
    },
  ]);
  const stages = await listPipeline('tenant-a', db);
  assert.equal(stages[0].status, 'new');
  assert.equal(stages[0].label, 'وارد جديد');
  await validateTransition('tenant-a', 'new', 'contacted', db);
  await assert.rejects(
    () => validateTransition('tenant-a', 'new', 'lost', db),
    /not allowed/
  );
  assert.ok(db.calls.every(call => call.params?.[0] === 'tenant-a'));
});

test('pipeline save rejects unknown statuses and upserts tenant-owned configuration', async () => {
  const db = pipelineDb([]);
  await assert.rejects(
    () => savePipeline('tenant-a', [{ status: 'unknown', label: 'x' }], db),
    /Invalid lead status/
  );
  await savePipeline('tenant-a', [{
    status: 'new', label: 'جديد', position: 10, showInPipeline: true,
    isTerminal: false, allowedNext: ['contacted'],
  }], db);
  const upsert = db.calls.find(call => call.sql.includes('INSERT INTO crm_pipeline_stages'));
  assert.equal(upsert.params[0], 'tenant-a');
  assert.equal(upsert.params[1], 'new');
});

test('assignment picker honors branch policy, availability, capacity and weighted load', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM staff s')) return [[
        { id: 'rep-a', name: 'A', policy_id: 'p-a', branch_key: '*', weight: 1, max_open_leads: 20, is_available: 1, last_assigned_at: null },
        { id: 'rep-b', name: 'B', policy_id: 'p-b', branch_key: 'DAQQI', weight: 2, max_open_leads: 10, is_available: 1, last_assigned_at: null },
        { id: 'rep-c', name: 'C', policy_id: 'p-c', branch_key: 'DAQQI', weight: 10, max_open_leads: 1, is_available: 1, last_assigned_at: null },
      ]];
      if (sql.includes('COUNT(*) active_leads')) return [[
        { assigned_sales_id: 'rep-a', active_leads: 4 },
        { assigned_sales_id: 'rep-b', active_leads: 2 },
        { assigned_sales_id: 'rep-c', active_leads: 1 },
      ]];
      return [{ affectedRows: 1 }];
    },
  };
  const rep = await getNextSalesRep('tenant-a', db, { branch: 'DAQQI' });
  assert.deepEqual(rep, { id: 'rep-b', name: 'B' });
  assert.ok(calls.some(call => call.sql.includes('last_assigned_at=NOW()') && call.params[0] === 'p-b'));
});

function assignmentDb(staffRows, loads = []) {
  return {
    async query(sql) {
      if (sql.includes('FROM staff s')) return [staffRows];
      if (sql.includes('COUNT(*) active_leads')) return [loads];
      return [{ affectedRows: 1 }];
    },
  };
}

test('a rep missing from the distribution screen receives nothing once the screen is saved', async () => {
  // rep-new was hired after the screen was saved: no policy row. With zero open
  // leads the old picker handed them every lead under "least loaded".
  const db = assignmentDb([
    { id: 'rep-a', name: 'A', policy_id: 'p-a', branch_key: '*', weight: 1, max_open_leads: null, is_available: 1 },
    { id: 'rep-new', name: 'New', policy_id: null, branch_key: null, weight: null, max_open_leads: null, is_available: null },
    { id: 'rep-off', name: 'Off', policy_id: 'p-off', branch_key: '*', weight: 1, max_open_leads: null, is_available: 0 },
  ], [{ assigned_sales_id: 'rep-a', active_leads: 500 }]);
  const reps = await listDistributableReps('tenant-a', db);
  assert.deepEqual(reps.map(rep => rep.id), ['rep-a']);
  assert.deepEqual(await getNextSalesRep('tenant-a', db), { id: 'rep-a', name: 'A' });
});

test('a tenant that never saved the distribution screen distributes to every active rep', async () => {
  const db = assignmentDb([
    { id: 'rep-a', name: 'A', policy_id: null },
    { id: 'rep-b', name: 'B', policy_id: null },
  ]);
  const rotation = createRepRotation(await listDistributableReps('tenant-a', db), { mode: 'rr', start: 1 });
  assert.deepEqual([rotation.next().id, rotation.next().id, rotation.next().id], ['rep-b', 'rep-a', 'rep-b']);
  assert.equal(rotation.index, 4);
});

test('batch rotation stops giving a rep leads at their cap', async () => {
  const db = assignmentDb([
    { id: 'rep-a', name: 'A', policy_id: 'p-a', branch_key: '*', weight: 1, max_open_leads: 1, is_available: 1 },
    { id: 'rep-b', name: 'B', policy_id: 'p-b', branch_key: '*', weight: 1, max_open_leads: 2, is_available: 1 },
  ]);
  const rotation = createRepRotation(await listDistributableReps('tenant-a', db), { mode: 'least' });
  assert.deepEqual([rotation.next()?.id, rotation.next()?.id, rotation.next()?.id, rotation.next()], ['rep-a', 'rep-b', 'rep-b', null]);
});
