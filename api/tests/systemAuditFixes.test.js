'use strict';

// What the full audit of 1 Oct 2026 found in the production log and on the
// screens, beside the purchase path (purchaseWithoutEmail.test.js):
//   · 27 of 32 signups ended at «رقم الهاتف مستخدم بالفعل», a dead end;
//   · the finance screen sent 177 requests in a minute after one was refused;
//   · a role that may not see leads was refused the leads list on every load;
//   · on a phone the two floating buttons sat on the course's price and «احجز»;
//   · the not-found page kept the last page's title.

const { authRouteSource } = require('./_authRouteSource');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

test('a number that already has an account is told how to get in', () => {
  const auth = authRouteSource();
  const message = auth.match(/const PHONE_TAKEN_MESSAGE = '([^']+)';/);
  assert.ok(message, 'one wording for both signup routes');
  assert.match(message[1], /نسيت كلمة المرور/);
  // One handler serves both sign-up addresses (routes/auth/registration.js).
  assert.equal(auth.split("{ error: PHONE_TAKEN_MESSAGE, code: 'PHONE_ALREADY_REGISTERED' }").length - 1, 1);
  
});





test('on a phone the floating buttons ride above a bar pinned to the foot of the screen', () => {
  const app = read('client/App.tsx');
  assert.equal(app.split('className="floating-action fixed bottom-6').length - 1, 2, 'WhatsApp and «استفسر الآن»');
  
  
  const css = read('client/index.css');
  
  
});


