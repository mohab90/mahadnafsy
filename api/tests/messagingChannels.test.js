'use strict';
// The resolution rule decides which number a customer sees a message from, and
// getting it wrong is invisible: the message still arrives, just from the wrong
// identity. These pin the rule against a fake database.
const { test } = require('node:test');
const assert = require('node:assert');

process.env.CHANNEL_SECRET_KEY = process.env.CHANNEL_SECRET_KEY || 'test-key-at-least-sixteen-chars-long';
const { seal } = require('../lib/secretBox');
const { getSendableChannel } = require('../lib/messagingChannels');

/** A db double that answers channel lookups from a list of rows. */
function fakeDb(rows) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      if (!/FROM messaging_channels/.test(sql)) return [[]];
      const tenantId = params[0];
      const match = rows.find(row => {
        if (row.tenant_id !== tenantId || row.is_active !== 1) return false;
        // Anchored on the space before `id`: an unanchored /id = \?/ also
        // matches `owner_staff_id = ?` and would route the staff lookup here.
        if (/\bAND id = \?/.test(sql)) {
          if (row.id !== params[1]) return false;
          return ['connected', 'pending'].includes(row.status);
        }
        if (/owner_staff_id = \?/.test(sql)) {
          return row.owner_staff_id === params[1] && row.kind === params[2] && row.status === 'connected';
        }
        if (/is_default = 1/.test(sql)) {
          return row.is_default === 1 && row.kind === params[1] && !row.owner_staff_id && row.status === 'connected';
        }
        return false;
      });
      return [match ? [match] : []];
    },
  };
}

const channel = (over = {}) => ({
  id: 'c-default', tenant_id: 't1', kind: 'whatsapp', provider: 'green-api',
  owner_staff_id: null, is_default: 1, is_active: 1, status: 'connected',
  credentials_sealed: seal({ instanceId: '1', apiToken: 'x' }),
  ...over,
});

test('with nothing specified, the tenant default is used', async () => {
  const db = fakeDb([channel()]);
  const resolved = await getSendableChannel({ tenantId: 't1' }, db);
  assert.equal(resolved.row.id, 'c-default');
});

test("a rep's own channel wins over the company default", async () => {
  // The whole point of the feature: the customer sees the person, not the
  // switchboard.
  const db = fakeDb([
    channel(),
    channel({ id: 'c-ahmed', owner_staff_id: 'staff-1', is_default: 0 }),
  ]);
  const resolved = await getSendableChannel({ tenantId: 't1', staffId: 'staff-1' }, db);
  assert.equal(resolved.row.id, 'c-ahmed');
});

test('a rep with no channel of their own falls back to the company default', async () => {
  const db = fakeDb([channel()]);
  const resolved = await getSendableChannel({ tenantId: 't1', staffId: 'staff-nobody' }, db);
  assert.equal(resolved.row.id, 'c-default');
});

test('a named channel is used even when it has never been tested', async () => {
  // 'pending' is exactly the state the test-send button exists to resolve.
  const db = fakeDb([channel({ id: 'c-new', status: 'pending', is_default: 0 })]);
  const resolved = await getSendableChannel({ tenantId: 't1', channelId: 'c-new' }, db);
  assert.equal(resolved.row.id, 'c-new');
});

test('naming a channel that cannot send resolves to nothing, never to another one', async () => {
  // The regression this guards: falling through to the default would make the
  // channel test report success while proving nothing about the credentials.
  const db = fakeDb([channel(), channel({ id: 'c-off', is_active: 0, is_default: 0 })]);
  assert.equal(await getSendableChannel({ tenantId: 't1', channelId: 'c-off' }, db), null);
  assert.equal(await getSendableChannel({ tenantId: 't1', channelId: 'c-missing' }, db), null);
});

test('a named channel with unreadable credentials resolves to nothing', async () => {
  const db = fakeDb([channel(), channel({ id: 'c-broken', is_default: 0, credentials_sealed: 'v1:garbage:garbage:garbage' })]);
  assert.equal(await getSendableChannel({ tenantId: 't1', channelId: 'c-broken' }, db), null);
});

test('a channel with no credentials is skipped in favour of one that has them', async () => {
  const db = fakeDb([
    channel({ id: 'c-empty', is_default: 0, owner_staff_id: 'staff-1', credentials_sealed: null }),
    channel(),
  ]);
  const resolved = await getSendableChannel({ tenantId: 't1', staffId: 'staff-1' }, db);
  assert.equal(resolved.row.id, 'c-default');
});

test('another tenant channel is never resolved', async () => {
  const db = fakeDb([channel({ tenant_id: 't2' })]);
  assert.equal(await getSendableChannel({ tenantId: 't1' }, db), null);
});

test('a whatsapp lookup never returns the messenger channel', async () => {
  const db = fakeDb([channel({ id: 'c-msgr', kind: 'messenger', provider: 'messenger' })]);
  assert.equal(await getSendableChannel({ tenantId: 't1', kind: 'whatsapp' }, db), null);
});

test('credentials come back decrypted and usable', async () => {
  const db = fakeDb([channel({ credentials_sealed: seal({ instanceId: '7788', apiToken: 'secret' }) })]);
  const resolved = await getSendableChannel({ tenantId: 't1' }, db);
  assert.deepEqual(resolved.credentials, { instanceId: '7788', apiToken: 'secret' });
});

test('every lookup is scoped to the tenant', async () => {
  const db = fakeDb([channel()]);
  await getSendableChannel({ tenantId: 't1', staffId: 'staff-1' }, db);
  const channelQueries = db.queries.filter(q => /FROM messaging_channels/.test(q.sql));
  assert.ok(channelQueries.length > 0);
  for (const q of channelQueries) assert.match(q.sql, /tenant_id=\?/);
});
