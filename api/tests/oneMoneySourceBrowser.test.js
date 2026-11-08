'use strict';
// The browser does not work out what a client owes (8 Nov 2026: «محتاجين نوصل لتوحيد مصدر البيانات المحاسبية»). The rule — the client's own price, else what their
// booking recorded, else the catalogue; a track paid once — is api/lib/clientItems.js, and every list row arrives with its result as `moneyItems`; the client's page
// and the payment dialog ask GET /api/admin/clients/:id/money. It was a third copy in admin/lib/agreedPrice.ts, read by about fifteen screens from whatever copy of the
// client each held. This fails if a price rule comes back into the admin sources.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN = path.join(__dirname, '..', '..', 'admin');
function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'public'].includes(entry.name)) continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(target, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(target);
  }
  return out;
}

test('no admin screen carries a price rule of its own', () => {
  const found = [];
  const rules = [
    [/\bagreedPriceFor\b|\bclientItems\s*\(|\bpaidFor\s*\(/, 'the browser rule of the agreed price'],
    [/Math\.max\([^)]*courseExpected/, 'the highest booked price, worked out in the browser'],
    [/customPrices\??\.?\[/, 'a price read out of the client\'s agreed prices'],
    [/priorPaid\??\.?\[/, 'money paid before the system read in the browser'],
  ];
  for (const file of sources(ADMIN)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [pattern, what] of rules) if (pattern.test(text)) found.push(`${path.relative(ADMIN, file)}: ${what}`);
  }
  assert.deepEqual(found, []);
});

test('the rows and the dialog read the server: moneyItems on every list row, one money route', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const lists = read('routes/admin/stafflists.js');
  assert.equal((lists.match(/withMoneyItems\(/g) || []).length, 4, 'the three row builders of the admin lists and the shaped staff rows');
  
  
  
  
});
