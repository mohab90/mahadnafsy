'use strict';
// The CRM leads table counts and pages the array it is handed, so the screen it
// lives on has to hold the whole table.
//
// It did not. The leads screen loads a 500-row bootstrap page on first paint and
// only pulls the rest for sub-tabs listed in fullLeadArraySubTabs — and 'table',
// the landing view, was not one of them. LeadTable then sliced those 500 rows
// 100 at a time and printed its own array length as the total:
//
//   500 عميل — عرض 1–100
//
// against 30,964 real leads. One rep alone held 2,613. The desk could not see,
// search or distribute the other 30,464, and nothing said so — the number looked
// like an answer.
//
// The comment in dashboardTabGroups.ts had said the landing table was "paginated
// and searched on the server", which is what made it look safe to leave out.
// That was never true of the code, so this checks the code.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const stripComments = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => (/^\s*(\/\/|\*)/.test(line) ? '' : line.split('//')[0]))
  .join('\n');

test('the leads screen reads no lead or client list: the pools are the server\'s pool', () => {
  // Every sub-tab answers from the server now — the table and the board a page at a time, the pools from
  // GET /admin/leads/pool, the reminders, the counts and the performance figures as aggregates — so the set of sub-tabs
  // that downloaded every lead is gone, and the screen asks the context for no list.
  const groups = stripComments(read('admin/pages/dashboard/dashboardTabGroups.ts'));
  assert.doesNotMatch(groups, /fullLeadArraySubTabs/);
  const tab = stripComments(read('admin/pages/dashboard/tabs/LeadsTab.tsx'));
  assert.match(tab, /leads=\{leadPool\.rows\}/, 'the pool views are fed the server pool');
  const context = tab.match(/const \{([^}]*)\} = useSiteData\(\);/)[1];
  for (const list of ['leads', 'subscribers', 'loadFullCrmData', 'loadFullLeads']) {
    assert.ok(!context.split(',').map(part => part.trim()).includes(list), `LeadsTab reads ${list} from the context again`);
  }
});

test('the insights are asked for where they are drawn, not on every sub-tab', () => {
  const tab = stripComments(read('admin/pages/dashboard/tabs/LeadsTab.tsx'));
  assert.match(tab, /useCrmInsights\(smartIdleDays, performanceOnly \|\| subTab === 'reminders', insightsKey\)/);
  assert.match(tab, /useRepRevenue\(targetMonth, performanceOnly\)/);
});

test('the table shows the server page and the server total', () => {
  // The rows are the server's page and the count is the server's total. If the table went back to
  // slicing the array, it would count the 500-row bootstrap page as the table.
  const tab = stripComments(read('admin/pages/dashboard/tabs/LeadsTab.tsx'));
  assert.match(tab, /<LeadTable\s+rows=\{serverTable\.rows\}\s+paging=\{\{[^}]*total: serverTable\.total/,
    'the landing table must be fed the server page and its total');
  const table = read('admin/pages/dashboard/tabs/LeadTable.tsx');
  assert.match(table, /const totalRows = paging \? paging\.total : rows\.length/,
    'with paging the visible total is the server count');
  assert.match(table, /const pageRows = paging \? rows :/, 'and a server page is not sliced again');
});
