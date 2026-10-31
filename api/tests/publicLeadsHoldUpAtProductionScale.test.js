'use strict';

// 31 Oct 2026, from the pre-deploy rehearsal of CI's burst smoke (40 public lead forms at once) on the lab at production size: it answered 500
// (DB getConnection timeout) or timed out for half of them, on origin/main as well. One form took 1.2 s at 150,000 leads and 1.0 s at 600,000
// because of two full-table reads made while holding a pooled connection:
//   1. «is this number already a lead?» — REGEXP_REPLACE(phone,'[^0-9]','') IN (...) over every lead, inside the transaction;
//   2. «how many open leads has each rep?» — a GROUP BY over every open lead, to pick the rep.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-scale-secret-0123456789-abcdefghijklmnopqr';
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const { leadPhoneClause, phoneIdentityClause } = require('../lib/leadMatching');

test('«is it already a lead» reads an indexed column, and still finds every spelling of the number', () => {
  const clause = leadPhoneClause('+20 101 234 5678');
  assert.match(clause.sql, /^phone_digits IN \(\?(,\?)*\)$/);
  assert.deepEqual(clause.params, phoneIdentityClause('+20 101 234 5678').params, 'the same spellings as the clause the other tables use');
  assert.ok(clause.params.includes('201012345678') && clause.params.includes('1012345678'));
  assert.equal(leadPhoneClause(''), null);
  assert.equal(leadPhoneClause('not a number'), null, 'no number, no clause: never a match-everything term');
  assert.ok(leadPhoneClause('01012345678', 'l.phone_digits').sql.startsWith('l.phone_digits IN ('), 'an aliased column');
});

test('migration 351 adds the digits as a virtual column with an index, and the lead lookups use it', () => {
  const sql = read('migrations/351_v26_lead_phone_digits.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS phone_digits VARCHAR\(64\) AS \(REGEXP_REPLACE\(phone,'\[\^0-9\]',''\)\) VIRTUAL/);
  assert.match(sql, /ADD INDEX IF NOT EXISTS idx_leads_tenant_phone_digits \(tenant_id, phone_digits\)/);
  for (const [file, name] of [['lib/publicLead.js', 'public lead filing'], ['routes/lead-capture-crm.js', 'lead capture'], ['lib/leadMatching.js', 'findLeadByContact']]) {
    const source = read(file);
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ''), /REGEXP_REPLACE\(phone/, `${name} still rewrites every phone`);
  }
  assert.match(read('lib/publicLead.js'), /leadPhoneClause\(normPhone\)/);
  assert.match(read('lib/whatsappWebStore.js'), /FROM leads WHERE tenant_id=\? AND hidden=0 AND \$\{leadClause\.sql\}/);
});

test('the one-lead path reads the reps\' open counts at most a few seconds old, and counts its own assignments on top; everyone else reads fresh', async () => {
  const { getNextSalesRep, SINGLE_LEAD_LOADS_TTL_MS } = require('../lib/leadAssignment');
  assert.ok(SINGLE_LEAD_LOADS_TTL_MS > 0 && SINGLE_LEAD_LOADS_TTL_MS <= 5000);
  let loadReads = 0;
  const db = {
    async query(sql) {
      if (/COUNT\(\*\) active_leads/.test(sql)) { loadReads += 1; return [[{ assigned_sales_id: 'r-a', active_leads: 3 }, { assigned_sales_id: 'r-b', active_leads: 3 }]]; }
      if (/FROM staff s/.test(sql)) return [[{ id: 'r-a', name: 'A', policy_id: null }, { id: 'r-b', name: 'B', policy_id: null }]];
      if (/MAX\(assigned_at\)/.test(sql)) return [[]];
      return [[]];
    },
  };
  const pick = (extra = {}) => getNextSalesRep('t-cache', db, { mode: 'least', ...extra });

  const fresh = [await pick(), await pick()];
  assert.equal(loadReads, 2, 'without the option every pick reads the table');
  assert.equal(fresh[0].id, fresh[1].id, 'and, with nothing changing, picks the same rep');

  loadReads = 0;
  const burst = [];
  for (let i = 0; i < 6; i += 1) burst.push((await pick({ loadsTtlMs: SINGLE_LEAD_LOADS_TTL_MS })).id);
  assert.equal(loadReads, 1, 'six leads of one burst read the table once');
  assert.deepEqual(burst.filter(id => id === 'r-a').length, 3, 'and are still shared out by load: three each, not six to whoever was lightest');
  assert.deepEqual(burst.filter(id => id === 'r-b').length, 3);
});

test('only the website\'s one-lead calls opt in; the distribution screens and the batch assigner read fresh', () => {
  const lib = read('lib/leadAssignment.js');
  assert.match(lib, /const loadByStaff = await openLoads\(tenantId, db, options\.loadsTtlMs\);/);
  assert.match(lib, /if \(rep && options\.loadsTtlMs > 0\) noteAssigned\(tenantId, rep\.id\);/);
  assert.doesNotMatch(lib.slice(lib.indexOf('async function createBatchAssigner')), /loadsTtlMs/);
  assert.match(read('lib/publicLead.js'), /loadsTtlMs: SINGLE_LEAD_LOADS_TTL_MS/);
  assert.equal((read('routes/lead-capture-crm.js').match(/loadsTtlMs: SINGLE_LEAD_LOADS_TTL_MS/g) || []).length, 2);
});
