'use strict';

const PROVIDERS = new Set(['gemini', 'openai', 'claude']);
const cleanText = (value, max) => String(value || '').trim().slice(0, max);

function sanitizeProviderText(value, max) {
  return cleanText(value, max)
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, '[EMAIL]')
    .replace(/\bBearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-(?:ant-)?|AIza)[a-z0-9_-]{12,}\b/gi, '[API_KEY]')
    .replace(/\bAQ\.[a-z0-9_.-]{20,}/gi, '[API_KEY]')
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

// What the provider said, without anything that could be the key. «AI provider
// request failed (400)» was all anyone ever saw, so a wrong kind of key, a
// retired model and an exhausted quota all looked the same.
function providerMessage(body, apiKey) {
  const raw = body?.error?.message || body?.error?.status || body?.message || '';
  let text = String(raw).slice(0, 300);
  if (apiKey) text = text.split(apiKey).join('[API_KEY]');
  return sanitizeProviderText(text, 300);
}

async function providerJson(url, options, fetchImpl, apiKey = '') {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = providerMessage(body, apiKey);
    throw Object.assign(new Error(`AI provider request failed (${response.status})${detail ? `: ${detail}` : ''}`), {
      status: 502, providerStatus: response.status, providerMessage: detail,
    });
  }
  return response.json();
}

// Google has two doors for Gemini. A key made in AI Studio («AIza…») opens
// generativelanguage.googleapis.com; a key made in a Google Cloud project for
// Vertex AI express mode («AQ.…») opens aiplatform.googleapis.com, and the
// other door refuses it. The institute's key is the second kind, so every
// request went to the door that refuses it.
function geminiEndpoint(apiKey, model) {
  const m = encodeURIComponent(model);
  const k = encodeURIComponent(apiKey);
  return String(apiKey).startsWith('AQ.')
    ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent?key=${k}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${k}`;
}

// Models Google has retired answer 404; the settings held gemini-1.5-pro. A
// retired or missing model falls through to current ones, and the one that
// answered is remembered for the key.
const RETIRED_GEMINI = /^gemini-(?:1\.0|1\.5|pro$|pro-vision|2\.0|2\.5-(?:flash|pro)-preview)/i;
const GEMINI_CURRENT = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'];
const workingGeminiModel = new Map();

function geminiCandidates(apiKey, model) {
  const remembered = workingGeminiModel.get(`${apiKey}|${model}`);
  const list = [remembered, RETIRED_GEMINI.test(model) ? null : model, ...GEMINI_CURRENT].filter(Boolean);
  return [...new Set(list)];
}

async function generateAdminAi(config, payload, fetchImpl = fetch) {
  const request = normalizeRequest(config, payload);
  if (request.provider === 'gemini') {
    const contents = request.messages.map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
    const body = JSON.stringify({
      ...(request.systemPrompt ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } } : {}),
      contents,
      generationConfig: { temperature: request.temperature, maxOutputTokens: request.maxTokens },
    });
    let lastError = null;
    for (const model of geminiCandidates(request.apiKey, request.model)) {
      try {
        const data = await providerJson(geminiEndpoint(request.apiKey, model), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        }, fetchImpl, request.apiKey);
        workingGeminiModel.set(`${request.apiKey}|${request.model}`, model);
        return cleanText((data?.candidates?.[0]?.content?.parts || []).map(part => part?.text || '').join(''), 100_000);
      } catch (error) {
        lastError = error;
        // Only a missing model is worth another name; a refused key or an
        // exhausted quota fails the same way for every model.
        if (error.providerStatus !== 404) throw error;
      }
    }
    throw lastError;
  }
  if (request.provider === 'claude') {
    const data = await providerJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': request.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: request.model, system: request.systemPrompt || undefined,
        messages: request.messages, temperature: request.temperature, max_tokens: request.maxTokens,
      }),
    }, fetchImpl, request.apiKey);
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
  }, fetchImpl, request.apiKey);
  return cleanText(data?.choices?.[0]?.message?.content, 100_000);
}

/**
 * The AI configuration a feature runs on. The site's assistant has its own
 * («وكيل الذكاء الاصطناعي»), unset on production; with it unset every feature
 * runs on the one the institute did set — one key makes the whole system smart.
 */
function resolveAiConfig(settings = {}, purpose = 'admin') {
  const agent = settings?.aiAgentConfig;
  if (purpose === 'agent' && agent?.enabled && agent.apiKey && agent.model) return agent;
  const admin = settings?.adminAiConfig;
  if (!admin?.apiKey || !admin?.provider) return null;
  // The key and the model, not the admin assistant's own instructions.
  return purpose === 'agent' ? { ...admin, systemPrompt: '' } : admin;
}

module.exports = { generateAdminAi, geminiEndpoint, normalizeRequest, resolveAiConfig, sanitizeProviderText };
