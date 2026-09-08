'use strict';
/**
 * Money the institute does not hold, and fields the database does not have.
 *
 * Every fault here is one of two shapes: a screen summing payments without
 * asking whether they were collected, or a screen reading a field that no
 * column and no mapper ever produces. Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const schema = read('api/schema.sql');

test('a refunded payment is never counted as money collected', () => {
  // lib/refunds.js flips the SAME payments row to 'refunded' and leaves its
  // positive amount, so a sum with no status predicate keeps counting it.
  assert.match(read('api/lib/refunds.js'), /UPDATE payments SET status='refunded'/);

  const guarded = [
    ['admin/pages/dashboard/tabs/onlineClientsUtils.ts', 'isCollected(payment)'],
    ['admin/pages/dashboard/tabs/financial/useFinancialCommissionsData.ts', "payment.status === 'paid'"],
    ['admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx', "p.status === 'paid'"],
    ['admin/pages/dashboard/hooks/useOverviewDerived.ts', "p.status === 'paid'"],
    ['admin/pages/dashboard/tabs/ClientDbTab.tsx', "p.status === 'paid'"],
  ];
  for (const [file, needle] of guarded) {
    assert.ok(codeOnly(read(file)).includes(needle), `${file} must exclude uncollected payments`);
  }

  // The Dokki roster writes its figure onto the round attendee, so a wrong one
  // survives the click. All four of its sums are guarded.
  const daqqi = codeOnly(read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx'));
  // The window runs past reduce( on purpose: two of these guard inside the
  // filter and two inside the reduce body.
  const sums = daqqi.match(/paymentHistory \|\| \[\]\)[\s\S]{0,320}/g) || [];
  assert.ok(sums.length >= 4, `expected the roster's payment sums, found ${sums.length}`);
  for (const sum of sums) {
    assert.ok(sum.includes("p.status === 'paid'"), 'every roster sum must exclude refunds');
  }
});

test('one predicate decides what "collected" means', () => {
  const money = read('admin/lib/money.ts');
  assert.match(money, /export function isCollected/);
  // A missing status means paid: rows predating the column carry none.
  assert.match(money, /!status \|\| status === 'paid'/);
});

test('a sales figure printed in EGP was converted to EGP', () => {
  // orders.currency is enum('EGP','SAR','USD') and the leaderboard prints ج.
  assert.match(schema, /`currency` enum\('EGP','SAR','USD'\)/);
  const hub = codeOnly(read('admin/pages/dashboard/tabs/SalesHubTab.tsx'));
  assert.ok(hub.includes('toEgp(o.amount, o.currency, rates)'),
    'a 1,200 SAR order counted as 1,200 EGP on the leaderboard');
  assert.ok(!hub.includes('sum + (o.amount || 0)'), 'no raw-amount sum may remain');
});

test('the sales target a manager set is the one the screen reads', () => {
  // GET /api/admin/sales-targets returns period / revenueTarget; SalesTarget is
  // { staffId, month, targetEGP }. An `as unknown as` cast asserted the shape
  // instead of building it, so every target read undefined and the أهداف tab
  // said "لم يُحدد هدف بعد" against real targets.
  const state = codeOnly(read('admin/pages/dashboard/hooks/useLeadCrmTabState.ts'));
  assert.ok(state.includes('targetEGP: Number(row.revenueTarget)'));
  assert.ok(state.includes('month: String(row.period || period)'));
  assert.ok(!state.includes('rows as unknown as SalesTarget[]'), 'the cast asserted a shape it did not build');
});

test('the online-client filter reads a field the database actually has', () => {
  // subscribers has is_active and no status column, in the schema or any migration.
  const table = schema.slice(schema.indexOf('CREATE TABLE `subscribers`'));
  const columns = table.slice(0, table.indexOf(') ENGINE'));
  assert.ok(columns.includes('`is_active`'), 'is_active is the real column');
  assert.ok(!/^\s*`status`/m.test(columns), 'and there is no status column to filter on');

  const tab = codeOnly(read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx'));
  assert.ok(!tab.includes('s.status !== collOnlineStatusFilter'),
    'the filter emptied the table for every client created by the two live paths');
  assert.ok(tab.includes('s.clientStatus'), 'clientStatus is the lifecycle field that exists');

  // And the options offered are states the system actually stores.
  const toolbar = read('admin/pages/dashboard/tabs/online-clients-sections/FiltersToolbar.tsx');
  for (const invented of ['active_new', 'active_paid', 'active_late', 'blocked']) {
    assert.ok(!toolbar.includes(`value="${invented}"`), `${invented} was never a stored state`);
  }
});

test('an interest level means the same thing in both spellings', () => {
  // leads.interest_level is enum('LOW','MEDIUM','HIGH') and reaches the browser
  // as declared; the crm_json copy is lowercase. Facebook Lead Ads writes HIGH.
  assert.match(schema, /`interest_level` enum\('LOW','MEDIUM','HIGH'\)/);
  assert.match(read('api/lib/facebookLeadEvents.js'), /'HIGH'/);

  const utils = codeOnly(read('admin/pages/dashboard/tabs/leadUtils.ts'));
  assert.ok(utils.includes('.trim().toLowerCase()'), 'both spellings must resolve to one');
  assert.ok(utils.includes('IL_LABEL[normalizeInterestLevel(value)]'),
    'the label must be looked up on the normalised value');
  assert.ok(utils.includes('const interest = normalizeInterestLevel(lead.interestLevel)'),
    'and the score must read the normalised value too');
  assert.ok(!utils.includes("lead.interestLevel === 'high'"),
    "a raw comparison against 'high' never matched the enum's HIGH");

  // The card looked the label up directly and rendered undefined for HIGH.
  const card = codeOnly(read('admin/pages/dashboard/tabs/leads/LeadCard.tsx'));
  assert.ok(card.includes('interestLevelLabel(lead.interestLevel)'));
  assert.ok(!card.includes('IL_LABEL[lead.interestLevel]'));

  // The semantics the helper is asserted to have.
  const normalize = value => String(value || '').trim().toLowerCase();
  assert.equal(normalize('HIGH'), 'high');
  assert.equal(normalize('high'), 'high');
  assert.equal(normalize(null), '');
});
