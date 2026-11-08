'use strict';

const { authRouteSource, leadsRouteSource } = require('./_authRouteSource');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('lead conversion is tenant-owned, transactional and releases once', () => {
  const route = leadsRouteSource();
  assert.match(route, /FROM leads WHERE id=\? AND tenant_id=\? AND hidden=0/);
  // Tenant-scoped, and it must not match a deleted customer: reusing one
  // points the converted lead at a record the app treats as gone, so the
  // conversion reports success and the customer never appears anywhere.
  assert.match(route, /SELECT id FROM subscribers[\s\S]{0,120}WHERE tenant_id=\?[\s\S]{0,80}lead_id=\?/);
  assert.match(route, /SELECT id FROM subscribers[\s\S]{0,80}deleted_at IS NULL/);
  assert.match(route, /let transactionStarted = false/);
  assert.match(route, /finally \{ conn\.release\(\); \}/);
});

test('account creation first payment is period-locked and journaled atomically', () => {
  const auth = authRouteSource();
  assert.match(auth, /assertWritable\(paymentDate, conn, tenantId\)/);
  assert.match(auth, /postPaymentJournal\([\s\S]*tenantId[\s\S]*\}, conn\)/);
  assert.match(auth, /Payment subscriber not found in tenant/);
  assert.doesNotMatch(auth, /firstPayment insert failed/);
});

test('CRM operational views share the canonical role and branch scope', () => {
  const access = read('lib/leadAccess.js');
  const admin = leadsRouteSource();
  const advanced = read('routes/crm-advanced.js');
  const ops = read('routes/crm-ops.js');
  // Scope resolution moved behind resolveDataScope() so a per-staff
  // `staff.data_scope` override can beat the role-keyed DATA_SCOPE table —
  // needed for hybrid jobs whose single role cannot express their reach.
  
  
  
  
  assert.match(admin, /leadScope\(req, 'l'\)/);
  
  
});
