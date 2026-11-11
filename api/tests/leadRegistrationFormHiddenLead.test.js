'use strict';
// POST /api/registrations when the number belongs to a HIDDEN lead (one the rep hid, or the cold-lead job archived). leads keeps a unique
// key on the number, so the form must land on that lead: it used to look only at visible leads, filed the row under a fresh id, and the
// ON DUPLICATE KEY clause updated the hidden row while the timeline entry and the answer named a lead that does not exist.
// The database here is the recording stub; it answers the lookup the way MariaDB would — a hidden row only when the statement does not
// exclude hidden ones.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { install, run } = require('./_routeHarness');

const h = install();
const clientContext = require('../lib/clientContext');
clientContext.resolveClientContext = async () => ({ locationResolved: true, branch: 'ONLINE_EGYPT', countryCode: 'EG' });
require('../lib/lifecycle').trigger = async () => {};
require('../lib/metaCapi').trackLead = async () => {};
const router = require('../routes/lead-capture-crm');
after(() => setTimeout(() => process.exit(), 300).unref());

test('a form for the number of a hidden lead goes onto that lead, under its own id', async () => {
  const hiddenLead = { id: 'lead-hidden', client_code: 'C-9', crm_json: '{}', assigned_sales_id: null, assigned_sales_name: null, hidden: 1 };
  h.state.answer = sql => {
    if (/GET_LOCK/.test(sql)) return [{ acquired: 1 }];
    if (/FROM leads\s+WHERE tenant_id=\?/.test(sql)) return /hidden\s*=\s*0/.test(sql) ? [] : [hiddenLead];
    return undefined;
  };
  const res = await run(router, 'POST', '/api/registrations', { as: 'anonymous', body: { name: 'Hala', phone: '01012345678', notes: 'again' }, harness: h });
  assert.equal(res.status, 200);
  assert.equal(res.body.id, 'lead-hidden', 'the answer names the lead that holds the number');
  const insert = h.calls.find(call => /INSERT INTO leads/.test(call.sql));
  assert.equal(insert.params[0], 'lead-hidden', 'the row written is that lead\'s, not a new id');
  const event = h.calls.find(call => /INSERT INTO lead_timeline/.test(call.sql));
  assert.ok(event && event.params.includes('lead-hidden'), 'the timeline entry is on the real lead');
});
