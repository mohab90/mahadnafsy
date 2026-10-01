'use strict';

// A customer with a number and no email can buy.
//
// Signup has asked for a WhatsApp number alone since sign-in moved to it, and
// the clients imported from the sheets have no email either. Every step of the
// purchase asked for one: the order («Authenticated customer required», 401),
// the payment intent before a transfer receipt («authenticated email required»),
// and the card capture (ensureSubscriberForOrder threw). The log of 1 Oct 2026
// showed it: from 8 Sep, 19 orders attempted on the site and 19 refused; the
// orders table's last row was 6 Sep.
//
// The route handlers are run here against a scripted database, so a slip in
// them — an undefined name, a wrong parameter — fails the test, not a customer.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-purchase-secret-0123456789-abcdefghijklmnop';
const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

// One scripted database for everything these routes load.
const db = {
  calls: [],
  script: [],
  async query(sql, params = []) {
    const flat = String(sql).replace(/\s+/g, ' ').trim();
    db.calls.push({ sql: flat, params });
    for (const [pattern, answer] of db.script) {
      if (pattern.test(flat)) return typeof answer === 'function' ? answer(params, flat) : answer;
    }
    return /^(INSERT|UPDATE|DELETE)/i.test(flat) ? [{ affectedRows: 1 }] : [[]];
  },
  reset(script) { db.calls = []; db.script = script; },
  find(pattern) { return db.calls.find(call => pattern.test(call.sql)); },
  all(pattern) { return db.calls.filter(call => pattern.test(call.sql)); },
};
const conn = {
  query: (...args) => db.query(...args),
  execute: (...args) => db.query(...args),
  async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query: (...args) => db.query(...args), execute: (...args) => db.query(...args), getConnection: async () => conn },
  cached: async (_key, _ttl, fn) => fn(), cacheInvalidate() {},
  dbQuery: (...args) => db.query(...args), dbExecute: (...args) => db.query(...args),
  getStaffIdByEmail: async () => null, requireDb: (_req, _res, next) => next(), isDbDown: () => false,
});
stub('../lib/clientContext', {
  ...require('../lib/clientContext'),
  resolveClientContext: async () => ({ locationResolved: true, branch: 'ONLINE_EGYPT', currency: 'EGP', country: 'EG' }),
});

const { ensureSubscriberForOrder } = require('../lib/subscriberProvisioning');
const { amountDueNow } = require('../lib/enrollmentPricing');
const checkoutRouter = require('../routes/lead-capture-crm');
const intentsRouter = require('../routes/payment-intents');

