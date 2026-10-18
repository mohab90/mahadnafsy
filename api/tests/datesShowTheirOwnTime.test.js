'use strict';

// «في صفحه المدفوعات شوف الساعه والتاريخ مكتوب ازاي 18‏/10‏/2026، 03:00 ص ؟؟؟» (19 Oct 2026).
// A payment's date names a day: payments.date is 2026-10-18 00:00:00, and a screen that formatted it as an instant
// printed Cairo's clock at UTC midnight, «03:00 ص», as if the money had come in at three in the morning. A value that
// names a day shows the day alone; a recorded moment shows its time, on Cairo's clock, in one tidy form.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function bundle(entry) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node',
    logLevel: 'silent', nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

test('a date-only value shows the day, a recorded moment shows its time on Cairo\'s clock', () => {
  const lib = bundle('shared/cairoDate.ts');
  if (!lib) return;
  const { isDateOnly, cairoStamp, cairoDateLabel, cairoDateTime } = lib;
  // cairoDateTime stays the plain instant (an input typed at 03:00 is a real moment at UTC midnight): the people's
  // forms below are the ones that drop a date-only value's time.
  // The shapes a payment's date arrives in.
  for (const dateOnly of ['2026-10-18', '2026-10-18T00:00:00.000Z', '2026-10-18 00:00:00']) {
    assert.equal(isDateOnly(dateOnly), true, dateOnly);
    assert.equal(cairoStamp(dateOnly), '18/10/2026', `${dateOnly} has no time to show`);
  }
  // 17:07 UTC is 20:07 in Cairo (UTC+3 on 18 Oct 2026): «8:07 م», never «03:00 ص».
  assert.equal(cairoStamp('2026-10-18T17:07:06.000Z'), '18/10/2026 · 8:07 م');
  assert.equal(cairoStamp('2026-10-18 17:07:06'), '18/10/2026 · 8:07 م', 'a zoneless stored value is UTC');
  assert.equal(cairoStamp('2026-10-18T09:05:00.000Z'), '18/10/2026 · 12:05 م');
  assert.equal(cairoStamp('2026-10-18T21:30:00.000Z'), '19/10/2026 · 12:30 ص', 'past Cairo midnight it is the next day');
  assert.equal(cairoDateTime('2026-10-18T17:07:06.000Z'), '2026-10-18 20:07');
  assert.equal(cairoDateLabel('2026-10-18T17:07:06.000Z'), '18/10/2026');
  // Nothing, and nonsense, show nothing — and no direction marks or Arabic commas ever.
  for (const nothing of [undefined, null, '', 'not a date']) assert.equal(cairoStamp(nothing), nothing === 'not a date' ? '' : '');
  assert.doesNotMatch(cairoStamp('2026-10-18T17:07:06.000Z'), /[‎‏؜،]/);
  assert.equal(isDateOnly('2026-10-18T17:07:06.000Z'), false);
});

test('the pending-payments list is dated by the moment it was recorded when that is the same day', () => {
  const orders = read('api/routes/orders.js');
  assert.match(orders, /p\.is_installment, p\.date, p\.created_at, p\.note,/);
  assert.match(orders, /dateOnlyInTimeZone\(new Date\(recorded\)\) === day\.slice\(0, 10\) \? recorded : day/);
});

test('every table that shows a stamp goes through the one formatter', () => {
  for (const [rel, expect] of [
    ['admin/pages/dashboard/tabs/orders/OrdersAdminView.tsx', /const fmtDate = cairoStamp\(row\.createdAt\)/],
    ['admin/pages/dashboard/tabs/client-db/loginUi.ts', /return cairoStamp\(value\) \|\| String\(value\);/],
    ['admin/pages/dashboard/tabs/CustomerInboxTab.tsx', /return cairoStamp\(value\)/],
    ['admin/pages/staff-profile/StaffMessagesPanel.tsx', /\{cairoStamp\(message\.created_at\)\}/],
    ['admin/pages/dashboard/NotificationsBell.tsx', /const exactTime = \(iso: string\) => cairoStamp\(iso\);/],
    ['admin/pages/unified-client/ClientJourneyTimeline.tsx', /isDateOnly\(at\) \? ''/],
  ]) assert.match(read(rel), expect, rel);
});
