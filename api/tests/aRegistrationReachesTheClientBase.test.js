'use strict';

// Somebody who signs up is in the client base.
//
// Registration wrote a login row and nothing else: the person appeared under
// «التسجيلات» and nowhere the desk works. Measured on production, 238 of 1,764
// login accounts were in neither the client database nor the leads and were not
// staff — people who had signed up that same day among them. The owner's rule
// is the other way round: «اي عميل جديد بيسجل دخول ... محتاجك تحول كل العملاء
// من حسابات الدخول الى قاعده العملاء وتخلي دا الطبيعي عشان اقدر احوله لعميل
// حقيقي بعد الحجز والدفع».
//
// So a signup becomes a lead — a potential client, which is exactly what it is
// until they book and pay — through the same routine «التسجيلات» uses when a
// person converts one by hand: the shared contact matcher first, so the
// campaign that already found them is not written down twice.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('one routine creates the lead, and both callers use it', () => {
  const lib = read('api/lib/registrationLead.js');
  assert.ok(lib.includes('findLeadByContact'), 'the shared matcher is what keeps one person one record');
  assert.ok(lib.includes('getNextClientCode'), 'a lead without a client code is not a record the desk can use');
  assert.ok(lib.includes('INSERT INTO leads') && lib.includes('source'), 'the insert has to name the source column');
  assert.ok(lib.includes("'تسجيل دخول'"), 'where the lead came from has to survive — it is how the desk reads the list');

  const auth = read('api/routes/auth.js');
  assert.ok(auth.includes("require('../lib/registrationLead')"), 'signing up must reach the client base');
  const registrations = read('api/routes/registrations.js');
  assert.ok(registrations.includes("require('../lib/registrationLead')"),
    'converting by hand and converting on signup must be the same routine, or they will drift');
});

test('the signup does not fail over the lead', () => {
  // The account is the thing being created. A lead that cannot be written —
  // a duplicate, a branch that resolves to nothing — must not take the signup
  // down with it, or a customer cannot register at all.
  const auth = read('api/routes/auth.js');
  const callAt = auth.indexOf('await ensureLeadForUser(');
  assert.ok(callAt > 0, 'the signup does not create the lead at all');
  const around = auth.slice(callAt - 200, callAt + 400);
  assert.ok(/try\s*\{/.test(around) && /catch/.test(around), 'the lead is best-effort beside the account');
});

test('an existing person is not written down twice', () => {
  const lib = read('api/lib/registrationLead.js');
  const body = lib.slice(lib.indexOf('async function ensureLeadForUser'));
  const matchAt = body.indexOf('findLeadByContact');
  const insertAt = body.indexOf('INSERT INTO leads');
  assert.ok(matchAt > 0 && insertAt > matchAt, 'the match has to happen before the insert');
  assert.ok(/subscribers/.test(body.slice(0, insertAt)),
    'somebody who is already a client is not a new lead either');
});
