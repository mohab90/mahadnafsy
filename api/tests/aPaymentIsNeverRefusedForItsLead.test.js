'use strict';

// «لما بنيجي نربط تحويل اوقات بيظهر ايرور lead not found» (8 Oct 2026). Approving
// a payment — linking it to a transfer — converts the lead the client came from,
// and the lookup skipped hidden leads: 463 clients' leads were hidden, and 49
// approvals and paid payments in two days answered «Lead not found» and saved
// nothing.

const test = require('node:test');
const assert = require('node:assert/strict');

const seen = [];
let lead = null;
const query = async (sql, params = []) => {
  const flat = String(sql).replace(/\s+/g, ' ').trim();
  seen.push(flat);
  if (/^SELECT \* FROM leads WHERE tenant_id=\? AND id=\?/.test(flat)) {
    const hiddenSkipped = / AND hidden=0/.test(flat);
    return [[lead && !(hiddenSkipped && lead.hidden) ? lead : undefined].filter(Boolean)];
  }
  if (/^SELECT .*FROM subscribers/.test(flat)) return [[{ id: 's-1' }]];
  return [{ affectedRows: 1 }];
};
const conn = { query, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} };
const stubFile = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stubFile('../lib/db', { pool: { query, getConnection: async () => conn } });
stubFile('../lib/leadPipeline', { validateTransition: async () => {} });

const { convertLeadOfPayment, transitionLead } = require('../lib/leadState');

test('a hidden lead is converted by the payment, not refused', async () => {
  lead = { id: 'L-1', status: 'interested', hidden: 1 };
  const result = await convertLeadOfPayment({ tenantId: 't', leadId: 'L-1', db: conn, actor: 'هنا', metadata: { subscriberId: 's-1' } });
  assert.equal(result.changed, true);
  assert.ok(seen.some(sql => /^UPDATE leads SET status=\?/.test(sql) || /UPDATE leads/.test(sql)), 'the lead is written');
});

test('a lead that is gone lets the money through', async () => {
  lead = null;
  const result = await convertLeadOfPayment({ tenantId: 't', leadId: 'L-gone', db: conn, metadata: { subscriberId: 's-1' } });
  assert.deepEqual(result, { changed: false, missing: true });
});

test('elsewhere a hidden lead is still not there', async () => {
  lead = { id: 'L-1', status: 'interested', hidden: 1 };
  await assert.rejects(transitionLead({ tenantId: 't', leadId: 'L-1', toStatus: 'contacted', db: conn }), /Lead not found/);
});

test('every payment path converts through it', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const file of ['routes/core/financepay.js', 'routes/payment-proofs.js', 'routes/subscriber-payments.js', 'lib/orderPaymentConfirmation.js', 'lib/paymobFinalise.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(source, /convertLeadOfPayment\(\{/, file);
    assert.doesNotMatch(source, /transitionLead\(/, file);
  }
});
