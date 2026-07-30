'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBranchCandidates, inferBranchFromLead } = require('../lib/branchInference');

const candidates = buildBranchCandidates([
  { branch_key: 'DAQQI', label: 'فرع الدقي' },
  { branch_key: 'TAGAMOA', label: 'فرع التجمع' },
]);

test('branch inference prioritizes explicit CRM branch data', () => {
  assert.equal(inferBranchFromLead({
    crm_json: JSON.stringify({ rawBranch: 'online-saudi' }),
    notes: 'فرع الدقي',
  }, candidates), 'ONLINE_SAUDI');
});

test('branch inference recognizes a labelled note and dynamic label', () => {
  assert.equal(inferBranchFromLead({ notes: 'الفرع: فرع التجمع | حملة يوليو' }, candidates), 'TAGAMOA');
});

test('branch inference does not silently classify unknown text as OTHER', () => {
  assert.equal(inferBranchFromLead({ notes: 'عميل مهتم بدبلومة جديدة', source: 'facebook' }, candidates), null);
});
