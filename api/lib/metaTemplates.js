'use strict';

// Message templates on the official WhatsApp API (Meta Cloud API), made from the panel instead of from Meta's own console.
//
// Outside a 24-hour conversation WhatsApp delivers templates only, and every template is approved by Meta before it can be sent — usually
// within minutes, sometimes a day, and a rejected one costs nothing but the wait. What Meta refuses most often is not the wording but the
// shape: a variable at the very start or end of the text, numbering with a gap, a variable with no example, a name with a capital. Those
// are checked here, in Arabic, before anything is sent, so a template reaches Meta in a form that can be approved.
//
// Only MARKETING and UTILITY templates are made here; AUTHENTICATION templates (one-time codes) have a format of their own and the
// sign-in code is sent by lib/whatsappOtp.js.

const { GRAPH } = require('./metaGraph');

const CATEGORIES = new Set(['MARKETING', 'UTILITY']);
const NAME = /^[a-z][a-z0-9_]{0,511}$/;
const LANGUAGE = /^[a-z]{2,3}(_[A-Z]{2})?$/;
const BODY_MAX = 1024;
const FOOTER_MAX = 60;
// Marketing to people who may want to stop: the opt-out words lib/whatsappInbound.js already honours.
const MARKETING_FOOTER = 'لإيقاف الرسائل ارسل: ستوب';

const fail = message => Object.assign(new Error(message), { statusCode: 400 });

/** `{{1}}`, `{{2}}`… in the order they appear, as numbers. */
const variablesOf = text => [...String(text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(match => Number(match[1]));

/**
 * The request Meta takes, or an Arabic error saying what to change.
 * input: { name, language, category, body, examples: string[], footer? }
 */
function buildTemplate(input = {}) {
  const name = String(input.name || '').trim();
  if (!NAME.test(name)) throw fail('اسم القالب: حروف إنجليزي صغيرة وأرقام وشرطة سفلية بس، ويبدأ بحرف (مثال: course_reminder)');
  const language = String(input.language || 'ar').trim();
  if (!LANGUAGE.test(language)) throw fail('لغة القالب مش صحيحة (مثال: ar أو ar_EG أو en_US)');
  const category = String(input.category || '').trim().toUpperCase();
  if (!CATEGORIES.has(category)) throw fail('نوع القالب: تسويقي (MARKETING) أو خدمي (UTILITY)');

  const body = String(input.body || '').replace(/\r\n/g, '\n').trim();
  if (!body) throw fail('اكتب نص القالب');
  if (body.length > BODY_MAX) throw fail(`نص القالب أطول من ${BODY_MAX} حرف`);
  if (/\n{3,}/.test(body)) throw fail('نص القالب فيه أسطر فاضية كتير ورا بعض — ميتا بترفضه');
  const found = variablesOf(body);
  const unique = [...new Set(found)];
  if (unique.some((value, index) => value !== index + 1)) throw fail('المتغيرات لازم تترقم ورا بعض من {{1}} من غير تخطي');
  if (unique.length > 10) throw fail('أقصى عدد متغيرات 10');
  if (/^\s*\{\{\s*\d+\s*\}\}/.test(body) || /\{\{\s*\d+\s*\}\}\s*$/.test(body)) throw fail('ميتا بترفض قالب بيبدأ أو بينتهي بمتغير — ضيف كلمة قبله أو بعده');
  if (/\{\{\s*\d+\s*\}\}\s*\{\{\s*\d+\s*\}\}/.test(body)) throw fail('متغيرين ورا بعض من غير نص بينهم — ميتا بترفضه');

  const examples = (Array.isArray(input.examples) ? input.examples : []).map(value => String(value ?? '').trim());
  if (unique.length && (examples.length < unique.length || examples.slice(0, unique.length).some(value => !value))) {
    throw fail(`ميتا بتطلب مثال لكل متغير: اكتب ${unique.length} مثال`);
  }

  const components = [{
    type: 'BODY', text: body,
    ...(unique.length ? { example: { body_text: [examples.slice(0, unique.length)] } } : {}),
  }];
  const footer = String(input.footer ?? (category === 'MARKETING' ? MARKETING_FOOTER : '')).trim();
  if (footer.length > FOOTER_MAX) throw fail(`الفوتر أطول من ${FOOTER_MAX} حرف`);
  if (footer) components.push({ type: 'FOOTER', text: footer });
  return { name, language, category, components };
}

/** Meta's answer in words someone can act on. */
function metaReason(data, status) {
  const error = data?.error || {};
  return error.error_user_msg || error.error_user_title || error.message || `HTTP ${status}`;
}

async function request(url, options) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/** Send a template to Meta for approval. Resolves { ok, id, status } or { ok: false, reason }. */
async function createTemplate(tenantId, input, { access = require('./whatsapp').metaTemplateAccess } = {}) {
  const payload = buildTemplate(input);
  const credentials = await access(tenantId);
  if (credentials.reason) return { ok: false, reason: credentials.reason };
  const { res, data } = await request(`${GRAPH}/${encodeURIComponent(credentials.wabaId)}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, reason: metaReason(data, res.status), code: data?.error?.code || null };
  return { ok: true, id: data.id || null, status: data.status || 'PENDING', name: payload.name, language: payload.language };
}

/** Remove a template (every language of that name) from the account. */
async function deleteTemplate(tenantId, name, { access = require('./whatsapp').metaTemplateAccess } = {}) {
  const clean = String(name || '').trim();
  if (!NAME.test(clean)) throw fail('اسم القالب مش صحيح');
  const credentials = await access(tenantId);
  if (credentials.reason) return { ok: false, reason: credentials.reason };
  const { res, data } = await request(
    `${GRAPH}/${encodeURIComponent(credentials.wabaId)}/message_templates?name=${encodeURIComponent(clean)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${credentials.token}` } });
  if (!res.ok) return { ok: false, reason: metaReason(data, res.status) };
  return { ok: true };
}

module.exports = { BODY_MAX, FOOTER_MAX, MARKETING_FOOTER, buildTemplate, createTemplate, deleteTemplate, variablesOf };
