'use strict';

// 19 Oct 2026 — scheduled messages, chat campaigns, handing a chat over, an AI-suggested reply, and the timeline.
//
// «تسجيل المحادثات تلقائيًا على خط العميل الزمني · تعيين المحادثة لموظف تاني · تغيير حالة الليد من جوه الشات · رسائل مجدولة ·
// حملات من الشات · ذكاء اصطناعي يقترح رد».

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');

// A stand-in database: every query is recorded, and answered by the first rule that matches its SQL.
const { pool } = require('../lib/db');
const realQuery = pool.query;
let log = [];
let rules = [];
const answer = (sql, params) => {
  log.push({ sql, params });
  for (const [pattern, result] of rules) if (pattern.test(sql)) return typeof result === 'function' ? result(sql, params) : result;
  return [[], []];
};
test.beforeEach(() => { log = []; rules = []; pool.query = async (sql, params) => answer(String(sql), params); });
test.after(() => { pool.query = realQuery; });

const scheduled = require('../lib/whatsappScheduled');

test('a campaign is spaced out, personalised, and leaves out whoever unsubscribed', async () => {
  rules = [
    [/COUNT\(\*\) AS n FROM wa_web_scheduled/, [[{ n: 0 }]]],
    [/FROM marketing_suppressions/, (sql, params) => [params.slice(3).length && /201000000002/.test(JSON.stringify(params)) ? [{ destination_hash: 'x' }] : []]],
  ];
  const result = await scheduled.scheduleCampaign('t1', 'rep1', {
    recipients: [
      { jid: '201000000001@s.whatsapp.net', name: 'سارة أحمد' },
      { jid: '201000000001@s.whatsapp.net', name: 'سارة أحمد' },
      { jid: 'not-a-chat', name: 'x' },
      { phone: '01000000003', name: 'علي' },
    ],
    text: 'أهلاً {name}، عرض الأسبوع', gapSeconds: 5, label: 'اختبار',
  });
  assert.equal(result.skipped.duplicate, 1);
  assert.equal(result.skipped.invalid, 1);
  const inserts = log.filter(entry => /INSERT INTO wa_web_scheduled/.test(entry.sql));
  assert.equal(inserts.length, result.queued);
  assert.ok(result.queued >= 1);
  // The first name fills {name}; the gap is never under the floor (a burst gets a number banned).
  assert.match(inserts[0].params[6], /^أهلاً سارة، عرض الأسبوع$/);
  const delays = inserts.map(entry => entry.params[7]);
  assert.ok(delays[0] >= Math.round(scheduled.MIN_GAP_SECONDS * 0.7));
  for (let i = 1; i < delays.length; i++) assert.ok(delays[i] - delays[i - 1] >= Math.round(scheduled.MIN_GAP_SECONDS * 0.7));
  assert.equal(inserts[0].params[9], 'اختبار');
});

test('a message needs a minute, a recipient and a body; a rep with too many waiting is told', async () => {
  rules = [[/COUNT\(\*\) AS n FROM wa_web_scheduled/, [[{ n: 0 }]]]];
  const soon = new Date(Date.now() + 5000).toISOString();
  await assert.rejects(() => scheduled.scheduleOne('t1', 'rep1', { phone: '01000000001', text: 'x', sendAt: soon }), /بعد دقيقة/);
  await assert.rejects(() => scheduled.scheduleOne('t1', 'rep1', { phone: '01000000001', text: '  ', sendAt: new Date(Date.now() + 3600e3).toISOString() }), /اكتب الرسالة/);
  await assert.rejects(() => scheduled.scheduleOne('t1', 'rep1', { phone: 'abc', text: 'x', sendAt: new Date(Date.now() + 3600e3).toISOString() }), /الرقم/);
  await assert.rejects(() => scheduled.scheduleOne('t1', 'rep1', { phone: '01000000001', text: 'x', sendAt: new Date(Date.now() + 90 * 86400e3).toISOString() }), /60 يوم/);
  rules = [[/COUNT\(\*\) AS n FROM wa_web_scheduled/, [[{ n: scheduled.MAX_PENDING_PER_REP }]]]];
  await assert.rejects(() => scheduled.scheduleOne('t1', 'rep1', { phone: '01000000001', text: 'x', sendAt: new Date(Date.now() + 3600e3).toISOString() }), /كتير/);
});

