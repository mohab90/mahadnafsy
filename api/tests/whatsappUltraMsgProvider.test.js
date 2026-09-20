'use strict';

// The provider the institute's WhatsApp number actually sits on.
//
// OTP over WhatsApp had never worked, and the reason was not the code that
// sends it: nothing was configured at all — no Meta token, no Green API
// instance, in neither the environment nor the settings. The owner's account
// turned out to be UltraMsg (an instance named «instance5000»), which this
// module did not speak: it knows Meta and Green API only, so a token that is
// perfectly valid reached no sender.
//
// Probed against the provider with the owner's own credentials, the account
// answers: «Your instance has been Stopped due to non-payment» — which is what
// proves the address and the token are right and the subscription is not.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'lib', 'whatsapp.js'), 'utf8');

test('UltraMsg is one of the providers a send can go through', () => {
  assert.ok(SOURCE.includes('_sendUltraMsg'), 'no UltraMsg sender');
  assert.ok(SOURCE.includes('api.ultramsg.com'), 'the sender must call the provider');
  assert.match(SOURCE, /messages\/chat/, 'UltraMsg sends text through messages/chat');
});

test('it is chosen when its credentials are the ones present', () => {
  const resolver = SOURCE.slice(SOURCE.indexOf('function resolveProvider'), SOURCE.indexOf('\n}', SOURCE.indexOf('function resolveProvider')));
  assert.match(resolver, /'ultramsg'/, 'an explicit provider setting must be honoured');
  assert.match(resolver, /ultraInstanceId|ultraToken/, 'and inferred from the credentials when nothing says');
});

test('the credentials come from the settings first, then the environment', () => {
  const sender = SOURCE.slice(SOURCE.indexOf('async function _sendUltraMsg'), SOURCE.indexOf('\n}', SOURCE.indexOf('async function _sendUltraMsg')));
  assert.match(sender, /cfg\.ultraInstanceId \|\| process\.env\.ULTRAMSG_INSTANCE_ID/);
  assert.match(sender, /cfg\.ultraToken \|\| envSecret\('ULTRAMSG_TOKEN'\)/);
  assert.match(sender, /not_configured/, 'an unconfigured provider must say so rather than throw');
});

test('a stopped subscription is reported, not swallowed', () => {
  // The provider answers 404 with a JSON body explaining why. A send that
  // returns ok on a 404 would leave OTP silently unsent, which is the failure
  // this whole file exists to end.
  const sender = SOURCE.slice(SOURCE.indexOf('async function _sendUltraMsg'), SOURCE.indexOf('\n}', SOURCE.indexOf('async function _sendUltraMsg')));
  assert.match(sender, /if \(!res\.ok[\s\S]{0,120}return \{ ok: false/, 'a provider error must come back as a failure');
  assert.match(sender, /data\?\.error|data\.error/, 'the provider says why — keep it');
});
