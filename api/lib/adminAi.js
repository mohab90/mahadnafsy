'use strict';

const PROVIDERS = new Set(['gemini', 'openai', 'claude']);
const cleanText = (value, max) => String(value || '').trim().slice(0, max);

function sanitizeProviderText(value, max) {
  return cleanText(value, max)
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, '[EMAIL]')
    .replace(/\bBearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-(?:ant-)?|AIza)[a-z0-9_-]{12,}\b/gi, '[API_KEY]')
    .replace(/\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/gi, '[TOKEN]')
    .replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, match => (
      match.replace(/\D/g, '').length >= 10 ? '[PHONE_OR_ID]' : match
    ));
}

function normalizeRequest(config, payload) {
  const provider = cleanText(config?.provider, 20).toLowerCase();
  const apiKey = cleanText(config?.apiKey, 500);
  const model = cleanText(config?.model, 120);
  if (!PROVIDERS.has(provider) || !apiKey || !/^[a-z0-9._:-]{1,120}$/i.test(model)) {
    throw Object.assign(new Error('AI provider is not configured'), { status: 409 });
  }
  const messages = (Array.isArray(payload?.messages) ? payload.messages : [])
    .slice(-20)
    .map(item => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: sanitizeProviderText(item?.content ?? item?.text, 12_000),
    }))
    .filter(item => item.content);
  if (!messages.length) throw Object.assign(new Error('At least one message is required'), { status: 400 });
  return {
    provider, apiKey, model, messages,
    systemPrompt: sanitizeProviderText(payload?.systemPrompt || config?.systemPrompt, 60_000),
    temperature: Math.min(1.5, Math.max(0, Number(config?.temperature) || 0.7)),
    maxTokens: Math.min(8_000, Math.max(100, Number(payload?.maxTokens || config?.maxTokens) || 1_500)),
  };
}

async function providerJson(url, options, fetchImpl) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw Object.assign(new Error(`AI provider request failed (${response.status})`), { status: 502 });
  return response.json();
}

async function generateAdminAi(config, payload, fetchImpl = fetch) {
  const request = normalizeRequest(config, payload);
  if (request.provider === 'gemini') {
    const contents = request.messages.map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
    const data = await providerJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(request.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(request.systemPrompt ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } } : {}),
          contents,
          generationConfig: { temperature: request.temperature, maxOutputTokens: request.maxTokens },
        }),
      },
      fetchImpl,
    );
    return cleanText(data?.candidates?.[0]?.content?.parts?.[0]?.text, 100_000);
  }
  if (request.provider === 'claude') {
    const data = await providerJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': request.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: request.model, system: request.systemPrompt || undefined,
        messages: request.messages, temperature: request.temperature, max_tokens: request.maxTokens,
      }),
    }, fetchImpl);
    return cleanText(data?.content?.[0]?.text, 100_000);
  }
  const data = await providerJson('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.apiKey}` },
    body: JSON.stringify({
      model: request.model,
      messages: [...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []), ...request.messages],
      temperature: request.temperature, max_tokens: request.maxTokens,
    }),
  }, fetchImpl);
  return cleanText(data?.choices?.[0]?.message?.content, 100_000);
}

module.exports = { generateAdminAi, normalizeRequest, sanitizeProviderText };
