'use strict';
const { leadsRouteSource, sourceOf } = require('./_authRouteSource');
// «في توزيع الداتا علي السيلز لازم كمان اقدر احدد كورس معين او كل الكورسات او
// اكتر من كورس ينزل للسيلز كمان اقدر احدد المصدر اللى ينزل للسيلز».
//
// Each rep on «التوزيع» can be limited to some courses (a track counts, as
// 'bundle:<id>') and to some sources. Nothing chosen means all, as before. A
// lead nobody's rules take stays unassigned, in «محلي جديد».
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { repTakesLead, parseRuleList, leadRoutingFacts } = require('../lib/leadAssignmentPolicy');
const { createRepRotation, createBatchAssigner } = require('../lib/leadAssignment');

const API = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(API, rel), 'utf8');

const everything = { courseIds: null, sources: null };
const therapistOnly = { courseIds: ['bundle:b-1'], sources: null };
const facebookOnly = { courseIds: [], sources: ['فيسبوك ليدز'] };

test('a rep with nothing chosen takes every lead, as before', () => {
  assert.equal(repTakesLead(everything, { source: 'الصحة النفسية', courseIds: ['c-1'] }), true);
  assert.equal(repTakesLead(everything, { source: '', courseIds: [] }), true);
  // Empty lists are "all" too — clearing every box never means "nothing".
  assert.equal(repTakesLead({ courseIds: [], sources: [] }, { source: 'x', courseIds: [] }), true);
  assert.equal(parseRuleList('[]'), null);
  assert.equal(parseRuleList(null), null);
});

test('no lead in hand takes everyone, so a caller that says nothing is unchanged', () => {
  assert.equal(repTakesLead(therapistOnly, null), true);
});

test('a course rule takes a lead that asked for any of its courses, a track included', () => {
  assert.equal(repTakesLead(therapistOnly, { source: 's', courseIds: ['bundle:b-1'] }), true);
  // An older save left some tracks as the bare bundle id.
  assert.equal(repTakesLead(therapistOnly, { source: 's', courseIds: ['b-1'] }), true);
  assert.equal(repTakesLead(therapistOnly, { source: 's', courseIds: ['c-9', 'bundle:b-1'] }), true);
  assert.equal(repTakesLead(therapistOnly, { source: 's', courseIds: ['c-9'] }), false);
  // A lead that named no course goes only to reps who take all courses.
  assert.equal(repTakesLead(therapistOnly, { source: 's', courseIds: [] }), false);
});

test('a source rule takes only its sources, whatever the spacing or case', () => {
  assert.equal(repTakesLead(facebookOnly, { source: ' فيسبوك ليدز ', courseIds: [] }), true);
  assert.equal(repTakesLead(facebookOnly, { source: 'الصحة النفسية', courseIds: [] }), false);
  assert.equal(repTakesLead({ sources: ['Google Sheet'] }, { source: 'google sheet', courseIds: [] }), true);
});

test('a leads row is read for its source and interests, the column first', () => {
  assert.deepEqual(
    leadRoutingFacts({ source: 'فيسبوك ليدز', interested_course_ids_json: '["c-1","b-2"]', crm_json: '{}' }),
    { source: 'فيسبوك ليدز', courseIds: ['c-1', 'bundle:b-2'] });
  assert.deepEqual(
    leadRoutingFacts({ source: 'x', interested_course_ids_json: null, crm_json: '{"interestedCourseIds":["c-3"]}' }),
    { source: 'x', courseIds: ['c-3'] });
});

test('the rotation hands each lead only to reps who take it, and null when nobody does', () => {
  const reps = [
    { id: 'a', name: 'A', weight: 1, activeLeads: 0, taken: 0, maxOpenLeads: null, intakeLimit: null, courseIds: ['c-1'], sources: null },
    { id: 'b', name: 'B', weight: 1, activeLeads: 0, taken: 0, maxOpenLeads: null, intakeLimit: null, courseIds: ['c-2'], sources: null },
  ];
  const rotation = createRepRotation(reps);
  assert.equal(rotation.next({ source: 's', courseIds: ['c-2'] }).id, 'b');
  assert.equal(rotation.next({ source: 's', courseIds: ['c-1'] }).id, 'a');
  assert.equal(rotation.next({ source: 's', courseIds: ['c-3'] }), null);
  // Without a lead it rotates over everyone, exactly as it did.
  assert.ok(['a', 'b'].includes(rotation.next().id));
});

test('the sheet sync\'s assigner reads each rep\'s rules from the table', async () => {
  const db = {
    async query(sql) {
      if (/FROM staff s/.test(sql)) {
        return [[
          { id: 'a', name: 'A', policy_id: 'p-a', branch_key: '*', weight: 1, max_open_leads: null, is_available: 1,
            last_assigned_at: null, intake_limit: null, intake_period: 'day', course_ids_json: null, sources_json: '["فيسبوك ليدز"]' },
          { id: 'b', name: 'B', policy_id: 'p-b', branch_key: '*', weight: 1, max_open_leads: null, is_available: 1,
            last_assigned_at: null, intake_limit: null, intake_period: 'day', course_ids_json: '["c-7"]', sources_json: null },
        ]];
      }
      return [[]];
    },
  };
  const assigner = await createBatchAssigner('t', db);
  assert.equal(assigner.next({ source: 'فيسبوك ليدز', courseIds: [] }).id, 'a');
  assert.equal(assigner.next({ source: 'الصحة النفسية', courseIds: ['c-7'] }).id, 'b');
  assert.equal(assigner.next({ source: 'الصحة النفسية', courseIds: ['c-1'] }), null);
});

test('the rules are stored, and every path that picks a rep says which lead it is placing', () => {
  const sql = read('migrations/218_v26_assignment_course_and_source_rules.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS course_ids_json TEXT NULL/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS sources_json TEXT NULL/);
  assert.match(read('lib/leadAssignmentPolicy.js'), /course_ids_json=VALUES\(course_ids_json\)/);

  assert.match(read('lib/sheets.js'), /assigner\.next\(\{ source: /);
  assert.match(read('routes/gsheets.js'), /rotation\.next\(\{ source: /);
  assert.match(leadsRouteSource(), /rotation\.next\(lead\)/);
  assert.match(read('routes/crm-advanced.js'), /rotation\.next\(target\)/);
  assert.match(read('routes/lead-capture-crm.js'), /repTakesLead\(rep, targets\[i\]\)/);
  for (const rel of ['routes/admin/leads.js', 'routes/lead-capture-crm.js', 'lib/registrationLead.js',
    'lib/facebookLeadEvents.js', 'lib/messenger.js', 'lib/whatsappInbound.js', 'routes/core/catalog.js']) {
    const calls = sourceOf(rel).match(/getNextSalesRep\)?\([^)]*\{[\s\S]*?\}\)/g) || [];
    assert.ok(calls.length > 0, `${rel} calls getNextSalesRep`);
    for (const call of calls) assert.match(call, /lead:/, `${rel}: ${call.slice(0, 80)}`);
  }
});
