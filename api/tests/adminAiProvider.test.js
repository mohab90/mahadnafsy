'use strict';

// «نشغل المساعد الذكي … مش عاوز يشتغل معايا». The key saved on production is a
// Vertex AI express key («AQ.…») and every request went to AI Studio's
// endpoint, which refuses it; the model saved was gemini-1.5-pro, which Google
// has retired; and the only error anyone saw was «AI provider request failed».

const test = require('node:test');
const assert = require('node:assert');
const { generateAdminAi, geminiEndpoint, resolveAiConfig } = require('../lib/adminAi');

const FAKE_VERTEX = 'AQ.fake-vertex-key-for-tests-000000000000000000000';
const FAKE_STUDIO = 'AIzaFakeStudioKeyForTests0000000000000';

function fakeProvider(answers) {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    const answer = answers(url);
    return {
      ok: answer.status === 200,
      status: answer.status,
      json: async () => answer.body,
    };
  };
  return { urls, fetchImpl };
}

test('each kind of Gemini key goes to the door that accepts it', () => {
  assert.match(geminiEndpoint(FAKE_VERTEX, 'gemini-2.5-flash'), /^https:\/\/aiplatform\.googleapis\.com\/v1\/publishers\/google\/models\/gemini-2\.5-flash:generateContent\?key=/);
  assert.match(geminiEndpoint(FAKE_STUDIO, 'gemini-2.5-flash'), /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent\?key=/);
});

test('a retired model is skipped, and a missing one falls through to a current one', async () => {
  const provider = fakeProvider(url => (url.includes('gemini-flash-latest')
    ? { status: 200, body: { candidates: [{ content: { parts: [{ text: 'الاتصال ' }, { text: 'شغال' }] } }] } }
    : { status: 404, body: { error: { message: 'model not found' } } }));
  const text = await generateAdminAi(
    { provider: 'gemini', apiKey: FAKE_VERTEX, model: 'gemini-1.5-pro' },
    { messages: [{ role: 'user', content: 'اختبار' }] },
    provider.fetchImpl,
  );
  assert.equal(text, 'الاتصال شغال', 'every part of the answer, not only the first');
  assert.ok(!provider.urls.some(url => url.includes('gemini-1.5-pro')), 'the retired model was asked');
  assert.ok(provider.urls[0].includes('gemini-2.5-flash'));
});

test('a refused key says why, and never repeats the key', async () => {
  const provider = fakeProvider(() => ({ status: 400, body: { error: { message: `API key not valid: ${FAKE_VERTEX}` } } }));
  await assert.rejects(
    generateAdminAi({ provider: 'gemini', apiKey: FAKE_VERTEX, model: 'gemini-2.5-flash' },
      { messages: [{ role: 'user', content: 'اختبار' }] }, provider.fetchImpl),
    error => {
      assert.equal(error.providerStatus, 400);
      assert.match(error.providerMessage, /API key not valid/);
      assert.ok(!error.message.includes(FAKE_VERTEX) && !error.providerMessage.includes(FAKE_VERTEX));
      return true;
    },
  );
  assert.equal(provider.urls.length, 1, 'a refused key is not retried under other model names');
});

test('one key runs every feature; the site assistant does not take the admin assistant\'s instructions', () => {
  const settings = { adminAiConfig: { provider: 'gemini', apiKey: FAKE_VERTEX, model: 'gemini-2.5-flash', systemPrompt: 'مساعد إداري' } };
  assert.equal(resolveAiConfig(settings, 'admin').systemPrompt, 'مساعد إداري');
  const agent = resolveAiConfig(settings, 'agent');
  assert.equal(agent.apiKey, FAKE_VERTEX);
  assert.equal(agent.systemPrompt, '');
  const own = { enabled: true, apiKey: FAKE_STUDIO, model: 'gemini-2.5-flash', provider: 'gemini' };
  assert.equal(resolveAiConfig({ ...settings, aiAgentConfig: own }, 'agent'), own);
  assert.equal(resolveAiConfig({}, 'agent'), null);
});
