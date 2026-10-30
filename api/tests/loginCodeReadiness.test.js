'use strict';

/**
 * 30 Oct 2026: the emailed login code must not go live while an account the policy names has no address it can reach.
 * tools/login-code-readiness.cjs lists them; the classification is the part that decides what the owner is told to fix.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { classifyLoginEmail } = require('../lib/loginEmailReadiness');

test('an address that cannot receive the code is named, and a real-looking one is left for the owner to confirm', () => {
  assert.equal(classifyLoginEmail('').status, 'missing');
  assert.equal(classifyLoginEmail(null).status, 'missing');
  assert.equal(classifyLoginEmail('  ').status, 'missing');
  assert.equal(classifyLoginEmail('not-an-email').status, 'invalid');
  assert.equal(classifyLoginEmail('a@b').status, 'invalid');
  assert.equal(classifyLoginEmail('staff@example.com').status, 'placeholder');
  assert.equal(classifyLoginEmail('staff@mahad.local').status, 'placeholder');
  assert.equal(classifyLoginEmail('staff@something.invalid').status, 'placeholder');
  assert.equal(classifyLoginEmail('01012345678@gmail.com').status, 'phone_like');
  assert.equal(classifyLoginEmail('+201012345678@mahadnafsy.com').status, 'phone_like');
  assert.equal(classifyLoginEmail('ahmed@mahadnafsy.com').status, 'check');
  assert.equal(classifyLoginEmail(' Ahmed@Gmail.com ').status, 'check');
});

test('two accounts on one address are flagged, since the code of one would reach the other', () => {
  const result = classifyLoginEmail('desk@mahadnafsy.com', { sharedWith: ['ريسبشن الدقي'] });
  assert.equal(result.status, 'shared');
  assert.match(result.reason, /ريسبشن الدقي/);
  assert.equal(classifyLoginEmail('', { sharedWith: ['x'] }).status, 'missing', 'no address outranks sharing one');
});

test('the tool reads the policy the way the server stores it and is read-only', () => {
  const tool = fs.readFileSync(path.join(__dirname, '..', 'tools', 'login-code-readiness.cjs'), 'utf8');
  assert.match(tool, /FROM tenant_settings WHERE tenant_id=\? AND section='security_mfa_policy'/);
  assert.match(tool, /SET SESSION TRANSACTION READ ONLY/);
  assert.doesNotMatch(tool, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.match(tool, /--send-test/);
});
