'use strict';

// «المساعد الذكي لازم يكون ذكي فعلا ويرد كويس ... في الاول اختيار: استفسار عن
// كورس يروح للمبيعات، مشكله يروح لخدمه العملاء» — and «Inbox خدمة العملاء
// الموحد ... المفروض يكون متخصص فقط لمشاكل السايت والسيسيتم».
//
// The real route over HTTP, its database, AI provider and hand-off targets
// replaced by stand-ins that record what they were given.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const seen = { prompts: [], leads: [], tickets: [], replies: [] };
let aiFails = false;
let subscriber = { id: 'sub-1', name: 'هنا', email: 'hana@x.com', phone: '01012345678' };
// What they study is read from enrollments: subscribers has no enrolled_courses column.
let enrolledIds = ['c-cbt'];
let currency = 'SAR';

const pool = {
  async query(sql, params) {
    if (/FROM courses/.test(sql)) {
      return [[
        { id: 'c-cbt', title: 'دبلومة العلاج المعرفي السلوكي', short_description: 'أساسيات CBT', duration: '6 شهور', type: 'Live', price_egp: 9000, price_sar: 1200, price_usd: 350 },
        { id: 'c-kids', title: 'دبلومة الصحة النفسية للأطفال', short_description: '', duration: '4 شهور', type: 'Recorded', price_egp: 6000, price_sar: 800, price_usd: 0 },
      ]];
    }
    if (/inbox_conversations/.test(sql)) return [[]];
    if (/FROM enrollments/.test(sql)) return [params[1] === subscriber?.id ? enrolledIds.map(course_id => ({ course_id })) : []];
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  },
  async getConnection() {
    return {
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
      async query(sql, params) {
        if (/SELECT id FROM support_tickets/.test(sql)) return [seen.tickets.filter(ticket => ticket.id === params[0])];
        if (/INSERT INTO ticket_replies/.test(sql)) { seen.replies.push({ sql, params }); return [{}]; }
        if (/UPDATE support_tickets/.test(sql)) return [{}];
        throw new Error(`unexpected conn query: ${sql.slice(0, 80)}`);
      },
    };
  },
};

