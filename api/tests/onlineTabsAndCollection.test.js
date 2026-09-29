'use strict';
// The online section, 27 September:
//   «فعلي محلي» ← «محلي»، «فعلي دولي» ← «سعودي»، وتاب جديد «دولي» — جنيه، ريال، دولار;
//   a transfer button reaching all of them; new tabs beside the existing ones;
//   tabs, add and settings on one line, filters on one line with quick dates;
//   export inside the settings; collection distribution like sales, and each
//   collection officer's sheet landing under their name.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCollectionPicker, sanitizeCollectionConfig, subscriberMarket } = require('../lib/collectionDistribution');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let utils;
test.before(async () => {
  const { stripTypeScriptTypes } = require('node:module');
  // The screen's own reading of a client's market, run as written.
  const source = read('admin/pages/dashboard/tabs/onlineClientsUtils.ts')
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export \{ paymentAmountInEGP \};\n/m, '');
  const prelude = `const normBranchId = v => String(v || '').toUpperCase().replace(/[-\\s]/g, '_');
const isCollected = p => !p?.status || p.status === 'paid';
const paymentAmountInEGP = p => Number(p.amount) || 0;
const cairoDay = v => String(v || '').slice(0, 10);\n`;
  const js = stripTypeScriptTypes(prelude + source);
  utils = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
});

test('a client is in the market of what they pay in, unless the desk moved them', () => {
  const paid = (currency, at) => ({ amount: 100, currency, at, status: 'paid' });
  assert.equal(utils.subscriberMarket({ paymentHistory: [paid('EGP', '2026-09-01')] }), 'local');
  assert.equal(utils.subscriberMarket({ paymentHistory: [paid('SAR', '2026-09-01')] }), 'saudi');
  assert.equal(utils.subscriberMarket({ paymentHistory: [paid('USD', '2026-09-01')] }), 'intl');
  // The latest collected payment decides; a refunded one does not.
  assert.equal(utils.subscriberMarket({ paymentHistory: [paid('EGP', '2026-08-01'), paid('SAR', '2026-09-01')] }), 'saudi');
  assert.equal(utils.subscriberMarket({ paymentHistory: [paid('EGP', '2026-08-01'), { ...paid('USD', '2026-09-01'), status: 'refunded' }] }), 'local');
  assert.equal(utils.subscriberMarket({ branch: 'ONLINE_SAUDI', paymentHistory: [] }), 'saudi');
  assert.equal(utils.subscriberMarket({ market: 'intl', paymentHistory: [paid('EGP', '2026-09-01')] }), 'intl');
  assert.equal(utils.isOnlineClient({ branch: 'DAQQI' }), false);
  // The server reads it the same way for distribution.
  assert.equal(subscriberMarket({ latestCurrency: 'SAR' }), 'saudi');
  assert.equal(subscriberMarket({ market: 'local', latestCurrency: 'USD' }), 'local');
});

test('the tabs: محلي، سعودي، دولي, custom tabs in the same row, one line, export in the settings', () => {
  const bar = read('admin/pages/dashboard/tabs/online-clients-sections/ViewTabsBar.tsx');
  for (const label of ["'🇪🇬 محلي'", "'🇸🇦 سعودي'", "'🌍 دولي'"]) assert.ok(bar.includes(label), label);
  assert.doesNotMatch(bar, /فعلي محلي|فعلي دولي/);
  assert.match(bar, /<span ref=\{customTabsSlot\} className="contents" \/>/);
  // «صغر حجم التابات بحيث ميكونش في سكرول»: small, and wrapping rather than scrolling.
  assert.match(bar, /<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">/);
  assert.doesNotMatch(bar, /overflow-x-auto/);
  assert.match(bar, /<button onClick=\{exportCsv\} className=\{menuItem\}>/);
  const filters = read('admin/pages/dashboard/tabs/online-clients-sections/FiltersToolbar.tsx');
  assert.doesNotMatch(filters, /downloadCsv/);
  assert.match(filters, /flex-nowrap/);
  for (const label of ['النهارده', 'أمس', 'آخر 7 أيام', 'آخر 15 يوم', 'آخر 30 يوم', 'من — إلى']) assert.ok(filters.includes(label), label);
  const custom = read('admin/pages/dashboard/tabs/SectionCustomTabs.tsx');
  assert.match(custom, /\{stripSlot && createPortal\(buttons, stripSlot\)\}/);
});

test('the transfer button reaches every tab but the one the client is in', () => {
  const modal = read('admin/pages/dashboard/tabs/OnlineClientConvertModal.tsx');
  assert.match(modal, /MARKET_OPTIONS\.filter\(option => option\.key !== currentMarket\)/);
  for (const label of ['✅ منتهي', '⏸ متوقف', '↩️ استرداد', '👥 عملاء محتملين', '🏢 فرع الدقي']) assert.ok(modal.includes(label), label);
  const tab = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  assert.match(tab, /market: convertType, branch: MARKET_BRANCH\[convertType\],/);
});

test('distribution to collection keeps to who is on, their markets and their cap', () => {
  const config = sanitizeCollectionConfig({ members: [
    { staffId: 'a', isAvailable: true, markets: ['saudi', 'bogus'], intakeLimit: 1, intakePeriod: 'week' },
    { staffId: 'b', isAvailable: true, markets: [], intakeLimit: '' },
    { staffId: 'c', isAvailable: false },
  ] });
  assert.deepEqual(config.members[0].markets, ['saudi']);
  assert.equal(config.members[0].intakePeriod, 'week');
  assert.equal(config.members[1].intakeLimit, null);
  assert.equal(config.members[1].intakePeriod, 'day');
  const staff = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const picker = createCollectionPicker(staff, config, new Map());
  assert.equal(picker.size, 2);
  assert.equal(picker.next('local').id, 'b');     // A takes Saudi only
  assert.ok(['a', 'b'].includes(picker.next('saudi').id));
  const again = createCollectionPicker(staff, config, new Map([['a', 1]]));
  assert.equal(again.next('saudi').id, 'b');       // A is at their cap
  // Nothing configured: every collection employee, as before.
  assert.equal(createCollectionPicker(staff, sanitizeCollectionConfig({}), new Map()).size, 3);
  const route = read('api/routes/admin/stafflists.js');
  assert.match(route, /const cs = picker\.next\(subscriberMarket\(row\)\);/);
  assert.match(route, /requireCollectionLead, bulkOperationLimiter/);
});

test('an officer set on a client is saved, whichever name the screen sends it under', () => {
  const save = read('api/routes/admin/subscribers.js');
  // assignmentFrom: the whole record, or only the fields a partial save changed.
  assert.match(save, /let csId   = assignmentFrom\.assignedCollectionId   \|\| assignmentFrom\.assignedCsId   \|\| null;/);
  const bulk = read('admin/pages/dashboard/tabs/online-clients-sections/BulkActionBar.tsx');
  assert.doesNotMatch(bulk, /collectionStaffId/);
  const modal = read('admin/pages/dashboard/tabs/online-clients-sections/CollectionSettingsModal.tsx');
  assert.match(modal, /'\/admin\/collection-sheets\/import',\s+\{ staffId: officer\.id, kind, source, rows \}/);
  assert.match(modal, /\/admin\/collection-sheets\/csv\?sheetId=/);
  const sheets = read('api/routes/collection-distribution.js');
  assert.match(sheets, /fetchCsvFollowRedirects\(/);
});
