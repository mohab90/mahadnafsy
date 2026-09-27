'use strict';
// «حددت دي بتاخد 5 في اليوم يبقي فعلا السيسيتم بيوزعلها 5 فقط والباقي بيظهر في
// محلي جديد».
//
// On 27 September every rep had a cap of five and four of them received eleven
// or twelve. Three faults, each enough on its own:
//   - the window opened at UTC midnight, 03:00 in Cairo (assignmentQuota.test.js);
//   - «توزيع تلقائي» and the batch rotation filtered a rep once and then kept
//     handing them leads (the rotation is tested in assignmentQuota.test.js);
//   - ten of the twelve paths that assign a rep never wrote assigned_at, which
//     is the column the cap counts — so a lead from the site, the chatbot,
//     Facebook, WhatsApp, Messenger or a bulk assignment never counted at all.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(API, rel), 'utf8');

test('the database stamps assigned_at whenever a lead gets a rep, from any path', () => {
  const sql = read('migrations/216_v26_leads_assigned_at_on_assignment.sql');
  assert.match(sql, /CREATE OR REPLACE TRIGGER trg_leads_assigned_at_insert BEFORE INSERT ON leads/);
  assert.match(sql, /CREATE OR REPLACE TRIGGER trg_leads_assigned_at_update BEFORE UPDATE ON leads/);
  // Only when the rep actually changes, and never over a time the path set itself.
  assert.match(sql, /NOT \(NEW\.assigned_sales_id <=> OLD\.assigned_sales_id\)/);
  assert.match(sql, /NEW\.assigned_at <=> OLD\.assigned_at/);
  assert.match(sql, /NEW\.assigned_at IS NULL, NOW\(\)/);
});

test('«توزيع تلقائي» counts each rep towards their cap as it hands leads out', () => {
  const route = read('routes/lead-capture-crm.js');
  assert.match(route, /\|\| !hasRoom\(\{ intake_limit: rep\.intakeLimit \}, rep\.taken\);/);
  assert.match(route, /rep\.activeLeads \+= 1;\n\s+rep\.taken = \(rep\.taken \|\| 0\) \+ 1;/);
});

test('the roster carries each rep\'s cap and what they have taken, for the batch to keep counting', () => {
  const lib = read('lib/leadAssignment.js');
  assert.match(lib, /intakeLimit: policy\.intake_limit == null \? null : Number\(policy\.intake_limit\),\n\s+taken: intake\.get\(String\(id\)\) \|\| 0,/);
});
