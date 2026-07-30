'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  buildCrmForecast, buildPipelineMovements, forecastCategory, forecastProbability, loadCrmForecast,
} = require('../lib/crmForecast');

test('CRM forecast categories and probabilities are explicit or explainably derived', () => {
  assert.deepEqual(forecastCategory({ forecast_category: 'commit', status: 'new' }), {
    value: 'commit', derived: false,
  });
  assert.deepEqual(forecastCategory({ status: 'interested' }), {
    value: 'best_case', derived: true,
  });
  assert.equal(forecastProbability({ forecast_probability: 72 }, 'pipeline'), 72);
  assert.equal(forecastProbability({}, 'commit'), 90);
});

test('CRM forecast excludes missing close dates, rolls categories up and reports data quality', () => {
  const result = buildCrmForecast({
    now: new Date('2026-07-15T00:00:00.000Z'),
    months: 2,
    history: [{ period: '2026-06', actual_egp: 800 }],
    targets: [{ period: '2026-07', revenue_target: 1000 }],
    leads: [
      {
        id: 'l1', name: 'A', status: 'interested', deal_value: 1000,
        forecast_category: 'commit', forecast_probability: 80,
        expected_close_date: '2026-07-20', assigned_sales_id: 's1', assigned_sales_name: 'Seller',
      },
      {
        id: 'l2', name: 'B', status: 'new', deal_value: 500,
        expected_close_date: '2026-07-25', assigned_sales_id: 's1',
      },
      { id: 'l3', name: 'C', status: 'new', deal_value: 700 },
    ],
  });
  assert.deepEqual(result.history, [{ period: '2026-06', actualEgp: 800 }]);
  assert.equal(result.periods[0].pipelineEgp, 1500);
  assert.equal(result.periods[0].bestCaseEgp, 1000);
  assert.equal(result.periods[0].commitEgp, 1000);
  assert.equal(result.periods[0].weightedEgp, 925);
  assert.equal(result.periods[0].coverage, 1.5);
  assert.equal(result.ownerRollups[0].opportunityCount, 2);
  assert.equal(result.dataQuality.missingExpectedClose, 1);
  assert.equal(result.opportunities.length, 3);
});

test('CRM forecast compares append-only submissions with actual paid revenue', () => {
  const result = buildCrmForecast({
    now: new Date('2026-07-15T00:00:00.000Z'),
    history: [{ period: '2026-06', actual_egp: 800 }],
    submissions: [
      { id: 's1', period: '2026-06', staff_id: 'a', pipeline_egp: 1200, best_case_egp: 1000, commit_egp: 700 },
      { id: 's2', period: '2026-06', staff_id: 'b', pipeline_egp: 300, best_case_egp: 200, commit_egp: 100 },
    ],
  });
  assert.equal(result.forecastAccuracy[0].commitEgp, 800);
  assert.equal(result.forecastAccuracy[0].actualEgp, 800);
  assert.equal(result.forecastAccuracy[0].accuracyPercent, 100);
  assert.equal(result.forecastAccuracy[0].submissionCount, 2);
});

test('CRM forecast accuracy can be attributed per sales representative', () => {
  const result = buildCrmForecast({
    history: [{ period: '2026-06', actual_egp: 900 }],
    accuracyActuals: [
      { period: '2026-06', staff_id: 'a', actual_egp: 600 },
      { period: '2026-06', staff_id: 'b', actual_egp: 300 },
    ],
    submissions: [
      { period: '2026-06', staff_id: 'a', staff_name: 'A', commit_egp: 500 },
      { period: '2026-06', staff_id: 'b', staff_name: 'B', commit_egp: 300 },
    ],
  });
  assert.equal(result.forecastAccuracy.length, 2);
  assert.equal(result.forecastAccuracy.find(row => row.staffId === 'b').accuracyPercent, 100);
  assert.equal(result.forecastAccuracy.find(row => row.staffId === 'a').absoluteErrorEgp, 100);
});

test('pipeline inspection explains status and opportunity value movements', () => {
  const result = buildPipelineMovements([
    {
      id: 'e1', lead_id: 'l1', lead_name: 'Lead', event_type: 'status_changed',
      meta_json: JSON.stringify({ from: 'new', to: 'interested' }), at: '2026-07-30',
    },
    {
      id: 'e2', lead_id: 'l1', lead_name: 'Lead', event_type: 'forecast_updated',
      meta_json: JSON.stringify({ before: { category: 'pipeline', dealValueEgp: 100 }, after: { category: 'commit', dealValueEgp: 150 } }),
      at: '2026-07-30',
    },
  ]);
  assert.equal(result.movements.length, 2);
  assert.equal(result.summary.find(row => row.eventType === 'forecast_updated').valueDeltaEgp, 50);
  assert.equal(result.summary.find(row => row.eventType === 'status_changed').from, 'new');
});

test('CRM forecast loader scopes history, pipeline, targets, submissions and sources', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[], []];
    },
  };
  await loadCrmForecast({
    tenantId: 'tenant-a',
    staffId: 'staff-a',
    scope: { sql: ' AND l.assigned_sales_id=?', params: ['staff-a'] },
    db,
  });
  assert.equal(calls.length, 6);
  for (const call of calls) assert.equal(call.params[0], 'tenant-a');
  assert.match(calls[0].sql, /l\.assigned_sales_id=\?/);
  assert.match(calls[1].sql, /l\.assigned_sales_id=\?/);
  assert.match(calls[2].sql, /staff_id=\?/);
  assert.match(calls[3].sql, /ROW_NUMBER\(\) OVER/);
  assert.match(calls[4].sql, /l\.assigned_sales_id=\?/);
  assert.match(calls[5].sql, /GROUP BY DATE_FORMAT\(p\.date/);
});

test('forecast mutations are permissioned, scoped, transactional and append-only', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'crm-forecast.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '160_v25_crm_forecasting.sql'), 'utf8');
  assert.match(route, /requirePermission\('manage_leads'\)/);
  assert.match(route, /leadScope\(req, 'l'\)/);
  assert.match(route, /beginTransaction\(\)/);
  assert.match(route, /logLeadEventStrict/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS crm_forecast_submissions/);
  assert.match(migration, /commit_egp <= best_case_egp AND best_case_egp <= pipeline_egp/);
  assert.doesNotMatch(route, /UPDATE crm_forecast_submissions/);
});
