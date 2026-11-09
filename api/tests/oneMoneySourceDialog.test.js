'use strict';
// The payment dialog reads what a client owes from the server (admin/lib/clientMoney.ts), not from the copy of the client its caller holds
// (7 Nov 2026: «عدّلت السعر ودفع وحجز ما أخدوش»). The pure part — clientHoldings — is bundled with esbuild and run; the hook is held to its wiring.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function load(entry) {
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

test('with the server\'s answer the dialog holds the price on file, whatever the stale client copy says', () => {
  const loaded = load('admin/components/payment-modal/clientHoldings.ts');
  if (!loaded) return;
  const course = { id: 'c1', title: 'Course', titleAr: 'كورس', price: { EGP: 3000 } };
  // The caller's copy still carries the old price (2500) and an old payment; the server says 2000 agreed, 1000 paid, 300 before the system.
  const stale = { id: 's1', name: 'x', enrolledCourseIds: ['c1'], customPrices: { c1: 2500 }, paymentHistory: [] };
  const money = {
    subscriberId: 's1', nationality: null, certificates: [], extras: [], totals: {},
    items: [{ item: 'c1', kind: 'course', title: 'كورس', currency: 'EGP', catalogue: 3000, agreed: 2000, source: 'client', paid: 1000, priorPaid: 300, remaining: 700 }],
  };
  const withServer = loaded.clientHoldings(stale, [course], [], 'EGP', money);
  assert.deepEqual(withServer.enrolledOptions.map(o => [o.cid, o.px, o.paid, o.remaining]), [['c1', 2000, 1300, 700]]);
  const alone = loaded.clientHoldings(stale, [course], [], 'EGP');
  assert.deepEqual(alone.enrolledOptions, [], 'without the server answer nothing is held: the browser has no rule of its own');
});


