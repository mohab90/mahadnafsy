'use strict';
// «اي ليد مش بيتوزع اتوماتك بيظهر في الصفحه دي».
//
// «محلي جديد» is where a lead waits for a rep: whatever «توزيع تلقائي» leaves
// behind — a rep's daily cap reached, the deliberate no-rep slot — and any lead
// whose rep was taken off it. The screen and the distributor disagreed about
// which leads those are. The tab excluded only converted and lost, so a lead
// the auto-archiver had closed as never contacted, or one marked wrong number,
// sat there as if waiting though no distribution would ever hand it out. And
// the badge, the counter and the two tables drawn on the tab each counted their
// own version of the pool: 4, 3 and 2 for the same five leads.
//
// These run the real predicate — Node strips the types itself — against the
// distributor's own list of terminal statuses.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TERMINAL_LEAD_STATUSES: SERVER_TERMINAL } = require('../lib/leadStatuses');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let groups;
test.before(async () => {
  const { stripTypeScriptTypes } = require('node:module');
  assert.equal(typeof stripTypeScriptTypes, 'function', 'the gate needs Node 22.13 or newer');
  const js = stripTypeScriptTypes(read('admin/pages/dashboard/tabs/leads/leadSourceGroups.ts'));
  groups = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
});

test('the screen closes the same statuses the distributor does', () => {
  assert.deepEqual([...groups.TERMINAL_LEAD_STATUSES].sort(), [...SERVER_TERMINAL].sort(),
    'api/lib/leadStatuses.js and leadSourceGroups.ts must list the same terminal statuses');
});

test('محلي جديد holds exactly the local leads waiting for a rep', () => {
  const lead = extra => ({ hidden: false, assignedSalesId: null, source: 'Facebook', status: 'new', branch: 'ONLINE_EGYPT', ...extra });
  const cases = [
    ['waiting, local', lead({}), true, false],
    ['a rep name but no rep', lead({ assignedSalesName: 'rodina' }), true, false],
    ['waiting, abroad', lead({ branch: 'ONLINE_SAUDI' }), false, true],
    ['has a rep', lead({ assignedSalesId: 'st-1' }), false, false],
    ['an imported archive', lead({ source: 'محلي قديم' }), false, false],
    ['closed by the auto-archiver', lead({ status: 'archived' }), false, false],
    ['wrong number', lead({ status: 'wrong_number' }), false, false],
    ['interested, still open', lead({ status: 'interested_booking' }), true, false],
    ['hidden', lead({ hidden: true }), false, false],
  ];
  for (const [label, row, local, abroad] of cases) {
    assert.equal(groups.isLocalNewLead(row), local, `محلي جديد: ${label}`);
    assert.equal(groups.isDawliNewLead(row), abroad, `دولي جديد: ${label}`);
  }
});

test('the badge, the counter and the one list all read that predicate', () => {
  const tab = read('admin/pages/dashboard/tabs/LeadsTab.tsx');
  assert.match(tab, /const unassignedLeads = useMemo\(\(\) => leads\.filter\(isLocalNewLead\), \[leads\]\);/);
  assert.match(tab, /unassignedCount=\{unassignedLeads\.length\}/);
  assert.doesNotMatch(tab, /rows=\{unassignedLeads\}/, 'the tab draws the pool once, in LeadArchiveViews');
  const views = read('admin/pages/dashboard/tabs/leads/LeadArchiveViews.tsx');
  assert.match(views, /customFilter=\{isLocalNewLead\}/);
  assert.match(views, /customFilter=\{isDawliNewLead\}/);
});
