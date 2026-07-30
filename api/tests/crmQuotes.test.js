'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  quoteNumber,
  validateQuoteInput,
  calculateQuote,
  loadCatalogSnapshots,
  resolveDiscountApproval,
} = require('../lib/crmQuotes');

test('CRM quote pricing is server-owned, currency-aware and rounded', () => {
  const validated = validateQuoteInput({
    currency: 'egp',
    discount_percent: 10,
    tax_percent: 14,
    items: [
      { item_type: 'course', item_id: 'c1', quantity: 2 },
      { item_type: 'bundle', item_id: 'b1', quantity: 1 },
    ],
  });
  const snapshots = new Map([
    ['course:c1', { itemType: 'course', itemId: 'c1', title: 'Course', unitPrice: 100, currency: 'EGP' }],
    ['bundle:b1', { itemType: 'bundle', itemId: 'b1', title: 'Bundle', unitPrice: 50, currency: 'EGP' }],
  ]);
  const result = calculateQuote(validated, snapshots);
  assert.equal(result.subtotal, 250);
  assert.equal(result.discountAmount, 25);
  assert.equal(result.taxAmount, 31.5);
  assert.equal(result.total, 256.5);
  assert.equal(result.items.length, 2);
});

test('CRM quote rejects arbitrary items, currencies and discounts', () => {
  assert.throws(() => validateQuoteInput({ currency: 'BTC', items: [{}] }), /currency/);
  assert.throws(() => validateQuoteInput({
    currency: 'EGP', discount_percent: 101,
    items: [{ item_type: 'course', item_id: 'c1' }],
  }), /between 0 and 100/);
  assert.throws(() => validateQuoteInput({
    currency: 'EGP', items: [{ item_type: 'custom', item_id: 'x' }],
  }), /Invalid quote item/);
  assert.match(quoteNumber(new Date('2026-07-30')), /^Q-20260730-[A-F0-9]{8}$/);
});

test('discount approval matrix escalates by band and freezes eligible roles', () => {
  assert.deepEqual(resolveDiscountApproval(5), {
    required: false, level: 'none', roles: [], discountPercent: 5,
  });
  assert.equal(resolveDiscountApproval(15).level, 'manager');
  assert.ok(resolveDiscountApproval(15).roles.includes('online_manager'));
  assert.deepEqual(resolveDiscountApproval(25).roles, ['admin', 'manager']);
});

test('catalog snapshot loader binds tenant and server-side currency price columns', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[{
        id: 'c1', title: 'Course', unit_price: 100,
        catalog_updated_at: '2026-07-30',
      }]];
    },
  };
  const validated = validateQuoteInput({
    currency: 'SAR',
    items: [{ item_type: 'course', item_id: 'c1' }],
  });
  const snapshots = await loadCatalogSnapshots(db, 'tenant-a', validated);
  assert.equal(snapshots.get('course:c1').unitPrice, 100);
  assert.match(calls[0].sql, /price_sar AS unit_price/);
  assert.deepEqual(calls[0].params, ['tenant-a', 'c1']);
});

test('CRM quote lifecycle is scoped, transactional, SOD protected and ledger-safe', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'crm-quotes.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '162_v25_crm_quotes_cpq.sql'), 'utf8');
  assert.match(route, /requirePermission\('manage_leads'\)/);
  assert.ok((route.match(/leadScope\(req, 'l'\)/g) || []).length >= 5);
  assert.match(route, /beginTransaction\(\)/);
  assert.match(route, /QUOTE_APPROVAL_SOD/);
  assert.match(route, /QUOTE_APPROVAL_LEVEL_REQUIRED/);
  assert.match(route, /approval_policy_snapshot/);
  assert.match(route, /catalog_snapshot/);
  assert.match(route, /status='converted'/);
  assert.match(route, /'PENDING'/);
  assert.doesNotMatch(route, /'PAID'/);
  assert.match(route, /logLeadEventStrict/);
  assert.match(migration, /crm_quote_approvals/);
  assert.match(migration, /crm_quote_orders/);
});
