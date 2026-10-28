'use strict';

// «السيستم يقدر يصلح نفسه ويبقى ذكي» (27 Oct 2026): after the watchdog finds something, the assistant puts back what died of a passing fault
// and gives the owner the model's reading of it — never an action the model chose, never anything it could leak.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-ops-assistant-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const assistant = require('../lib/opsAssistant');
const watchdog = require('../lib/opsWatchdog');

const HOUR = 3600 * 1000;
const at = Date.UTC(2026, 9, 27, 12, 0, 0);
const AI_SETTINGS = { adminAiConfig: { provider: 'gemini', apiKey: 'AIzaTestKeyTestKeyTestKey1234', model: 'gemini-2.5-flash', systemPrompt: 'x' } };
const reader = (overrides = {}) => async section => (section === 'ops_assistant' ? (overrides.assistant || {}) : (overrides.ai === undefined ? AI_SETTINGS : overrides.ai));
const geminiAnswer = text => async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });

function fakeDb({ healthy = [{ channel: 'whatsapp' }], dead = [], evidence = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const flat = sql.replace(/\s+/g, ' ');
      calls.push({ sql: flat, params });
      if (/SELECT DISTINCT channel FROM message_outbox/.test(flat)) return [healthy];
      if (/FROM message_outbox WHERE tenant_id=\? AND status='dead'/.test(flat)) return [dead];
      if (/^UPDATE message_outbox/.test(flat)) return [{ affectedRows: params[1].length }];
      if (/FROM message_outbox WHERE tenant_id=\? AND status IN \('failed','dead'\)/.test(flat)) return [evidence];
      if (/FROM messaging_channels/.test(flat)) return [[{ kind: 'whatsapp', provider: 'wapilot', status: 'connected', last_error: null }]];
      return [[]];
    },
  };
}
const tidy = () => assistant._reset();

test('messages that died of a passing fault, on a channel that is sending again, go back in the queue — once', async () => {
  tidy();
  const dead = [{ id: 'm1', channel: 'whatsapp', category: 'reminder' }, { id: 'm2', channel: 'whatsapp', category: 'otp' }, { id: 'm3', channel: 'whatsapp', category: 'payment' }];
  const db = fakeDb({ dead });
  const open = async category => category !== 'payment';
  const result = await assistant.requeueTransientDead({ db, tenantId: 't1', now: at, isCategoryOpen: open });
  assert.equal(result.count, 1, 'a code is never put back, and neither is a kind that is closed');
  const update = db.calls.find(call => /^UPDATE message_outbox/.test(call.sql));
  assert.deepEqual(update.params, ['t1', ['m1']]);
  assert.match(update.sql, /SET status='pending', attempts=0, last_error=NULL/);
  const select = db.calls.find(call => /status='dead' AND created_at >= \?/.test(call.sql));
  assert.equal(select.params[0], 't1');
  assert.equal(select.params[1].getTime(), at - 3 * HOUR);
  assert.deepEqual(select.params[2], ['whatsapp']);
  assert.equal(select.params[3], assistant.TRANSIENT);
  assert.equal(select.params[4], assistant.NEVER_RETRY);
  // the same row dying again is left for a person
  const again = await assistant.requeueTransientDead({ db: fakeDb({ dead: [dead[0]] }), tenantId: 't1', now: at, isCategoryOpen: open });
  assert.equal(again.count, 0);
});

test('nothing is put back while no channel is sending, and a dry run writes nothing', async () => {
  tidy();
  const silent = fakeDb({ healthy: [], dead: [{ id: 'm1', channel: 'whatsapp', category: 'reminder' }] });
  assert.deepEqual(await assistant.requeueTransientDead({ db: silent, tenantId: 't1', now: at }), { count: 0, reason: 'no_channel_sending' });
  assert.ok(!silent.calls.some(call => /^UPDATE/.test(call.sql)));
  const dry = fakeDb({ dead: [{ id: 'm9', channel: 'whatsapp', category: 'reminder' }] });
  assert.deepEqual(await assistant.requeueTransientDead({ db: dry, tenantId: 't1', now: at, dryRun: true }), { count: 1, dryRun: true });
  assert.ok(!dry.calls.some(call => /^UPDATE/.test(call.sql)));
});

