'use strict';

// 12 Nov 2026: the owner's new Gemini key, made in AI Studio, begins «AQ.» like a Vertex key — the prefix no longer says which of Google's two
// addresses a key opens. An «AQ.» key is tried at the Vertex address and, when that one refuses the key, at the AI Studio address.
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateAdminAi } = require('../lib/adminAi');

const config = key => ({ provider: 'gemini', apiKey: key, model: 'gemini-2.5-flash' });
const ask = { messages: [{ role: 'user', content: 'مرحبا' }] };
const ok = text => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const refuse = (status, message) => new Response(JSON.stringify({ error: { message } }), { status });

test('an «AQ.» key the Vertex address refuses is answered by the AI Studio address, and that address is remembered', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url).split('?')[0]);
    return String(url).includes('aiplatform.googleapis.com') ? refuse(403, 'Agent Platform API has not been used in project 1 before or it is disabled.') : ok('أهلاً');
  };
  assert.equal(await generateAdminAi(config('AQ.key-studio-kind-0001'), ask, fetchImpl), 'أهلاً');
  assert.ok(calls[0].includes('aiplatform.googleapis.com'));
  assert.ok(calls[1].includes('generativelanguage.googleapis.com'));
  calls.length = 0;
  assert.equal(await generateAdminAi(config('AQ.key-studio-kind-0001'), ask, fetchImpl), 'أهلاً');
  assert.equal(calls.length, 1, 'the second request goes straight to the address that answered');
  assert.ok(calls[0].includes('generativelanguage.googleapis.com'));
});

test('an «AQ.» key the Vertex address accepts never touches the other address', async () => {
  const calls = [];
  const fetchImpl = async url => { calls.push(String(url)); return ok('تمام'); };
  assert.equal(await generateAdminAi(config('AQ.key-vertex-kind-0002'), ask, fetchImpl), 'تمام');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('aiplatform.googleapis.com'));
});

test('a key both addresses refuse fails with the first address\'s reason, the one that names what to switch on', async () => {
  const fetchImpl = async url => (String(url).includes('aiplatform.googleapis.com')
    ? refuse(403, 'Agent Platform API has not been used in project 1 before or it is disabled.')
    : refuse(403, 'API key not valid.'));
  await assert.rejects(() => generateAdminAi(config('AQ.key-refused-both-0003'), ask, fetchImpl),
    error => error.providerStatus === 403 && /Agent Platform API/.test(error.providerMessage));
});

test('an exhausted quota is not retried at the other address, and an «AIza» key only ever goes to AI Studio', async () => {
  const calls = [];
  const quota = async url => { calls.push(String(url)); return refuse(429, 'Quota exceeded'); };
  await assert.rejects(() => generateAdminAi(config('AQ.key-quota-0004'), ask, quota), error => error.providerStatus === 429);
  assert.equal(calls.length, 1);
  calls.length = 0;
  const studio = async url => { calls.push(String(url)); return ok('أهلاً'); };
  await generateAdminAi(config('AIzaSy-key-0005-abcdefghijklmnop'), ask, studio);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('generativelanguage.googleapis.com'));
});
