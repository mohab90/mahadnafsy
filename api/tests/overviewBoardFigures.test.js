'use strict';
/** «نظرة عامة»'s board arithmetic (admin/pages/dashboard/tabs/overview/boardFigures.ts, bundled with esbuild and run): the change in percent and the alerts it raises. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderAdmin } = require('./_renderAdmin');

const lib = renderAdmin('admin/pages/dashboard/tabs/overview/boardFigures.ts');
const skip = !lib && 'admin dependencies are not installed';
const board = (alerts = {}) => ({
  asOf: '', today: '2026-11-07', periods: {}, live: null, anomalies: [],
  alerts: {
    overdueInstallments: { count: 0, clients: 0 }, leadsWithoutFollowUp: { count: 0 },
    collection: { collected: 0, target: 1, expectedByToday: 0, belowTarget: false, pctOfPace: 100 }, slowEndpoints: null, ...alerts,
  },
});

test('the change is a whole percent of what there was, and nothing when there was nothing', { skip }, () => {
  const { changePct } = lib.module;
  assert.equal(changePct(150, 100), 50);
  assert.equal(changePct(50, 100), -50);
  assert.equal(changePct(1, 3), -67);
  assert.equal(changePct(5, 0), null);
});

test('a quiet day raises no alert; each trouble raises one, with the screen to act on', { skip }, () => {
  const { alertsOf } = lib.module;
  assert.deepEqual(alertsOf(board()), []);
  const loud = alertsOf(board({
    overdueInstallments: { count: 12, clients: 7 }, leadsWithoutFollowUp: { count: 40 },
    collection: { collected: 10, target: 1000, expectedByToday: 100, belowTarget: true, pctOfPace: 10 },
    slowEndpoints: [{ route: 'GET /api/x', p95: 2500, count: 9 }],
  }));
  assert.deepEqual(loud.map(a => a.key), ['installments', 'followup', 'collection', 'slow:GET /api/x']);
  assert.deepEqual(loud.map(a => a.to), ['/dashboard/online_clients', '/dashboard/leads', '/dashboard/financial', '/dashboard/security_center']);
  assert.match(loud[0].text, /12 قسط متأخر عند 7 عميل/);
});
