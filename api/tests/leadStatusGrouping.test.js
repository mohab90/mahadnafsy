'use strict';
// The desk records lead outcomes more finely than the code read them.
//
// leads.status is a varchar, not an enum, and production holds
// interested_followup, interested_booking, no_answer_wa and no_answer_nowa
// alongside the plain interested and no_answer. Several places tested for the
// short form alone and the finer ones fell through — silently, because there is
// no constraint to fail against.
//
// The counts are small today (14 leads of 29,665) and that is the point: the
// team is only now starting to use the system properly, so this is the moment
// the numbers are still cheap to correct.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const {
  LEAD_STATUSES, TERMINAL_LEAD_STATUSES,
  isOpenLeadStatus, isInterestedLeadStatus,
} = require('../lib/leadStatuses');

test('every status the desk actually uses is a known one', () => {
  // Read off production: these are the values in the table today.
  for (const status of [
    'new', 'archived', 'converted', 'interested_followup', 'interested_booking',
    'not_interested', 'contacted', 'no_answer_wa', 'no_answer_nowa', 'no_answer',
  ]) {
    assert.ok(LEAD_STATUSES.has(status), `${status} is stored but not declared`);
  }
});

test('a lead still worth working is open; a finished one is not', () => {
  for (const status of ['new', 'contacted', 'interested', 'interested_booking',
    'interested_followup', 'no_answer', 'no_answer_wa', 'postpone_month']) {
    assert.equal(isOpenLeadStatus(status), true, `${status} should still be workable`);
  }
  for (const status of ['converted', 'lost', 'won', 'closed', 'not_interested',
    'wrong_number', 'archived', 'disqualified']) {
    assert.equal(isOpenLeadStatus(status), false, `${status} should be finished`);
  }
});

test('the distribution pool is the open set, not two hand-picked names', () => {
  // It used to be ['new','interested'] and their upper-case twins, while its own
  // comment said it excluded the closed ones. A lead marked interested_booking —
  // the closest to buying in the table — was never redistributed.
  const source = codeOnly(read('routes/admin/leads.js'));
  assert.match(source, /\[\.\.\.LEAD_STATUSES\]\.filter\(isOpenLeadStatus\)/);
  assert.doesNotMatch(source, /\['new', 'interested', 'NEW', 'INTERESTED'\]/);

  const pool = [...LEAD_STATUSES].filter(isOpenLeadStatus);
  for (const status of ['interested_booking', 'interested_followup', 'contacted', 'no_answer_wa']) {
    assert.ok(pool.includes(status), `${status} must be distributable`);
  }
  for (const status of TERMINAL_LEAD_STATUSES) {
    assert.ok(!pool.includes(status), `${status} must not be`);
  }
});

test('scoring credits every shade of interested', () => {
  // Testing for 'interested' alone gave interested_booking nothing on this
  // component, so a lead about to book scored lower than one merely called
  // interested.
  assert.equal(isInterestedLeadStatus('interested'), true);
  assert.equal(isInterestedLeadStatus('interested_booking'), true);
  assert.equal(isInterestedLeadStatus('interested_followup'), true);
  assert.equal(isInterestedLeadStatus('contacted'), false);
  assert.equal(isInterestedLeadStatus('converted'), false);

  const scoring = codeOnly(read('routes/analytics/leads-scoring.js'));
  assert.match(scoring, /if \(isInterestedLeadStatus\(status\)\) score \+= Number\(W\.status_interested\)/);
});

test('the forecast keeps booking ahead of the rest, and stops dropping followup', () => {
  // interested_booking commits; the other shades sit in best_case.
  // interested_followup used to miss both branches and land in pipeline,
  // forecasting a warm lead as coldly as an untouched one.
  const forecast = codeOnly(read('lib/crmForecast.js'));
  const commitAt = forecast.indexOf("'interested_booking', 'qualified', 'negotiation'");
  const bestCaseAt = forecast.indexOf('isInterestedLeadStatus(status)) return');
  assert.ok(commitAt > 0 && bestCaseAt > 0, 'both branches must exist');
  assert.ok(commitAt < bestCaseAt, 'booking must be tested before the general interested case');
});

test('grouping lives in one module, so a new status is classified once', () => {
  const module_ = codeOnly(read('lib/leadStatuses.js'));
  assert.match(module_, /TERMINAL_LEAD_STATUSES/);
  assert.match(module_, /INTERESTED_LEAD_STATUSES/);
  // Every terminal status must also be a declared one, or the pool silently
  // keeps a status nobody meant to be workable.
  for (const status of TERMINAL_LEAD_STATUSES) {
    assert.ok(LEAD_STATUSES.has(status), `${status} is terminal but not declared`);
  }
});
