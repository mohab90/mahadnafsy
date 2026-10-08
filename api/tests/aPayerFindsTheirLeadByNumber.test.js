'use strict';

// HIGH-06 of the 7 Oct 2026 audit: a paying customer with an email was matched
// to a lead by that email only. Most Facebook and sheet leads carry a number and
// no email, so the payer's lead stayed unconverted and its rep earned nothing.
// The number is tried when the email finds none — unless that lead is under
// another address: somebody else on the same (family) number.

const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureSubscriberForOrder } = require('../lib/subscriberProvisioning');

function conn(numberLead) {
  const inserts = [];
  return {
    inserts,
    async query(sql, params) {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      if (/FROM subscribers WHERE tenant_id=\? AND \(firebase_uid=\? OR LOWER\(TRIM\(email\)\)=\?\)/.test(flat)) return [[undefined]];
      if (/FROM subscribers WHERE tenant_id=\? AND phone=\?/.test(flat)) return [[undefined]];
      if (/FROM leads WHERE tenant_id=\? AND LOWER\(TRIM\(email\)\)=\?/.test(flat)) return [[undefined]];
      if (/^SELECT id, status FROM leads/.test(flat)) return [[numberLead ? { id: numberLead.id, status: 'contacted' } : undefined]];
      if (/FROM leads WHERE id=\? LIMIT 1 FOR UPDATE/.test(flat)) return [[numberLead]];
      if (/client_code_counter/.test(flat)) return /^SELECT/.test(flat) ? [[{ next_value: 7 }]] : [{ affectedRows: 1 }];
      if (/^INSERT INTO subscribers/.test(flat)) { inserts.push(params); return [{ affectedRows: 1 }]; }
      if (/^UPDATE/.test(flat)) return [{ affectedRows: 1 }];
      return [[]];
    },
  };
}
const payer = { tenantId: 't1', email: 'payer@example.com', name: 'Payer', phone: '01012345678' };

test('a lead known by the number alone is the payer\'s, with its rep', async () => {
  const db = conn({ id: 'L-fb', email: null, branch: 'ONLINE_EGYPT', assigned_sales_id: 'st-sama', assigned_sales_name: 'سما' });
  const sub = await ensureSubscriberForOrder(db, payer);
  assert.equal(sub.lead_id, 'L-fb');
  assert.equal(sub.assigned_sales_id, 'st-sama');
});

test('a lead on the same number under another address is someone else', async () => {
  const db = conn({ id: 'L-sister', email: 'sister@example.com', assigned_sales_id: 'st-x' });
  const sub = await ensureSubscriberForOrder(db, payer);
  assert.equal(sub.lead_id, null);
  assert.equal(sub.assigned_sales_id, null);
});