test('the passing-fault pattern takes timeouts and 5xx, and never a number, a token, a closed kind or a bad address', () => {
  const take = new RegExp(assistant.TRANSIENT, 'i');
  const refuse = new RegExp(assistant.NEVER_RETRY, 'i');
  for (const text of ['connect ETIMEDOUT 1.2.3.4:443', 'socket hang up', 'HTTP 503', 'HTTP 429 Too Many Requests', 'Connection timeout', 'rate limit hit']) assert.ok(take.test(text), text);
  for (const text of ['category_disabled', 'invalid_number', 'Invalid OAuth access token', 'authentication failed (535)', 'daily_limit_reached', 'No recipients defined', 'opted_out']) assert.ok(refuse.test(text), text);
  // a timeout that comes with a refusal is still a refusal
  assert.ok(take.test('timeout while checking token') && refuse.test('timeout while checking token'));
});

test('the model reads the finding with every address and number masked, and answers in a few lines', async () => {
  tidy();
  const sent = [];
  const fetchImpl = async (url, options) => { sent.push({ url, body: JSON.parse(options.body) }); return geminiAnswer('السبب غالباً انتهاء توكن واتساب. جدّد التوكن من إعدادات القناة.')(); };
  const db = fakeDb({ evidence: [{ channel: 'whatsapp', status: 'dead', err: 'token expired for ahmed@gmail.com phone 201012345678', n: 7 }] });
  const finding = { key: 'outbox', severity: 'medium', title: 'رسايل مش بتتبعت', body: 'واتساب: 12 رسالة فشلت نهائياً في آخر ساعة' };
  await assistant.assist({ findings: [finding], tenantId: 't1', db, now: at, quietHours: { outbox: 3 }, fetchImpl, readSetting: reader() });
  assert.match(finding.diagnosis, /انتهاء توكن واتساب/);
  const prompt = sent[0].body.contents[0].parts[0].text;
  assert.match(prompt, /12 رسالة فشلت/);
  assert.match(prompt, /7 × whatsapp\/dead/);
  assert.doesNotMatch(prompt, /ahmed|gmail|201012345678/);
  assert.ok(prompt.includes('[EMAIL]'));
  assert.match(sent[0].body.systemInstruction.parts[0].text, /ممنوع تخترع سبب/);
  assert.match(sent[0].url, /gemini/);
});

