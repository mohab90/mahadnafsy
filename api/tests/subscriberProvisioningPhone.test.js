'use strict';

// A payment is never lost to the phone column.
//
// subscribers has UNIQUE (tenant_id, phone). ensureSubscriberForOrder — the one
// step every payment path runs to find or create the paying customer (Paymob,
// the checkout intent, transfer receipts, an admin confirming an order) —
// inserted `phone || ''` with the number as typed. Two ways that failed:
//
//   * no phone: '' is a value, and production already holds a subscriber with
//     phone '' — so every later payer without a phone collided with it;
//   * a number another subscriber already holds under a different email.
//
// The insert failing rolled back the transaction that marks the order paid and
// opens the course, and the webhook still answered Paymob 200, so nothing
// retried. Found on staging by signing a second capture for a phone the first
// had used. The same '' collision is in production's logs six times, from the
// registration conversion.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ensureSubscriberForOrder } = require('../lib/subscriberProvisioning');

function mockConn({ existingByEmail = null, phoneHolder = null, insertErrors = [] } = {}) {
  const inserts = [];
  let counter = 100;
  return {
    inserts,
    async query(sql, params) {
      if (/FROM subscribers WHERE tenant_id=\? AND \(firebase_uid=\? OR LOWER\(TRIM\(email\)\)=\?\)/.test(sql)) {
        return [[existingByEmail]];
      }
      if (/FROM leads WHERE tenant_id=\? AND LOWER\(TRIM\(email\)\)=\?/.test(sql)) return [[undefined]];
      if (/UPDATE client_code_counter/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT next_value FROM client_code_counter/.test(sql)) return [[{ next_value: ++counter }]];
      if (/SELECT id, client_code FROM subscribers WHERE tenant_id=\? AND phone=\?/.test(sql)) {
        return [[phoneHolder && phoneHolder.phone === params[1] ? phoneHolder : undefined]];
      }
      if (/INSERT INTO subscribers/.test(sql)) {
        const error = insertErrors.shift();
        if (error) throw error;
        inserts.push({ phone: params[6], notes: params[13] });
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE subscribers SET firebase_uid/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error('unexpected query: ' + sql.slice(0, 80));
    },
  };
}

const base = { tenantId: 't1', email: 'payer@example.com', name: 'Payer' };

test('no phone is stored as NULL, never the empty string', async () => {
  for (const phone of ['', '   ', null, undefined]) {
    const conn = mockConn();
    await ensureSubscriberForOrder(conn, { ...base, phone });
    assert.equal(conn.inserts.length, 1);
    assert.equal(conn.inserts[0].phone, null, `phone ${JSON.stringify(phone)} was stored as ${JSON.stringify(conn.inserts[0].phone)}`);
  }
});

test('a new phone is stored in its identity form', async () => {
  const conn = mockConn();
  await ensureSubscriberForOrder(conn, { ...base, phone: '+20 100 000 0000' });
  assert.equal(conn.inserts[0].phone, '1000000000');
  assert.equal(conn.inserts[0].notes, null);
});

test('a phone another subscriber holds leaves it off, records the payer, and says why', async () => {
  const conn = mockConn({ phoneHolder: { id: 'sub-old', client_code: 'C77', phone: '1000000000' } });
  const sub = await ensureSubscriberForOrder(conn, { ...base, phone: '01000000000' });
  assert.ok(sub.id, 'no subscriber was created — the payment has nowhere to go');
  assert.equal(conn.inserts.length, 1);
  assert.equal(conn.inserts[0].phone, null);
  assert.match(conn.inserts[0].notes, /1000000000/);
  assert.match(conn.inserts[0].notes, /C77/);
});

test('losing the race between check and insert still records the payer', async () => {
  const dup = Object.assign(new Error("Duplicate entry 't1-1000000000' for key 'uq_subs_tenant_phone'"), { code: 'ER_DUP_ENTRY' });
  const conn = mockConn({ insertErrors: [dup] });
  const sub = await ensureSubscriberForOrder(conn, { ...base, phone: '01000000000' });
  assert.ok(sub.id);
  assert.equal(conn.inserts.length, 1, 'the retry did not insert');
  assert.equal(conn.inserts[0].phone, null);
  assert.ok(conn.inserts[0].notes);
});

test('any other duplicate is not swallowed', async () => {
  const dup = Object.assign(new Error("Duplicate entry 'C101' for key 'uq_client_code'"), { code: 'ER_DUP_ENTRY' });
  const conn = mockConn({ insertErrors: [dup] });
  await assert.rejects(() => ensureSubscriberForOrder(conn, { ...base, phone: '01000000000' }), /uq_client_code/);
});

test('an existing subscriber is returned and nothing is inserted', async () => {
  const conn = mockConn({ existingByEmail: { id: 'sub-1', tenant_id: 't1' } });
  const sub = await ensureSubscriberForOrder(conn, { ...base, phone: '' });
  assert.equal(sub.id, 'sub-1');
  assert.equal(conn.inserts.length, 0);
});

test('the registration conversion stores NULL for a missing phone too', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'registrations.js'), 'utf8');
  // `(user.phone || '').trim()` still appears — as a fallback for the lead's
  // display *name*, which is not a phone column. What must not appear is the
  // bare value going into one.
  assert.ok(!/user\.email, user\.phone \|\| ''/.test(src), "a registration insert writes '' into a phone column again");
  assert.ok(!/clientCode, \(user\.name \|\| ''\)\.trim\(\) \|\| null, user\.email, user\.phone \|\| ''/.test(src));
  assert.match(src, /user\.email, toIdentity\(user\.phone\) \|\| null,/);
});

test('no write to subscribers, leads or users can store a blank phone', () => {
  // All three tables carry UNIQUE (tenant_id, phone), and on production
  // subscribers and leads each already hold one row with phone ''. So any
  // write that turns "no phone" into '' fails — or, under INSERT IGNORE,
  // silently drops the row.
  const pins = [
    ['api/lib/sheets.js', "normPhone||phone||null, source||'Facebook Lead Ads'"],
    ['api/routes/gsheets.js', "identity || phone || null"],
    ['api/routes/registrations.js', "user.email, toIdentity(user.phone) || null, branch"],
  ];
  const root = path.join(__dirname, '..', '..');
  for (const [rel, needle] of pins) {
    assert.ok(fs.readFileSync(path.join(root, rel), 'utf8').includes(needle), `${rel} lost: ${needle}`);
  }
  // The manual Sheets import needs its own dedupe for phoneless rows now.
  assert.match(fs.readFileSync(path.join(root, 'api/routes/gsheets.js'), 'utf8'),
    /if \(!phone && name\) \{[\s\S]{0,300}?LOWER\(TRIM\(name\)\)=LOWER\(\?\)/);
});