test('what is due goes out through the rep\'s WhatsApp; the daily cap and an unlinked phone only delay it', async () => {
  const due = [
    { id: 'a', tenant_id: 't1', staff_id: 'rep1', jid: '1@s.whatsapp.net', body: 'one', attempts: 0 },
    { id: 'b', tenant_id: 't1', staff_id: 'rep1', jid: '2@s.whatsapp.net', body: 'two', attempts: 0 },
    { id: 'c', tenant_id: 't1', staff_id: 'rep1', jid: '3@s.whatsapp.net', body: 'three', attempts: 0 },
    { id: 'd', tenant_id: 't1', staff_id: 'rep1', jid: '4@s.whatsapp.net', body: 'four', attempts: 0 },
  ];
  rules = [
    [/SELECT id, tenant_id, staff_id, jid, body, attempts FROM wa_web_scheduled/, [due]],
    [/SET status='sending'/, [{ affectedRows: 1 }]],
    [/UPDATE wa_web_scheduled/, [{ affectedRows: 1 }]],
  ];
  const sent = [];
  const wa = {
    isOwner: () => true,
    sendText: async (tenantId, staffId, { jid, text }) => {
      sent.push({ tenantId, staffId, jid, text });
      if (jid.startsWith('2')) throw Object.assign(new Error('cap'), { code: 'WA_WEB_DAILY_LIMIT', statusCode: 429 });
      if (jid.startsWith('3')) throw Object.assign(new Error('not linked'), { code: 'WA_WEB_NOT_LINKED', statusCode: 409 });
      if (jid.startsWith('4')) throw Object.assign(new Error('الرقم ده مش عليه واتساب'), { statusCode: 404 });
      return {};
    },
  };
  assert.equal(await scheduled.runDue(wa), 4);
  assert.deepEqual(sent.map(item => item.jid), ['1@s.whatsapp.net', '2@s.whatsapp.net', '3@s.whatsapp.net', '4@s.whatsapp.net']);
  const outcome = id => log.find(entry => /^UPDATE wa_web_scheduled SET status=/.test(entry.sql.trim()) && !/sending/.test(entry.sql) && entry.params.includes(id));
  assert.match(outcome('a').sql, /status='sent'/);
  assert.match(outcome('b').sql, /status='pending'.*DATE\(DATE_ADD\(NOW\(\), INTERVAL 1 DAY\)\)/s, 'the cap: tomorrow morning');
  assert.match(outcome('c').sql, /status='pending'.*INTERVAL \? SECOND/s, 'not linked: again shortly');
  assert.match(outcome('d').sql, /status='failed'/, 'a number that is not on WhatsApp is not retried');
  // Every statement names its tenant.
  for (const entry of log.filter(item => /UPDATE wa_web_scheduled/.test(item.sql))) assert.match(entry.sql, /tenant_id=\?/);
});

test('nothing is sent by a process that does not hold the sessions', async () => {
  rules = [[/FROM wa_web_scheduled/, [[{ id: 'a', tenant_id: 't', staff_id: 's', jid: 'x@s.whatsapp.net', body: 'b', attempts: 0 }]]]];
  assert.equal(await scheduled.runDue({ isOwner: () => false, sendText: async () => { throw new Error('must not send'); } }), 0);
  assert.equal(log.length, 0);
});

test('the screen\'s buttons exist: timeline, hand-over, lead status, schedule, campaign, suggestion', () => {
  const server = read('api/routes/whatsapp-web-crm.js');
  for (const route of ['/scheduled', '/campaign', '/campaigns', '/colleagues', '/assign', '/suggest']) {
    assert.ok(server.includes(`/api/staff/whatsapp-web${route}'`), route);
  }
  assert.match(server, /assignLead\(/, 'a lead changes hands through the one assignment service, with its history');
  assert.match(server, /sendStaffMessage\(pool/, 'the colleague gets the conversation as a message');
  assert.match(server, /code: 'NO_AI_KEY'/, 'with no key the rep is told where to put it');
  assert.match(read('api/lib/registerRoutes.js'), /whatsapp-web-crm/);
  assert.match(read('api/lib/whatsappWeb.js'), /require\('\.\/whatsappScheduled'\)\.runDue\(module\.exports\)/, 'the worker runs where the sessions live');
  assert.match(read('api/routes/whatsapp-web.js'), /backfillChatToCrm\(tenant\(req\), me\(req\), jid, match\)/);
  assert.match(read('api/lib/whatsappWebStore.js'), /INSERT IGNORE INTO communications[\s\S]*LIMIT 150/);
  const page = read('admin/pages/dashboard/tabs/whatsapp/WhatsAppWebTab.tsx');
  const tools = read('admin/components/WhatsAppChatTools.tsx');
  assert.match(tools, /adminPut\(`\/admin\/crm\/leads\/\$\{encodeURIComponent\(leadId\)\}\/status`/, 'the lead\'s status is changed from the chat, through the lead status route');
  assert.match(page, /<LeadStatusControl leadId=\{context\.lead\.id\}/);
  for (const label of ['اقترح رد', 'جدولة', 'حوّل لزميل', 'حملة']) assert.ok(page.includes(label) || tools.includes(label), label);
  assert.match(page, /<SuggestReplyButton jid=\{active\.jid\}/);
  assert.match(page, /<ScheduledList jid=\{active\.jid\}/);
  assert.match(page, /<CampaignDialog jids=\{\[\.\.\.picked\]\}/);
});