const handlerOf = (router, method, route) => {
  const layer = router.stack.find(item => item.route && item.route.path === route && item.route.methods[method]);
  assert.ok(layer, `${method} ${route} is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};
async function call(handler, { body = {}, user }) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  const req = { body, user, tenantId: 'tenant-default', headers: {}, query: {}, params: {}, ip: '127.0.0.1', get: () => undefined };
  await handler(req, res);
  return res;
}

const NO_ROW = [[undefined]];
const course = { id: 'c1', title: 'Mental health', title_ar: 'الصحة النفسية', price_egp: 3000, price_sar: 300, price_usd: 80 };
// What a database holding this account and nothing else answers.
const freshAccount = (phone = '01012345678') => [
  [/FROM subscribers s WHERE s\.tenant_id=\? AND s\.firebase_uid=\?/, NO_ROW],
  [/SELECT email, phone FROM users WHERE id=\?/, [[{ email: null, phone }]]],
  [/FROM subscribers s WHERE s\.tenant_id=\? AND s\.phone IN/, NO_ROW],
  [/SELECT phone FROM users WHERE id=\? AND tenant_id=\? AND is_active=1/, [[{ phone }]]],
  [/FROM courses WHERE id=\?/, [[course]]],
  [/SELECT GET_LOCK/, [[{ acquired: 1 }]]],
  [/FROM subscribers WHERE tenant_id=\? AND firebase_uid=\? LIMIT 1 FOR UPDATE/, NO_ROW],
  [/FROM subscribers WHERE tenant_id=\? AND phone IN/, NO_ROW],
  [/SELECT id, status FROM leads/, NO_ROW],
  [/SELECT id, client_code FROM subscribers WHERE tenant_id=\? AND phone=\?/, NO_ROW],
  [/SELECT next_value FROM client_code_counter/, [[{ next_value: 5001 }]]],
  [/SELECT id FROM orders/, NO_ROW],
];

test('an account with a number and no email places an order, and its client record is opened with it', async () => {
  db.reset(freshAccount());
  const res = await call(handlerOf(checkoutRouter, 'post', '/api/public/checkout-intent'), {
    user: { uid: 'user-1', email: null },
    body: { itemId: 'c1', itemType: 'course', itemTitle: 'x', customerName: 'منى أحمد', customerEmail: '', customerPhone: '' },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.amount, amountDueNow(3000, 'cash'), 'the catalogue price at the cash rate, not a figure from the browser');

  const client = db.find(/^INSERT INTO subscribers/);
  assert.ok(client, 'a client record is opened');
  const [newId, firebaseUid, , , name, email, phone] = client.params;
  assert.equal(firebaseUid, 'user-1', 'tied to the account, so the next request finds it');
  assert.equal(name, 'منى أحمد');
  assert.equal(email, null, 'NULL, not a blank that would collide with the next one');
  assert.equal(phone, '1012345678', 'the account\'s own number, in its identity form');

  const order = db.find(/^INSERT INTO orders/);
  assert.equal(order.params[0], res.body.orderId);
  assert.equal(order.params[1], newId, 'the order names its client — the receipt and the card capture find the customer through it');
  assert.equal(order.params[8], null, 'no email on the order');
  assert.equal(order.params[9], '01012345678', 'the number the institute can reach');
  // No lookup on a blank email, which every email-less client and lead shares.
  for (const { sql, params } of db.calls) {
    if (/LOWER\(TRIM\((?:s\.)?(?:customer_)?email\)\)=\?/.test(sql)) assert.ok(!params.includes(''), `blank email looked up: ${sql.slice(0, 90)}`);
  }
});

test('an email typed on the form is contact detail: the record stays without one', async () => {
  db.reset(freshAccount());
  const res = await call(handlerOf(checkoutRouter, 'post', '/api/public/checkout-intent'), {
    user: { uid: 'user-1', email: null },
    body: { itemId: 'c1', itemType: 'course', customerName: 'منى', customerEmail: 'Someone@Example.com', customerPhone: '01098765432' },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(db.find(/^INSERT INTO subscribers/).params[5], null, 'an unverified address is not made the client\'s identity');
  const order = db.find(/^INSERT INTO orders/);
  assert.equal(order.params[8], 'someone@example.com');
  assert.equal(order.params[9], '01098765432', 'the number typed for this order');
  assert.ok(order.params[1], 'and the order still names its client');
});

test('an account with neither an email nor a number is still turned away', async () => {
  db.reset([
    [/FROM subscribers s WHERE/, NO_ROW],
    [/SELECT email, phone FROM users WHERE id=\?/, [[{ email: null, phone: null }]]],
    [/SELECT phone FROM users WHERE id=\? AND tenant_id=\? AND is_active=1/, [[{ phone: null }]]],
  ]);
  const res = await call(handlerOf(checkoutRouter, 'post', '/api/public/checkout-intent'), {
    user: { uid: 'user-9', email: null }, body: { itemId: 'c1', itemType: 'course', customerName: 'x' },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(db.find(/^INSERT INTO orders/), undefined);
});

test('the transfer receipt step takes the customer by their client record, not their email', async () => {
  const order = { id: 'order-1', amount: 3000, currency: 'EGP', status: 'pending', customer_name: 'منى', customer_phone: '01012345678', customer_email: null, subscriber_id: 'sub-1', tenant_id: 'tenant-default', branch_id: 'branch-online-egypt' };
  db.reset([
    [/FROM subscribers s WHERE s\.tenant_id=\? AND s\.firebase_uid=\?/, [[{ id: 'sub-1', email: null }]]],
    [/FROM orders WHERE id=\? AND tenant_id=\? AND \(subscriber_id=\?\) LIMIT 1 FOR UPDATE/, [[order]]],
    [/FROM subscribers WHERE id=\? AND tenant_id=\? AND deleted_at IS NULL LIMIT 1 FOR UPDATE/, [[{ id: 'sub-1', lead_id: null, branch: 'ONLINE_EGYPT', branch_id: 'branch-online-egypt', tenant_id: 'tenant-default' }]]],
    [/FROM payment_intents/, NO_ROW],
  ]);
  const res = await call(handlerOf(intentsRouter, 'post', '/api/me/payment-intents'), {
    user: { uid: 'user-1', email: null }, body: { order_id: 'order-1', provider: 'manual' },
  });
  assert.notEqual(res.statusCode, 400, JSON.stringify(res.body));
  const lookup = db.find(/FROM orders WHERE id=\? AND tenant_id=\?/);
  assert.deepEqual(lookup.params, ['order-1', 'tenant-default', 'sub-1'], 'owned by the client link alone');
  assert.equal(db.find(/^INSERT INTO subscribers/), undefined, 'the client already exists');
});

test('someone else\'s order is not found', async () => {
  db.reset([
    [/FROM subscribers s WHERE s\.tenant_id=\? AND s\.firebase_uid=\?/, [[{ id: 'sub-2', email: null }]]],
    [/FROM orders WHERE id=\? AND tenant_id=\?/, NO_ROW],
  ]);
  const res = await call(handlerOf(intentsRouter, 'post', '/api/me/payment-intents'), {
    user: { uid: 'user-2', email: null }, body: { order_id: 'order-1', provider: 'manual' },
  });
  assert.equal(res.statusCode, 404);
});

// ── The shared step ─────────────────────────────────────────────────────────

const provisioning = extra => {
  db.reset([[/SELECT next_value FROM client_code_counter/, [[{ next_value: 5001 }]]], ...extra]);
  return conn;
};

test('the client an order names is the customer, email or no email', async () => {
  const c = provisioning([[/FROM subscribers WHERE id=\? AND tenant_id=\? AND deleted_at IS NULL/, [[{ id: 'sub-7', tenant_id: 't1' }]]]]);
  const sub = await ensureSubscriberForOrder(c, { tenantId: 't1', subscriberId: 'sub-7', email: null, name: 'x', phone: '' });
  assert.equal(sub.id, 'sub-7');
  assert.equal(db.find(/^INSERT INTO subscribers/), undefined);
});

test('with no email the number is the identity: the client who holds it is the customer', async () => {
  const c = provisioning([
    [/FROM subscribers WHERE tenant_id=\? AND firebase_uid=\? LIMIT 1 FOR UPDATE/, NO_ROW],
    [/FROM subscribers WHERE tenant_id=\? AND phone IN/, [[{ id: 'sub-sheet', tenant_id: 't1' }]]],
  ]);
  const sub = await ensureSubscriberForOrder(c, { tenantId: 't1', uid: 'user-3', email: '', name: 'x', phone: '01012345678' });
  assert.equal(sub.id, 'sub-sheet', 'the client imported from the sheet, not a second record');
  const spellings = db.find(/phone IN/).params;
  assert.ok(spellings.includes('01012345678') && spellings.includes('1012345678'), 'every spelling a number is stored in');
  assert.deepEqual(db.find(/UPDATE subscribers SET firebase_uid=COALESCE/).params, ['user-3', 'sub-sheet', 't1']);
  assert.equal(db.find(/^INSERT INTO subscribers/), undefined);
});

test('with an email the number still belongs to whoever holds it, and nothing is matched on a blank email', async () => {
  const c = provisioning([
    [/firebase_uid=\? OR LOWER\(TRIM\(email\)\)=\?/, NO_ROW],
    [/FROM leads WHERE tenant_id=\? AND LOWER\(TRIM\(email\)\)=\?/, NO_ROW],
    [/SELECT id, client_code FROM subscribers WHERE tenant_id=\? AND phone=\?/, [[{ id: 'sub-old', client_code: 'C77' }]]],
  ]);
  await ensureSubscriberForOrder(c, { tenantId: 't1', email: 'payer@example.com', name: 'Payer', phone: '01012345678' });
  assert.equal(db.find(/phone IN/), undefined, 'an email account is not merged into the number\'s holder');
  assert.equal(db.find(/^INSERT INTO subscribers/).params[6], null);
});

test('no identity at all is refused', async () => {
  await assert.rejects(() => ensureSubscriberForOrder(provisioning([]), { tenantId: 't1', email: '', name: 'x', phone: '' }), /requires an identity/);
});

test('the receipt and the card capture pass the client on', () => {
  const proofs = read('api/routes/payment-proofs.js');
  assert.match(proofs, /tenantId, uid, subscriberId: identity\?\.id \|\| null, email: ownerEmail,/);
  const capture = read('api/routes/public-orders.js');
  assert.match(capture, /sub = await ensureSubscriberForOrder\(conn, \{\s+tenantId,\s+subscriberId: order\.subscriber_id \|\| null,\s+email: order\.customer_email,/);
});

test('an account with no client record yet is not answered with an error on every sign-in', () => {
  assert.match(read('api/routes/public.js'), /if \(!sub\) return res\.json\(\[\]\);/);
  const config = read('api/routes/config.js');
  assert.ok(config.includes('if (!subscriber) return `user:${uid}`;'));
  assert.doesNotMatch(config, /new Error\('Subscriber account not found'\)/);
});
