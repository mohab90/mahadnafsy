'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auth = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
const slice = (from, to) => auth.slice(auth.indexOf(from), auth.indexOf(to));
const forgot = slice("router.post('/api/auth/forgot-password'", "router.post('/api/auth/verify-otp'");
const verify = slice("router.post('/api/auth/verify-otp'", "router.post('/api/auth/reset-password'");

test('a subscriber with no login can start a reset with their WhatsApp number', () => {
  // The email branch has always auto-created a users row for an admin-added
  // client. The phone branch did not, so a paying customer who typed their
  // number got the silent anti-enumeration "ok" and no code ever arrived —
  // "just use forgot password" was impossible for them.
  assert.match(forgot, /FROM subscribers[\s\S]{0,200}WHERE tenant_id=\? AND phone = \?/);
  assert.match(forgot, /INSERT IGNORE INTO users[\s\S]{0,240}phone, password_hash/);
  assert.match(forgot, /auto-created users record for subscriber by phone/);
  // The new row must be unusable except through the code that follows.
  assert.match(forgot, /const tempHash = await bcrypt\.hash\(uuidv4\(\) \+ Date\.now\(\), 10\)[\s\S]{0,600}phoneIdentity, tempHash/);
});

test('OTP rows are keyed by account id, never by a possibly-NULL email', () => {
  // `email = NULL` matches no row in SQL. Keying the lookup on email meant an
  // account with no email — phone-only registration, or a subscriber claimed by
  // number — received its code over WhatsApp and then hit "الرمز غير صحيح" on
  // every attempt, permanently.
  assert.match(verify, /WHERE tenant_id=\? AND user_id=\? AND code=\?/);
  assert.doesNotMatch(verify, /WHERE tenant_id=\? AND email=\? AND code=\?/);
  assert.match(verify, /\[req\.tenantId, account\.id, hashOtp\(/);
  // Superseding older codes has to key the same way, or stale codes survive.
  assert.match(forgot, /UPDATE otp_codes SET used=1 WHERE tenant_id=\? AND user_id=\?/);
  // The hash still covers the email value, so codes already sent stay valid.
  assert.match(verify, /hashOtp\(\{\s*tenantId: req\.tenantId, email: safeEmail, type, code,/);
});

test('an unresolvable identifier still fails identically to a wrong code', () => {
  // Anti-enumeration: a number with no account must not be distinguishable from
  // a real number with the wrong code.
  assert.match(verify, /account = byPhone \|\| \{ id: null, email: `unresolved:\$\{phoneIdentity\}` \}/);
  assert.match(verify, /الرمز غير صحيح أو منتهي الصلاحية/);
  // account.id === null cannot match any row, so the query returns nothing and
  // falls into that same rejection.
  assert.match(verify, /if \(!row\)/);
});
