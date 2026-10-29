'use strict';

// «جمعلي كل السعودي والدولي في التاب بتاعهم سواء قديم او جديد والغي تاب سعودي قديم» (29 Oct 2026). A Saudi or an
// international client is listed in the tab of their market whatever their status; the other tabs do not list them;
// the old-clients tab is one (محلي قديم) and takes the old statuses of the local clients.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const view = require('../lib/staffClientsView');

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const ctx = { today: TODAY, weekStart: TODAY, monthStart: `${TODAY.slice(0, 7)}-01`, catalogue: { courses: new Map(), bundles: new Map() }, allBranches: false };
const client = (id, extra = {}) => ({ id, name: `n${id}`, branch: 'ONLINE_EGYPT', isActive: true, paymentHistory: [], enrolledCourseIds: [], ...extra });
const ids = (clients, query) => view.buildView(clients, view.readFilters(query), ctx).ids;

const clients = [
  client('local-active', { enrolledCourseIds: ['c1'] }),
  client('local-finished', { clientStatus: 'finished' }),
  client('local-old', { clientStatus: 'old_local' }),
  client('local-old-intl-status', { clientStatus: 'old_intl' }),
  client('sa-active', { branch: 'ONLINE_SAUDI', market: 'saudi', enrolledCourseIds: ['c1'] }),
  client('sa-no-course', { branch: 'ONLINE_SAUDI', market: 'saudi' }),
  client('sa-finished', { branch: 'ONLINE_SAUDI', market: 'saudi', clientStatus: 'finished' }),
  client('sa-paused', { branch: 'ONLINE_SAUDI', market: 'saudi', clientStatus: 'paused' }),
  client('sa-old', { branch: 'ONLINE_SAUDI', market: 'saudi', clientStatus: 'old_intl' }),
  client('sa-refunded', { branch: 'ONLINE_SAUDI', market: 'saudi', clientStatus: 'refunded' }),
  client('sa-disabled', { branch: 'ONLINE_SAUDI', market: 'saudi', isActive: false }),
  client('intl-old', { branch: 'ONLINE_ABROAD', market: 'intl', clientStatus: 'old_intl' }),
  client('intl-finished', { branch: 'ONLINE_ABROAD', market: 'intl', clientStatus: 'finished' }),
];

test('a Saudi or international client is in the tab of their market, old or new, finished or not', () => {
  assert.deepEqual(ids(clients, { view: 'real-saudi' }).sort(), ['sa-active', 'sa-finished', 'sa-no-course', 'sa-old', 'sa-paused']);
  assert.deepEqual(ids(clients, { view: 'real-intl' }).sort(), ['intl-finished', 'intl-old']);
  const { tabCounts } = view.buildView(clients, view.readFilters({}), ctx);
  assert.equal(tabCounts['real-saudi'], 5);
  assert.equal(tabCounts['real-intl'], 2);
});

test('the other tabs do not list them, and there is no old-international tab', () => {
  assert.deepEqual(ids(clients, { view: 'finished' }), ['local-finished']);
  assert.deepEqual(ids(clients, { view: 'paused' }), []);
  assert.deepEqual(ids(clients, { view: 'old_local' }).sort(), ['local-old', 'local-old-intl-status']);
  const { tabCounts } = view.buildView(clients, view.readFilters({}), ctx);
  assert.equal(tabCounts.finished, 1);
  assert.equal(tabCounts.paused, 0);
  assert.equal(tabCounts.old_local, 2);
  assert.equal('old_intl' in tabCounts, false);
  // an old link to the removed tab reads as «النشطين» rather than an empty list
  assert.equal(view.readFilters({ view: 'old_intl' }).view, 'active');
});

test('the screen\'s tab bar has no Saudi-old tab and counts the market tabs the same way', () => {
  const root = path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs');
  const bar = fs.readFileSync(path.join(root, 'online-clients-sections', 'ViewTabsBar.tsx'), 'utf8');
  assert.doesNotMatch(bar, /key: 'old_intl'/);
  assert.doesNotMatch(bar, /سعودي قديم/);
  assert.match(bar, /محلي قديم/);
});
