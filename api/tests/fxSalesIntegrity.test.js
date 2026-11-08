'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

const ROUTES = path.join(__dirname, '..', 'routes');
function routeFiles(dir = ROUTES) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? routeFiles(target) : [target];
  }).filter(file => file.endsWith('.js'));
}



// The snapshot only protects a total that actually reads it.
//
// The payment-review breakdown summed `p.amount` behind `AND p.currency='EGP'`
// instead, so a SAR or USD payment counted as zero although amount_egp holds
// its converted value. The figure sat beside a correct total with nothing to
// say it was measuring something narrower.
//
// Scoped to aggregates: filtering by currency in a WHERE clause is legitimate
// (the FX audit does it deliberately). Doing it inside a SUM over money is the
// error, and it is invisible unless something looks for it.
test('no money aggregate re-derives EGP by filtering on the currency column', () => {
  const offenders = [];
  for (const file of routeFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/SUM\(\s*CASE[\s\S]{0,400}?END\s*\)/g)) {
      const expression = match[0];
      if (!/\bamount\b/.test(expression)) continue;
      if (!/\bcurrency\b/.test(expression)) continue;
      offenders.push(`${path.relative(ROUTES, file).replace(/\\/g, '/')}: ${expression.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
  assert.deepEqual(offenders, [], 'these sums decide what counts as money from the currency column instead of reading amount_egp');
});


