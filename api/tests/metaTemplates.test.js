'use strict';

// «نبني واتساب رسمي مع ميتا ويبعت حملات» (27 Oct 2026): a template is made from the panel and sent to Meta for approval in a shape Meta
// can approve — the refusals Meta gives most often are caught first, in Arabic.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const templates = require('../lib/metaTemplates');

const GOOD = { name: 'course_reminder', language: 'ar', category: 'UTILITY', body: 'أهلاً {{1}}، محاضرتك في {{2}} بتبدأ بكرة الساعة 8 مساءً.', examples: ['أحمد', 'الصحة النفسية'] };
const refuse = (change, pattern) => assert.throws(() => templates.buildTemplate({ ...GOOD, ...change }), error => error.statusCode === 400 && pattern.test(error.message), JSON.stringify(change));

test('a good template becomes the request Meta takes, with an example for each variable', () => {
  const built = templates.buildTemplate(GOOD);
  assert.equal(built.name, 'course_reminder');
  assert.equal(built.language, 'ar');
  assert.equal(built.category, 'UTILITY');
  assert.deepEqual(built.components, [{ type: 'BODY', text: GOOD.body, example: { body_text: [['أحمد', 'الصحة النفسية']] } }]);
  const plain = templates.buildTemplate({ name: 'hello_world_ar', category: 'UTILITY', body: 'أهلاً بيك في معهد الدراسات النفسية.' });
  assert.deepEqual(plain.components, [{ type: 'BODY', text: 'أهلاً بيك في معهد الدراسات النفسية.' }], 'no variables, no example');
  assert.equal(plain.language, 'ar');
});

test('a marketing template carries the way to stop it, one a person already uses', () => {
  const marketing = templates.buildTemplate({ ...GOOD, category: 'MARKETING' });
  assert.deepEqual(marketing.components[1], { type: 'FOOTER', text: 'لإيقاف الرسائل ارسل: ستوب' });
  assert.equal(templates.buildTemplate({ ...GOOD, category: 'MARKETING', footer: '' }).components.length, 1, 'unless it is said not to');
  assert.equal(templates.buildTemplate(GOOD).components.length, 1, 'a service message has no footer of its own');
  const inbound = fs.readFileSync(path.join(__dirname, '..', 'lib', 'whatsappInbound.js'), 'utf8');
  assert.ok(inbound.includes('ستوب'), 'the word the footer asks for is one the inbound handler honours');
});

test('what Meta refuses most often is refused here first, in Arabic', () => {
  refuse({ name: 'Course_Reminder' }, /اسم القالب/);
  refuse({ name: 'اسم' }, /اسم القالب/);
  refuse({ name: '1abc' }, /اسم القالب/);
  refuse({ language: 'arabic' }, /لغة/);
  refuse({ category: 'AUTHENTICATION' }, /تسويقي.*خدمي/);
  refuse({ category: '' }, /تسويقي.*خدمي/);
  refuse({ body: '' }, /اكتب نص/);
  refuse({ body: 'ا'.repeat(1025) }, /أطول من 1024/);
  refuse({ body: 'أهلاً {{1}} و{{3}}', examples: ['أ', 'ب', 'ج'] }, /ورا بعض من \{\{1\}\}/);
  refuse({ body: '{{1}} أهلاً بيك', examples: ['أحمد'] }, /بيبدأ أو بينتهي/);
  refuse({ body: 'أهلاً بيك {{1}}', examples: ['أحمد'] }, /بيبدأ أو بينتهي/);
  refuse({ body: 'أهلاً {{1}}{{2}} تمام', examples: ['أ', 'ب'] }, /متغيرين ورا بعض/);
  refuse({ examples: ['أحمد'] }, /مثال لكل متغير/);
  refuse({ examples: ['أحمد', ''] }, /مثال لكل متغير/);
  refuse({ body: 'سطر\n\n\nسطر' }, /أسطر فاضية/);
  refuse({ footer: 'ن'.repeat(61) }, /الفوتر/);
});

test('a variable used twice is one variable, and numbering may repeat', () => {
  const built = templates.buildTemplate({ ...GOOD, body: 'أهلاً {{1}}، {{1}} محاضرتك الساعة {{2}} مساءً.', examples: ['أحمد', '8'] });
  assert.deepEqual(built.components[0].example.body_text, [['أحمد', '8']]);
  assert.deepEqual(templates.variablesOf(GOOD.body), [1, 2]);
});

test('sending it to Meta uses the account\'s credentials and the one Graph version, and reports Meta\'s reason when it refuses', async () => {
  const seen = [];
  const original = global.fetch;
  global.fetch = async (url, options) => { seen.push({ url, options }); return { ok: true, status: 200, json: async () => ({ id: '123', status: 'PENDING' }) }; };
  try {
    const { GRAPH } = require('../lib/metaGraph');
    const access = async tenantId => (tenantId === 't1' ? { token: 'TOKEN', wabaId: '998877' } : { reason: 'waba_missing' });
    const ok = await templates.createTemplate('t1', GOOD, { access });
    assert.deepEqual(ok, { ok: true, id: '123', status: 'PENDING', name: 'course_reminder', language: 'ar' });
    assert.equal(seen[0].url, `${GRAPH}/998877/message_templates`);
    assert.equal(seen[0].options.method, 'POST');
    assert.equal(seen[0].options.headers.Authorization, 'Bearer TOKEN');
    assert.equal(JSON.parse(seen[0].options.body).components[0].type, 'BODY');
    assert.deepEqual(await templates.createTemplate('t2', GOOD, { access }), { ok: false, reason: 'waba_missing' });
    assert.equal(seen.length, 1, 'nothing is sent without the account');

    global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid parameter', error_user_msg: 'القالب ده موجود بنفس الاسم', code: 100 } }) });
    assert.deepEqual(await templates.createTemplate('t1', GOOD, { access }), { ok: false, reason: 'القالب ده موجود بنفس الاسم', code: 100 });

    global.fetch = async (url, options) => { seen.push({ url, options }); return { ok: true, status: 200, json: async () => ({ success: true }) }; };
    assert.deepEqual(await templates.deleteTemplate('t1', 'course_reminder', { access }), { ok: true });
    assert.equal(seen.at(-1).options.method, 'DELETE');
    assert.equal(seen.at(-1).url, `${GRAPH}/998877/message_templates?name=course_reminder`);
    await assert.rejects(templates.deleteTemplate('t1', '../x', { access }), { statusCode: 400 });
  } finally { global.fetch = original; }
});

test('the panel\'s routes need the settings permission and are rate limited, and the credentials lookup is shared with the listing', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp-campaigns.js'), 'utf8');
  assert.match(route, /router\.post\('\/api\/admin\/whatsapp-campaigns\/templates', \.\.\.manage, bulkOperationLimiter,/);
  assert.match(route, /router\.delete\('\/api\/admin\/whatsapp-campaigns\/templates\/:name', \.\.\.manage, bulkOperationLimiter,/);
  assert.match(route, /const manage = \[requireAuth, requireAdminOrStaff, requirePermission\('manage_settings'\)\];/);
  const wa = fs.readFileSync(path.join(__dirname, '..', 'lib', 'whatsapp.js'), 'utf8');
  assert.match(wa, /async function listMetaTemplates\(tenantId\) \{\s*const access = await metaTemplateAccess\(tenantId\);/);
});
