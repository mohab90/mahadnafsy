'use strict';

// One road: what the system sends on its own goes through the outbox, keyed so
// a second run queues nothing new. Only codes and replies someone is waiting on
// at that moment are sent directly — each with a line saying why.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const queued = [];
const direct = [];
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/outbox', { enqueue: async message => { queued.push(message); return `id-${queued.length}`; } });
stub('../lib/whatsapp', { sendWhatsApp: async (phone, text, opts) => { direct.push({ phone, text, opts }); return { ok: true }; } });
stub('../lib/tenantSettings', {
  getTenantSetting: async () => ({ enabled: true, phones: ['01000000001', '01000000002'], hour: 21 }),
});
stub('../lib/dailyIncomeReport', {
  DAY_ENDS_AT_HOUR: 19,
  buildDailyIncomeReport: async () => ({
    date: '2026-10-11', open: false,
    income: { totalEgp: 0, payments: 0, acceptedEgp: 0, acceptedN: 0, reviewEgp: 0, reviewN: 0, failedN: 0 },
    teams: Object.fromEntries(['collection', 'daqqi', 'sales', 'tagamoa', 'other'].map(key => [key, { totalEgp: 0 }])),
    counts: { newLeads: 0, newBookings: 0, certificatesRequested: 0, certificatesIssued: 0 },
  }),
});
const { sendOwnerDailyReport } = require('../lib/ownerDailyReport');

test('the scheduled owner report is queued, one per number per day; the button still sends at once', async () => {
  const result = await sendOwnerDailyReport({ tenantId: 't', date: '2026-10-11', queue: true }, {});
  assert.equal(result.queued, 2);
  assert.equal(direct.length, 0);
  assert.deepEqual(queued.map(message => message.dedupeKey), ['owner-report:2026-10-11:201000000001', 'owner-report:2026-10-11:201000000002']);
  assert.ok(queued.every(message => message.payload.category === 'owner_report' && message.channel === 'whatsapp'));

  queued.length = 0;
  const now = await sendOwnerDailyReport({ tenantId: 't', date: '2026-10-11', force: true }, {});
  assert.equal(now.sent, 2, '«ابعت دلوقتي» answers with what the provider said');
  assert.equal(queued.length, 0);
  assert.match(read('lib/backgroundScheduler.js'), /sendOwnerDailyReport\(\{ tenantId, date, queue: true \}\)/);
});

test('in lib/, only the code, the replies and the report button send directly', () => {
  const sites = [];
  for (const file of fs.readdirSync(path.join(root, 'lib'))) {
    if (!file.endsWith('.js') || file === 'whatsapp.js') continue;
    const lines = read(`lib/${file}`).split('\n');
    lines.forEach((line, index) => {
      if (/sendWhatsApp\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) sites.push(`${file}:${index + 1}`);
    });
  }
  assert.deepEqual(sites.map(site => site.split(':')[0]).sort(),
    ['inboxBot.js', 'ownerDailyReport.js', 'whatsappInbound.js', 'whatsappOtp.js']);
});

test('the jobs and fire-and-forget sends queue under a key', () => {
  const expectations = {
    'lib/automationEngine.js': /dedupeKey: `automation:\$\{wf\.id\}/,
    'lib/paymobFinalise.js': /dedupeKey: `paymob-admin-alert:\$\{merchantOrderId\}`/,
    'routes/misc/_shared.js': /queueReminderWhatsApp\(\{ tenantId, phone: p\.phone, message: msg, category: 'crm', dedupeKey: logKey \}\)/,
    'routes/subscriber-payments.js': /dedupeKey: `payment-received-wa:\$\{id\}`/,
    'routes/core/financepay.js': /dedupeKey: `payment-confirmed-wa:\$\{id\}`/,
    'routes/payment-proofs.js': /dedupeKey: `payment-proof-\$\{action\}:\$\{proof\.id\}`/,
    'routes/admin/subscribers.js': /dedupeKey: `subscriber-welcome:\$\{id\}`/,
    'routes/admin/leads/convert.js': /dedupeKey: `lead-converted-wa:\$\{lead\.id\}`/,
  };
  for (const [file, pattern] of Object.entries(expectations)) assert.match(read(file), pattern, file);
  for (const file of ['lib/automationEngine.js', 'lib/paymobFinalise.js', 'routes/misc/_shared.js', 'routes/subscriber-payments.js', 'routes/core/financepay.js', 'routes/payment-proofs.js', 'routes/admin/leads/convert.js']) {
    assert.doesNotMatch(read(file).replace(/^\s*\/\/.*$/gm, ''), /sendWhatsApp\(/, `${file} no longer sends directly`);
  }
  // The direct ones say why.
  assert.match(read('lib/whatsappOtp.js'), /Direct, never through the outbox: a code is worth something for/);
  assert.match(read('routes/team-inbox.js'), /Direct, not queued: a reply typed in the conversation/);
  assert.match(read('routes/messaging-inbox.js'), /Direct, not queued: the rep/);
  // The abandoned-checkout run named no kind, so the gate refused it all.
  assert.match(read('lib/abandonedCheckout.js'), /tenantId: order\.tenant_id, category: 'reminder' \}/);
});
