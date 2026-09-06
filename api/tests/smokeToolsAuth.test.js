'use strict';
// Sign-in returns an httpOnly cookie, and the response body carries {ok, user}
// with no token in it. Four of the project's own suites read a token out of
// that body, so each one died at its first login — reporting "No token
// returned", which reads like a broken account rather than a broken suite.
//
// uat-full-smoke was repaired earlier; the other three were still dead, and
// nothing noticed because a suite that cannot start also cannot fail loudly.
// This asserts every one of them can still find a token when the body has none.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TOOLS = path.join(__dirname, '..', 'tools');
const read = name => fs.readFileSync(path.join(TOOLS, name), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// Every suite that signs in. Adding one here is cheaper than discovering months
// later that it has been dead since the day auth changed.
const SUITES = [
  'uat-full-smoke.cjs',
  'finance-operations-smoke.cjs',
  'customer-auth-geo-smoke.cjs',
  'load-smoke.cjs',
];

for (const suite of SUITES) {
  test(`${suite} reads the token from the cookie`, () => {
    const code = codeOnly(read(suite));
    assert.match(code, /set-cookie/, `${suite} never looks at the cookie`);
    assert.match(code, /authToken=\(\[\^;\]\+\)/, `${suite} does not extract authToken`);
  });

  test(`${suite} falls back to the cookie when the body has no token`, () => {
    const code = codeOnly(read(suite));
    // Scanning for every bare `.token` cannot work: a payment-link token and an
    // auth token are spelled the same, and a helper that has already merged the
    // cookie hands back an object whose .token is correct. What distinguishes a
    // repaired suite is the fallback itself.
    assert.match(
      code,
      /\.token \|\| (?:\w+\.)?authToken|authToken \|\| (?:\w+\.)?\.?token|\|\| lastAuthToken/,
      `${suite} extracts the cookie but never falls back to it`
    );
  });
}

test('the tools agree on how the token is named', () => {
  // One spelling, so a future change to the cookie name is one search.
  for (const suite of SUITES) {
    assert.match(codeOnly(read(suite)), /authToken/, `${suite} uses a different name`);
  }
});
