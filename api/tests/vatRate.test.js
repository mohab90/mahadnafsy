'use strict';

// The VAT rate on a document comes from the setting an admin edits.
//
// There were two keys for one number. الإعدادات ← المالية writes
// tenant_settings['sys_financial'].vat_percent — 14 on production. The receipt,
// the invoice and «تقرير ضريبة القيمة المضافة» each read a top-level `vat_pct`
// that nothing has ever written; checked on production, it exists in neither
// tenant_settings nor site_config.
//
// So `vatPct` resolved to 0, `p._vatPct > 0` was false, and the tax block at
// finance.js:209 and :359 was skipped on every document the institute has ever
// printed — while the settings screen said 14%.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('one resolver answers the VAT rate, and both documents use it', () => {
  const lib = read('api/lib/finance.js');
  assert.match(lib, /async function getVatPercent\(tenantId = DEFAULT_TENANT\)/);
  assert.match(lib, /^  getVatPercent,$/m, 'it has to be exported to be shared');

  // Nobody reads the bare key on their own any more.
  for (const rel of ['api/routes/finance.js', 'api/routes/analytics/financial.js']) {
    const src = read(rel);
    assert.ok(!/getTenantSetting\(\s*'vat_pct'/.test(src),
      `${rel} still reads vat_pct directly instead of the shared resolver`);
    assert.match(src, /getVatPercent\(/, `${rel} does not call the resolver`);
  }

  // And the resolver is the only place that names either key.
  const namers = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'tests') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.js$/.test(entry.name)) {
        const rel = path.relative(ROOT, full).split(path.sep).join('/');
        if (rel === 'api/lib/finance.js') continue;
        if (/'vat_pct'/.test(fs.readFileSync(full, 'utf8'))) namers.push(rel);
      }
    }
  };
  walk(path.join(ROOT, 'api'));
  assert.deepEqual(namers, [], 'these still reach for the raw key: ' + namers.join(', '));
});

test('the settings value wins, and a legacy value still overrides it', () => {
  // Ported from api/lib/finance.js — the branch order is what matters.
  const source = read('api/lib/finance.js');
  assert.ok(source.includes(
    `  const legacy = Number(await getTenantSetting('vat_pct', { tenantId, fallback: null }));`),
  'the legacy key is read first so a tenant that has one keeps it');
  assert.ok(source.includes(`  const financial = await getTenantSetting('sys_financial', { tenantId, fallback: null });`),
    'and the screen is where the answer comes from otherwise');

  const resolve = (legacy, financial) => {
    const l = Number(legacy);
    if (Number.isFinite(l) && l > 0) return l;
    const c = Number(financial?.vat_percent);
    return Number.isFinite(c) && c > 0 ? c : 0;
  };

  // Production today: no vat_pct, sys_financial.vat_percent = 14.
  assert.equal(resolve(null, { vat_percent: 14 }), 14,
    'this is the case that was printing 0 on every receipt');
  assert.equal(resolve(5, { vat_percent: 14 }), 5, 'a tenant with the old key keeps it');
  assert.equal(resolve(null, null), 0, 'nothing configured is still nothing');
  assert.equal(resolve(null, { vat_percent: 0 }), 0, 'zero is a real answer, not a missing one');
  assert.equal(resolve(null, { vat_percent: 'abc' }), 0, 'junk does not become NaN on a document');
});

test('a rate above zero puts the tax line back on the document', () => {
  // The templates gate on it, which is why 0 removed the line rather than
  // printing «ضريبة (0%)».
  const src = read('api/routes/finance.js');
  // Two documents, two gates — the 70mm receipt and the A4 invoice. Counting
  // them, because asserting one match still passes when the other is removed.
  const gates = src.match(/\$\{p\._vatPct > 0 \?/g) || [];
  assert.equal(gates.length, 2,
    'both the receipt and the invoice gate their tax block on a positive rate');

  // And the arithmetic derives the tax out of the gross, rather than adding to it.
  assert.match(src, /p\._netAmount = vatPct > 0\s*\n\s*\? parseFloat\(\(p\._amount \/ \(1 \+ vatPct \/ 100\)\)\.toFixed\(2\)\)/);
  const gross = 1150;
  const net = parseFloat((gross / (1 + 14 / 100)).toFixed(2));
  const vat = parseFloat((gross - net).toFixed(2));
  assert.equal(net, 1008.77);
  assert.equal(vat, 141.23);
  assert.equal(parseFloat((net + vat).toFixed(2)), gross,
    'the parts have to add back to the cash actually collected');
});
