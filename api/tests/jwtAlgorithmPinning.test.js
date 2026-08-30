'use strict';
// The algorithm a token is verified with must be named, not taken from the
// token's own header.
//
// jsonwebtoken refuses `alg: none` when a secret is supplied, and a probe
// against production confirms it, so nothing was open. It opens the day a key
// pair is introduced for anything: a token signed HS256 using that public key
// as its secret verifies as though it were RS256. Naming HS256 costs nothing
// and does not depend on a library default staying put.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'middleware/auth.js',
  'middleware/tenantContext.js',
  'lib/pendingTokenIdentity.js',
  'routes/auth.js',
];

test('every jwt.verify names the algorithm it accepts', () => {
  const unpinned = [];
  for (const rel of FILES) {
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const line of source.split('\n')) {
      if (!line.includes('jwt.verify(')) continue;
      if (/algorithms|JWT_VERIFY_OPTIONS/.test(line)) continue;
      unpinned.push(`${rel}: ${line.trim().slice(0, 80)}`);
    }
  }
  assert.deepEqual(unpinned, [], 'these accept whatever the token header claims');
});

test('the signer names the algorithm too', () => {
  const source = fs.readFileSync(path.join(ROOT, 'lib/token.js'), 'utf8');
  assert.match(source, /algorithm: 'HS256'/,
    'leaving it to the default means the verify side has nothing to pin to');
});

test('a token signed with a different algorithm is refused', () => {
  // The property itself, not the source: this is what the option buys.
  const secret = 'x'.repeat(32);
  const good = jwt.sign({ uid: 'u1' }, secret, { algorithm: 'HS256' });
  assert.equal(jwt.verify(good, secret, { algorithms: ['HS256'] }).uid, 'u1');

  const wrong = jwt.sign({ uid: 'u1' }, secret, { algorithm: 'HS512' });
  assert.throws(
    () => jwt.verify(wrong, secret, { algorithms: ['HS256'] }),
    /invalid algorithm/i,
    'a token the pin does not name must not verify',
  );
});

test('an unsigned token is refused', () => {
  const secret = 'x'.repeat(32);
  const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.`
    + `${Buffer.from(JSON.stringify({ uid: 'u1' })).toString('base64url')}.`;
  assert.throws(() => jwt.verify(none, secret, { algorithms: ['HS256'] }));
});
