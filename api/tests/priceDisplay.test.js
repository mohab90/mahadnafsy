'use strict';

// A price is a number by the time it leaves the API, and it is written by one
// module by the time it reaches a customer.
//
// `price_egp` is DECIMAL(10,2) and mysql2 returns a DECIMAL as a **string**, so
// `r.price_egp || 0` kept "7900.00" and the whole catalogue travelled as text.
// Two failures, one cause:
//
//   the compare   `oldPrice > currentPrice` compares text. "11500.00" is not
//                 greater than "5600.00", so ten of the institute's thirty-one
//                 products showed no discount — verified in the browser against
//                 production: five courses and five bundles, every one a ~51%
//                 cut on a headline programme, advertised at full price.
//
//   the display   the string printed as it arrived: «14800.00 ج.م» on every
//                 card of every catalogue page.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * The real shared/priceFormat.ts, not a copy of it. node strips the type
 * annotations, so what runs below is what both apps ship — three mutations of
 * this file's own rules walked past a ported reimplementation.
 */
function priceModule() {
  const js = require('node:module')
    .stripTypeScriptTypes(read('shared/priceFormat.ts'))
    .replace(/^export /gm, '');
  const box = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports',
    js + '\nmodule.exports = { currencySymbol, toAmount, formatAmount, formatPrice, isDiscounted, discountPercent };',
  )(box, box.exports);
  return box.exports;
}

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

function clientSources() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, 'client'));
  return out.map(f => path.relative(ROOT, f).split(path.sep).join('/'));
}

test('the API coerces every price it builds', () => {
  const mappers = codeOnly(read('api/lib/mappers.js'));
  assert.match(mappers, /const money = value => \{/);
  assert.ok(!/r\.(?:orig_)?price_(?:egp|sar|usd)\s*\|\|\s*0/.test(mappers),
    'a price column is still passed through with || 0, which keeps the string');

  // Every price object goes through it — 7 sites: two mappers × two objects
  // × three currencies collapses to 4 object literals plus 3 therapist consts.
  const coerced = (mappers.match(/money\(r\./g) || []).length;
  assert.ok(coerced >= 15, `expected every price column coerced, saw ${coerced}`);

  // mappers.js opens a connection pool on require, so its one decisive line is
  // pinned rather than executed.
  assert.ok(mappers.includes('  const n = Number(value);'), 'the coercion must call Number()');
  assert.ok(mappers.includes('  return Number.isFinite(n) ? n : 0;'),
    'and must not let NaN reach a price tag');

  const money = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
  assert.strictEqual(money('7900.00'), 7900);
  assert.strictEqual(money('11500.00'), 11500);
  assert.strictEqual(money(null), 0);
  assert.strictEqual(money(undefined), 0);
  assert.strictEqual(money('abc'), 0, 'junk must not become NaN on a price tag');
  assert.strictEqual(typeof money('7900.00'), 'number');
});

test('the comparison that hid ten discounts is arithmetic now', () => {
  const shared = read('shared/priceFormat.ts');
  assert.match(shared, /export function isDiscounted/);

  const { isDiscounted } = priceModule();

  // The five courses and five bundles that were showing full price.
  for (const [was, now] of [
    [13800, 7900], [11500, 5600], [11600, 5600],
    [14000, 6800], [16000, 7800], [18000, 8900],
  ]) {
    assert.equal(isDiscounted(was, now), true, `${was} → ${now} is a discount`);
    // And it survives a string, in case some endpoint sends one again.
    assert.equal(isDiscounted(`${was}.00`, `${now}.00`), true,
      `${was} → ${now} as strings must still be a discount`);
    assert.equal(`${was}.00` > `${now}.00`, false,
      'the premise: the raw string compare says otherwise');
  }

  // And it does not invent one.
  assert.equal(isDiscounted(900, 1000), false, 'a price rise is not a discount');
  assert.equal(isDiscounted('900.00', '1000.00'), false, 'nor as strings');
  assert.equal(isDiscounted(5600, 5600), false, 'equal is not a discount');
  assert.equal(isDiscounted(0, 5600), false, 'no original price, no strikethrough');
});

test('no customer screen prints a raw price any more', () => {
  const offenders = [];
  for (const rel of clientSources()) {
    if (rel === 'shared/priceFormat.ts') continue;
    const source = codeOnly(read(rel));
    // `{x.price?.[currency]}` or `{oldPrice} {currencySymbol}` with no formatter
    for (const m of source.matchAll(/\{\s*([\w$.?]*(?:price|Price)[\w$.?]*(?:\?\.)?\[[^\]]+\])\s*\}/g)) {
      offenders.push(`${rel}  {${m[1]}}`);
    }
    for (const m of source.matchAll(/\{(oldPrice|currentPrice|strikePrice|payPrice)\}\s*\{currencySymbol\}/g)) {
      offenders.push(`${rel}  {${m[1]}} {currencySymbol}`);
    }
  }
  assert.deepEqual(offenders, [],
    'these print the value as it arrived — «14800.00 ج.م»: ' + offenders.join(', '));
});

test('one module decides how a price reads, and knows the symbols', () => {
  const shared = read('shared/priceFormat.ts');
  for (const fn of ['currencySymbol', 'toAmount', 'formatAmount', 'formatPrice', 'isDiscounted', 'discountPercent']) {
    assert.match(shared, new RegExp(`export function ${fn}\\b`), `${fn} is missing`);
  }
  assert.match(shared, /'ar-EG-u-nu-latn'/,
    'the same locale as the admin — Arabic grouping, Latin digits');

  const { formatAmount, discountPercent, formatPrice, currencySymbol } = priceModule();
  assert.equal(formatAmount('14800.00'), '14,800', 'the whole point: separator in, dead decimals out');
  assert.equal(formatAmount(30000), '30,000');
  assert.equal(formatAmount('7900.50'), '7,900.5', 'real piastres survive');
  assert.equal(formatAmount(0), '0');
  assert.equal(formatAmount(null), '0');

  assert.equal(discountPercent(11500, 5600), 51);
  assert.equal(discountPercent(13800, 7900), 43);
  assert.equal(discountPercent(5600, 5600), 0, 'no discount, no percentage');

  assert.equal(formatPrice('14800.00', 'EGP'), '14,800 ج.م');
  assert.equal(formatPrice(680, 'USD'), '680 ' + String.fromCharCode(36));
  assert.equal(currencySymbol('SAR'), 'ر.س');
  assert.equal(currencySymbol('ZZZ'), 'ZZZ', 'an unknown code keeps its code rather than lying');
});