test('one reading per quiet window, a cap per day, and silence without a key, a switch or a working model', async () => {
  tidy();
  let asked = 0;
  const fetchImpl = async () => { asked += 1; return geminiAnswer('قراءة')(); };
  const run = (overrides, extra = {}) => assistant.assist({ findings: [{ key: 'otp', severity: 'high', title: 't', body: 'b' }], tenantId: 't1', db: fakeDb(), now: at, quietHours: { otp: 2 }, fetchImpl, readSetting: reader(overrides), ...extra });
  await run({}); await run({}, { now: at + 30 * 60 * 1000 });
  assert.equal(asked, 1, 'the same problem is read once in its window');
  await run({}, { now: at + 3 * HOUR });
  assert.equal(asked, 2, 'and again in the next');

  tidy(); asked = 0;
  assert.equal((await run({ ai: {} }))[0].diagnosis, undefined, 'no key: the alert goes out as it was');
  assert.equal(asked, 0);
  assert.equal((await run({ assistant: { enabled: false } }))[0].diagnosis, undefined);
  assert.equal((await run({ assistant: { diagnose: false } }))[0].diagnosis, undefined);
  tidy();
  assert.equal((await run({ assistant: { dailyCalls: 1 } }))[0].diagnosis, 'قراءة');
  tidy(); // a fresh window and day, with the cap spent by the first call below
  const capped = { dailyCalls: 1 };
  await run({ assistant: capped }, { now: at + 6 * HOUR });
  const [again] = await run({ assistant: capped }, { now: at + 9 * HOUR });
  assert.equal(again.diagnosis, undefined, 'over the day\'s cap');
  tidy();
  const [failed] = await run({}, { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  assert.equal(failed.diagnosis, undefined, 'a model that fails never stops the alert');
});

test('what was put right is told beside the alert, with the model\'s reading, in the owner\'s words', async () => {
  tidy();
  const db = fakeDb({ dead: [{ id: 'm1', channel: 'whatsapp', category: 'reminder' }, { id: 'm2', channel: 'whatsapp', category: 'reminder' }] });
  const finding = { key: 'outbox', severity: 'medium', title: 'رسايل مش بتتبعت', body: 'واتساب: 12 رسالة فشلت نهائياً في آخر ساعة', hint: 'راجع القناة.' };
  await assistant.assist({ findings: [finding], tenantId: 't1', db, now: at, quietHours: {}, fetchImpl: geminiAnswer('انقطاع مؤقت عند المزوّد.'), readSetting: reader(), isCategoryOpen: async () => true });
  assert.equal(finding.fixed, 'رجّعت للطابور رسايل فشلت لعطل مؤقت والقناة رجعت تبعت: 2');
  const text = watchdog.compose(finding);
  assert.match(text, /^⚠️ \*رسايل مش بتتبعت\*/);
  assert.match(text, /\n✅ رجّعت للطابور رسايل فشلت لعطل مؤقت والقناة رجعت تبعت: 2/);
  assert.match(text, /\n🧠 رأي المساعد: انقطاع مؤقت عند المزوّد\./);
  assert.ok(text.indexOf('✅') < text.indexOf('🧠') && text.indexOf('🧠') < text.indexOf('راجع القناة.'));
  // switched off, it fixes nothing
  tidy();
  const quiet = { key: 'outbox', severity: 'medium', title: 't', body: 'b' };
  const untouched = fakeDb({ dead: [{ id: 'm5', channel: 'whatsapp', category: 'reminder' }] });
  await assistant.assist({ findings: [quiet], tenantId: 't1', db: untouched, now: at, quietHours: {}, readSetting: reader({ assistant: { autoFix: false, diagnose: false } }) });
  assert.ok(!untouched.calls.some(call => /^UPDATE/.test(call.sql)));
});

test('the assistant can only put queued messages back: no other write, and the watchdog hands it every finding', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'opsAssistant.js'), 'utf8');
  const code = source.replace(/\/\/.*$/gm, '');
  assert.deepEqual([...code.matchAll(/\b(INSERT|DELETE|ALTER|DROP|TRUNCATE|REPLACE)\b/g)].map(match => match[1]), []);
  assert.equal((code.match(/UPDATE\s+\w+/g) || []).join(','), 'UPDATE message_outbox');
  assert.doesNotMatch(code, /\beval\(|new Function|child_process|exec\(/);
  const watch = fs.readFileSync(path.join(__dirname, '..', 'lib', 'opsWatchdog.js'), 'utf8');
  assert.match(watch, /await require\('\.\/opsAssistant'\)\.assist\(\{\s*findings, tenantId, db: pool, logger, now, quietHours: QUIET_HOURS, isCategoryOpen: require\('\.\/whatsapp'\)\.isCategoryOpen,/);
  assert.ok(watch.indexOf("require('./opsAssistant')") < watch.indexOf('await queueAlerts({ findings'));
});

test('every call to Meta names one Graph version, and it is not a retired one', () => {
  const root = path.join(__dirname, '..');
  const { GRAPH_VERSION, GRAPH, DEFAULT_VERSION } = require('../lib/metaGraph');
  assert.match(DEFAULT_VERSION, /^v(2[4-9]|[3-9]\d)\.0$/, 'v19.0 was retired on 21 May 2026');
  assert.equal(GRAPH, `https://graph.facebook.com/${GRAPH_VERSION}`);
  for (const dir of ['lib', 'routes']) {
    for (const file of fs.readdirSync(path.join(root, dir)).filter(name => name.endsWith('.js') && name !== 'metaGraph.js')) {
      const source = fs.readFileSync(path.join(root, dir, file), 'utf8');
      assert.doesNotMatch(source, /graph\.facebook\.com\/v\d/, `${dir}/${file} names a version of its own`);
    }
  }
});
