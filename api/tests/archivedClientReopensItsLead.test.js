'use strict';

// The reconcile check's CRITICAL «converted leads have a linked subscriber»
// on 28 September: three leads, and behind each one a client the owner had
// archived — two bookings made by mistake and a test. Archiving left the lead
// at converted, out of every sales list, with no customer behind it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { reopenLeadOfArchivedClient, reconvertLeadOfRestoredClient } = require('../lib/leadState');

// Just enough of the database for the two helpers and transitionLead.
function fakeDb({ lead, otherLiveClient = false, before = null }) {
  const timeline = [];
  const db = {
    async query(sql, params) {
      if (/FROM subscribers s JOIN leads l/.test(sql)) {
        const wantsConverted = /l\.status='converted'/.test(sql);
        const matches = wantsConverted ? lead.status === 'converted' && !otherLiveClient : lead.status !== 'converted';
        return [[matches ? { id: lead.id } : undefined]];
      }
      if (/FROM lead_timeline/.test(sql)) return [[before ? { status: before } : undefined]];
      if (/SELECT \* FROM leads/.test(sql)) return [[{ ...lead }]];
      if (/SELECT id FROM subscribers/.test(sql)) return [[{ id: 'sub-1' }]];
      if (/UPDATE leads SET status=\?/.test(sql)) { lead.status = params[0]; return [{}]; }
      if (/INSERT INTO lead_timeline/.test(sql)) { timeline.push(JSON.parse(params[4])); return [{}]; }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return { db, timeline };
}

test('archiving a client puts their lead back where it stood before converting', async () => {
  const lead = { id: 'lead-1', status: 'converted' };
  const { db, timeline } = fakeDb({ lead, before: 'archived' });
  await reopenLeadOfArchivedClient({ tenantId: 't1', subscriberId: 'sub-1', actor: 'owner@x', db });
  assert.equal(lead.status, 'archived');
  assert.deepEqual(timeline.map(row => [row.from, row.to, row.subscriberId]), [['converted', 'archived', 'sub-1']]);
});

test('with no record of the earlier status, the lead reopens as new', async () => {
  const lead = { id: 'lead-1', status: 'converted' };
  const { db } = fakeDb({ lead });
  await reopenLeadOfArchivedClient({ tenantId: 't1', subscriberId: 'sub-1', db });
  assert.equal(lead.status, 'new');
});

test('a lead still answered for by another live client stays converted', async () => {
  const lead = { id: 'lead-1', status: 'converted' };
  const { db, timeline } = fakeDb({ lead, otherLiveClient: true, before: 'new' });
  assert.equal(await reopenLeadOfArchivedClient({ tenantId: 't1', subscriberId: 'sub-1', db }), null);
  assert.equal(lead.status, 'converted');
  assert.equal(timeline.length, 0);
});

test('restoring the client converts the lead again', async () => {
  const lead = { id: 'lead-1', status: 'new' };
  const { db } = fakeDb({ lead });
  await reconvertLeadOfRestoredClient({ tenantId: 't1', subscriberId: 'sub-1', db });
  assert.equal(lead.status, 'converted');
});

test('archive and restore both move the lead, inside their own transaction', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'core', 'catalog.js'), 'utf8');
  assert.match(route, /deleted_at=NOW\(\), updated_at=NOW\(\) WHERE id=\? AND tenant_id=\?',\s+\[req\.params\.id, req\.tenantId\]\s+\);\s+await reopenLeadOfArchivedClient\(\{[^}]*db: conn \}\);/);
  assert.match(route, /deleted_at=NULL, updated_at=NOW\(\) WHERE id=\? AND tenant_id=\?',\s+\[req\.params\.id, req\.tenantId\]\s+\);\s+await reconvertLeadOfRestoredClient\(\{[^}]*db: conn \}\);/);
});