function stub(rel, exports) {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
const pass = (_req, _res, next) => next();
stub('../lib/db', { pool });
stub('../middleware/auth', { requireAuth: (req, _res, next) => { req.user = { uid: 'u-1', email: 'hana@x.com' }; next(); } });
stub('../middleware/rateLimits', { aiLimiter: pass });
stub('../lib/subscriberIdentity', { resolveSubscriberRow: async () => subscriber });
stub('../lib/tenantSettings', { getTenantSetting: async () => ({ aiAgentConfig: {
  enabled: true, provider: 'claude', apiKey: 'test', model: 'claude-sonnet-5', systemPrompt: 'اذكر إن فيه خصم 10% للطلبة القدام',
  knowledgeBase: [{ id: 'k1', type: 'faq', title: 'مواعيد المحاضرات', content: 'بالليل بتوقيت القاهرة' }],
} }) });
// The real choice of configuration; only the provider call is stubbed.
const { resolveAiConfig } = require('../lib/adminAi');
stub('../lib/adminAi', { resolveAiConfig, generateAdminAi: async (_agent, payload) => {
  seen.prompts.push(payload);
  if (aiFails) throw new Error('provider down');
  return 'رد من الذكاء الاصطناعي';
} });
stub('../lib/clientContext', { resolveClientContext: async () => ({ currency, branch: currency === 'SAR' ? 'ONLINE_SAUDI' : 'ONLINE_EGYPT' }) });
stub('../lib/publicLead', { capturePublicLead: async lead => { seen.leads.push(lead); return { id: `lead-${seen.leads.length}` }; } });
stub('../routes/support', { createRoutedTicket: async (_conn, ticket) => {
  const id = `t-${seen.tickets.length + 1}`;
  seen.tickets.push({ id, ...ticket });
  return { id };
} });

const router = require('../routes/student-ai');

let base;
let server;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.tenantId = 'tn'; next(); });
  app.use('/api/student-ai', router);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const chat = async body => {
  const response = await fetch(`${base}/api/student-ai/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
};

test('a course question: answered by the AI agent from the catalogue at the visitor\'s prices, and handed to sales', async () => {
  const { json } = await chat({ message: 'عايزة أعرف عن دبلومة الأطفال', topic: 'course', history: [{ role: 'user', content: 'استفسار عن كورس' }] });
  assert.equal(json.reply, 'رد من الذكاء الاصطناعي');
  assert.equal(json.source, 'ai');
  const { systemPrompt, messages } = seen.prompts.at(-1);
  assert.match(systemPrompt, /دبلومة الصحة النفسية للأطفال .*800 ريال/, 'Saudi visitor: riyal prices');
  assert.match(systemPrompt, /الكورسات المشترك فيها: دبلومة العلاج المعرفي السلوكي/);
  assert.match(systemPrompt, /مواعيد المحاضرات\nبالليل/, 'the institute\'s knowledge base');
  assert.match(systemPrompt, /خصم 10%/, 'the administration\'s instructions');
  assert.deepEqual(messages.map(message => message.role), ['user', 'user']);
  assert.deepEqual(json.handoff, { kind: 'sales', id: 'lead-1' });
  assert.equal(seen.leads[0].source, 'ai_assistant');
  assert.equal(seen.leads[0].branch, 'ONLINE_SAUDI');
  assert.match(seen.leads[0].notes, /استفسار عن كورس: عايزة أعرف عن دبلومة الأطفال/);

  // The conversation is sales' already: no second lead.
  await chat({ message: 'والتقسيط؟', topic: 'course', handoffId: 'lead-1' });
  assert.equal(seen.leads.length, 1);
});

test('without an agent answering, the guided reply still knows the course and its price', async () => {
  aiFails = true;
  currency = 'EGP';
  const { json } = await chat({ message: 'دبلومة العلاج المعرفي السلوكي بكام', topic: 'course', handoffId: 'lead-1' });
  assert.equal(json.source, 'guided');
  assert.match(json.reply, /«دبلومة العلاج المعرفي السلوكي»/);
  assert.match(json.reply, /السعر: 9,000 جنيه/);

  // No number on the account: it asks for one instead of claiming sales has it,
  // and a number typed into the chat is the one used.
  subscriber = { ...subscriber, phone: null };
  const asked = await chat({ message: 'عايز أعرف البرامج', topic: 'course' });
  assert.equal(asked.json.handoff, null);
  assert.match(asked.json.reply, /اكتبلي رقم موبايلك/);
  const given = await chat({ message: 'رقمي 01098765432', topic: 'course' });
  assert.deepEqual(given.json.handoff, { kind: 'sales', id: 'lead-2' });
  assert.equal(seen.leads[1].phone, '01098765432');
  subscriber = { ...subscriber, phone: '01012345678' };
  aiFails = false;
});

test('a problem opens a ticket for customer service, and the conversation follows it', async () => {
  const first = await chat({ message: 'الفيديو مش بيشتغل في محاضرة 3', topic: 'support' });
  assert.deepEqual(first.json.handoff, { kind: 'support', id: 't-1' });
  const [ticket] = seen.tickets;
  assert.equal(ticket.channel, 'ai_assistant');
  assert.equal(ticket.category, 'course_access', 'a support-department category, so it reaches the inbox');
  assert.equal(ticket.subscriberId, 'sub-1');
  const note = seen.replies.find(reply => /is_internal/.test(reply.sql));
  assert.match(note.params.at(-1), /^رد المساعد: /, 'the agent sees what the assistant told the customer');

  seen.replies.length = 0;
  await chat({ message: 'جربت ولسه', topic: 'support', handoffId: 't-1' });
  assert.equal(seen.tickets.length, 1, 'no second ticket');
  const client = seen.replies.find(reply => reply.params.includes('CLIENT'));
  assert.equal(client.params.at(-1), 'جربت ولسه');

  // Someone else's ticket id opens a new ticket rather than writing into it.
  await chat({ message: 'مشكلة تانية', topic: 'support', handoffId: 't-999' });
  assert.equal(seen.tickets.length, 2);
});

test('the widget asks first, and the inbox holds only the site\'s problems', () => {
  const widget = read('client/components/AiTutorWidget.tsx');
  assert.match(widget, /استفسار عن كورس/);
  assert.match(widget, /عندي مشكلة ومحتاج مساعدة/);
  assert.match(widget, /body: JSON\.stringify\(\{ message: text, history, topic, handoffId: handoff\?\.id \|\| undefined \}\)/);

  const support = read('api/routes/support.js');
  const inbox = support.slice(support.indexOf("router.get('/api/admin/cs/inbox'"), support.indexOf('// ── STATS + AGENT WORKLOAD'));
  // The administration's default is the support queue, plus what was escalated
  // to it (8 Oct 2026); «كل الأقسام» is a choice on the page.
  assert.match(inbox, /else if \(!department && unscoped\) where\.push\("\(t\.department IN \('support','management'\) OR t\.escalated_at IS NOT NULL\)"\);/);
  assert.match(inbox, /converted_ticket_id IS NULL AND subject = 'technical'/);
  const screen = read('admin/pages/dashboard/tabs/CustomerInboxTab.tsx');
  assert.match(screen, /type InboxSource = 'ticket' \| 'contact';/);
  assert.doesNotMatch(screen, /\/admin\/finance\/refunds'/, 'refunds have their own page');
  assert.doesNotMatch(screen, /joinUsApplications/, 'so do the join-us forms');

  // A course or price question on the contact form reaches sales as a lead.
  const contact = read('api/routes/public.js');
  assert.match(contact, /if \(SALES_SUBJECTS\.has\(subject\)\) \{\s+await capturePublicLead\(/);
  assert.match(read('api/routes/lead-capture-crm.js'), /const lead = await capturePublicLead\(/);
});
