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
  // The statuses come from shared/leadStatuses.ts; loaded the same way and
  // linked in by its own address, since a data: module has no folder to be
  // relative to.
  const url = js => `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
  const shared = url(stripTypeScriptTypes(read('shared/leadStatuses.ts')));
  const js = stripTypeScriptTypes(read('admin/pages/dashboard/tabs/leads/leadSourceGroups.ts'))
    .replace(/from '(?:\.\.\/)+shared\/leadStatuses'/, `from '${shared}'`);
  groups = await import(url(js));
});

test('the screen closes the same statuses the distributor does', () => {
  assert.deepEqual([...groups.TERMINAL_LEAD_STATUSES].sort(), [...SERVER_TERMINAL].sort(),
    'api/lib/leadStatuses.js and leadSourceGroups.ts must list the same terminal statuses');
});

// «مينفعش عميل مش ظاهر ادامي خلي اي عميل مورشف او مش ظاهر يكون موجود في محلي
// جديد» (6 Oct 2026, when 1,747 leads were on no tab at all): the pool holds
// every lead nobody is working, each with its reason, and only the waiting ones
// are what a distribution hands out.
test('محلي جديد holds every local lead nobody is working, by reason', () => {
  const lead = extra => ({ hidden: false, assignedSalesId: null, source: 'Facebook', status: 'new', branch: 'ONLINE_EGYPT', phone: '01012345678', ...extra });
  const cases = [
    ['waiting, local', lead({}), 'waiting', true, false],
    ['a rep name but no rep', lead({ assignedSalesName: 'rodina' }), 'waiting', true, false],
    ['waiting, abroad', lead({ branch: 'ONLINE_SAUDI' }), 'waiting', false, true],
    ['has a rep', lead({ assignedSalesId: 'st-1' }), null, false, false],
    ['an imported archive', lead({ source: 'محلي قديم' }), null, false, false],
    ['archived by the cold-lead job', lead({ status: 'archived' }), 'archived', true, false],
    ['archived, a rep still on it', lead({ status: 'archived', assignedSalesId: 'st-1' }), 'archived', true, false],
    ['wrong number, nobody on it', lead({ status: 'wrong_number' }), 'closed', true, false],
    ['interested, still open', lead({ status: 'interested_booking' }), 'waiting', true, false],
    ['hidden by a rep', lead({ hidden: true, assignedSalesId: 'st-1' }), 'hidden', true, false],
    ['hidden, abroad', lead({ hidden: true, branch: 'ONLINE_SAUDI' }), 'hidden', false, true],
    ['hidden junk, no number or address', lead({ hidden: true, phone: '', email: '' }), null, false, false],
    ['a client now', lead({ status: 'converted' }), null, false, false],
  ];
  for (const [label, row, reason, local, abroad] of cases) {
    assert.equal(groups.poolReasonOf(row), reason, `السبب: ${label}`);
    assert.equal(groups.isLocalNewLead(row), local, `محلي جديد: ${label}`);
    assert.equal(groups.isDawliNewLead(row), abroad, `دولي جديد: ${label}`);
    assert.equal(groups.isUndistributedLead(row), reason === 'waiting', `مستني توزيع: ${label}`);
  }
});

test('the server reads the reasons in the same order the screen does', () => {
  const server = read('api/lib/leadPoolFilter.js');
  const steps = ['merged_into_lead_id IS NOT NULL', 'WHEN l.hidden = 1', '${ARCHIVE.sql} THEN NULL',
    "THEN 'archived'", "<> '' THEN NULL", "THEN 'closed'", "ELSE 'waiting'"];
  const at = steps.map(step => server.indexOf(step));
  assert.ok(at.every(index => index >= 0), 'every step is there');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'and in this order');
});

test('the badge, the counter and the one list all read that predicate', () => {
  const tab = read('admin/pages/dashboard/tabs/LeadsTab.tsx');
  assert.match(tab, /const unassignedLeads = useMemo\(\(\) => leads\.filter\(lead => isLocalNewLead\(lead\) && poolReasonOf\(lead\) === 'waiting'\), \[leads\]\);/);
  // The badge and the counter are the server's count of that same pool
  // (api/lib/leadPoolFilter.js, checked against this predicate by
  // leadPoolParity.integration.test.js); what is loaded is only the fallback.
  assert.match(tab, /const unassignedCount = poolView === 'localNew' && leadPool\.breakdown \? leadPool\.breakdown\.waiting : \(serverLocalNewCount \?\? unassignedLeads\.length\);/);
  // The badge on every other tab is the waiting count too.
  assert.match(read('admin/pages/dashboard/tabs/leads/useLeadPool.ts'), /view=localNew&reason=waiting&countOnly=1/);
  assert.match(tab, /unassignedCount=\{unassignedCount\}/);
  assert.doesNotMatch(tab, /rows=\{unassignedLeads\}/, 'the tab draws the pool once, in LeadArchiveViews');
  const views = read('admin/pages/dashboard/tabs/leads/LeadArchiveViews.tsx');
  assert.match(views, /customFilter=\{isLocalNewLead\}/);
  // The international pool is now half of «داتا سعودي», which lists it beside
  // the imported international data — still through the same predicate.
  assert.match(views, /customFilter=\{lead => isDawliNewLead\(lead\)/);
});
