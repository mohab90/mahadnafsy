'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { listPipeline, savePipeline, validateTransition } = require('../lib/leadPipeline');
const { getNextSalesRep } = require('../lib/leadAssignment');

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
