'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateAdminAi, normalizeRequest, sanitizeProviderText } = require('../lib/adminAi');

test('admin AI proxy rejects missing, unknown and malformed provider configuration', () => {
  assert.throws(() => normalizeRequest({}, { messages: [{ role: 'user', content: 'hello' }] }), /not configured/);
  assert.throws(
    () => normalizeRequest({ provider: 'custom', apiKey: 'secret', model: 'model' }, { messages: [{ role: 'user', content: 'hello' }] }),
    /not configured/,
  );
  assert.throws(
    () => normalizeRequest({ provider: 'openai', apiKey: 'secret', model: 'bad/model' }, { messages: [{ role: 'user', content: 'hello' }] }),
    /not configured/,
  );
});

test('admin AI proxy keeps Claude credentials server-side and uses the correct provider header', async () => {
  let request;
  const text = await generateAdminAi(
    { provider: 'claude', apiKey: 'server-only-secret', model: 'claude-3-5-haiku-20241022' },
    { messages: [{ role: 'user', content: 'hello' }] },
    async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ content: [{ text: 'answer' }] }) };
    },
  );
  assert.equal(text, 'answer');
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.options.headers['x-api-key'], 'server-only-secret');
  assert.equal(request.options.headers.Authorization, undefined);
});

test('admin AI proxy bounds messages and output tokens before provider calls', () => {
  const request = normalizeRequest(
    { provider: 'openai', apiKey: 'secret', model: 'gpt-4o-mini', maxTokens: 99_999 },
    { messages: Array.from({ length: 30 }, (_, index) => ({ role: 'user', content: `message-${index}` })) },
  );
  assert.equal(request.messages.length, 20);
  assert.equal(request.messages[0].content, 'message-10');
  assert.equal(request.maxTokens, 8_000);
});

test('admin AI proxy removes direct identifiers and secrets before provider calls', () => {
  const source = 'اتصل على +20 101 234 5678 أو user@example.com Bearer abc.def.ghi sk-ant-abcdefghijklmnop';
  const sanitized = sanitizeProviderText(source, 12_000);
  assert.doesNotMatch(sanitized, /101 234 5678|user@example\.com|sk-ant-abcdefghijklmnop/);
  assert.match(sanitized, /\[PHONE_OR_ID\]|\[EMAIL\]|\[API_KEY\]/);
});

test('Gemini receives system instructions separately from conversation turns', async () => {
  let request;
  await generateAdminAi(
    { provider: 'gemini', apiKey: 'server-only-secret', model: 'gemini-2.0-flash-lite' },
    { systemPrompt: 'aggregate context', messages: [{ role: 'user', content: 'hello' }] },
    async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'answer' }] } }] }) };
    },
  );
  assert.equal(request.systemInstruction.parts[0].text, 'aggregate context');
  assert.equal(request.contents.length, 1);
  assert.equal(request.contents[0].role, 'user');
});
