'use strict';

// «ابعت STOP أو ستوب يوقف الرسايل» (11 Oct 2026). The 30-day re-engagement
// message to a lead gone quiet went as 'reminder', straight from the job,
// without looking at the opt-out list or at a lead whose data was erased. It is
// now a 'marketing' message, queued once per lead per 30-day window, never to a
// number that wrote «ستوب». The other scheduled reminders are queued by key too.

const test = require('node:test');
const assert = require('node:assert/strict');

const queued = [];
let suppressed = new Set();
let consentFails = false;
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/outbox', { enqueue: async message => { queued.push(message); return `id-${queued.length}`; } });
stub('../lib/marketingConsent', {
  WHATSAPP_OPT_OUT_HINT: 'لو مش حابب توصلك رسايلنا ابعت «ستوب» أو STOP.',
  filterSuppressed: async (_tenantId, channel, items, key) => {
    assert.equal(channel, 'whatsapp');
    if (consentFails) throw new Error('db down');
    return items.filter(item => !suppressed.has(item[key]));
  },
});

const { createScheduledJobHandlers, reengagementWindow } = require('../lib/scheduledJobHandlers');

function fakePool(leads) {
  const writes = [];
  return {
    writes,
    query: async (sql, params = []) => {
      const flat = String(sql).replace(/\s+/g, ' ');
      if (/FROM leads/.test(flat) && /^\s*SELECT/.test(flat)) {
        assert.match(flat, /COALESCE\(is_unsubscribed,0\)=0/, 'an erased lead is never picked');
        return [leads];
      }
      writes.push({ sql: flat, params });
      return [{ affectedRows: 1 }];
    },
  };
}
const quiet = { info() {}, warn() {} };
const LEADS = [
  { id: 'lead-1', tenant_id: 't1', name: 'منى', phone: '01011111111' },
  { id: 'lead-2', tenant_id: 't1', name: 'هالة', phone: '01022222222' },
  { id: 'lead-3', tenant_id: 't2', name: 'سارة', phone: '01033333333' },
];

test('the re-engagement message is a queued marketing message, one per lead per 30 days', async () => {
  queued.length = 0;
  suppressed = new Set();
  consentFails = false;
  const pool = fakePool(LEADS);
  await createScheduledJobHandlers({ pool, logger: quiet }).leadRetargeting();
  assert.equal(queued.length, 3);
  const window = reengagementWindow();
  for (const [index, message] of queued.entries()) {
    assert.equal(message.channel, 'whatsapp');
    assert.equal(message.payload.category, 'marketing', 'its own kind, never reminder');
    assert.equal(message.dedupeKey, `lead-reengagement:${LEADS[index].id}:${window}`);
    assert.equal(message.tenantId, LEADS[index].tenant_id);
    assert.match(message.recipient, /^2010/);
    assert.match(message.payload.message, /ابعت «ستوب» أو STOP\.$/, 'every promotion says how to stop it');
  }
  assert.equal(pool.writes.filter(write => /retargeting_log/.test(write.sql) && write.params.includes('QUEUED')).length, 3);
  // A window is 30 days: the same lead asked about again inside it gets the
  // same key, which the outbox's unique index turns into nothing new.
  const day = 24 * 3600000;
  const start = window * 30 * day;
  assert.equal(reengagementWindow(start + 29 * day), window);
  assert.equal(reengagementWindow(start + 30 * day), window + 1);
});

test('a number that wrote «ستوب» is skipped — and marked, so it does not block the others', async () => {
  queued.length = 0;
  suppressed = new Set(['01022222222']);
  consentFails = false;
  const pool = fakePool(LEADS);
  await createScheduledJobHandlers({ pool, logger: quiet }).leadRetargeting();
  assert.deepEqual(queued.map(message => message.refId), ['lead-1', 'lead-3']);
  const skipped = pool.writes.filter(write => write.params.includes('lead-2'));
  assert.ok(skipped.some(write => /UPDATE leads SET retargeting_sent_at=NOW\(\)/.test(write.sql)));
  assert.ok(skipped.some(write => /retargeting_log/.test(write.sql) && write.params.includes('SKIPPED')));
});

test('an opt-out list that cannot be read sends nothing', async () => {
  queued.length = 0;
  consentFails = true;
  const pool = fakePool(LEADS);
  await createScheduledJobHandlers({ pool, logger: quiet }).leadRetargeting();
  assert.equal(queued.length, 0);
  assert.equal(pool.writes.length, 0, 'and nobody is marked as reached');
  consentFails = false;
});

test('the pending-payment reminder is queued once a day per payment, as a reminder', async () => {
  queued.length = 0;
  const pool = {
    query: async sql => (/FROM payments p/.test(sql)
      ? [[{ id: 'pay-1', tenant_id: 't1', amount: 500, currency: 'EGP', date: '2026-10-01', name: 'منى', phone: '01011111111' }]]
      : [[]]),
  };
  const notification = require.resolve('../lib/notification');
  require.cache[notification] = { id: notification, filename: notification, loaded: true, exports: { createNotification: async () => {} } };
  delete require.cache[require.resolve('../lib/scheduledJobHandlers')];
  const fresh = require('../lib/scheduledJobHandlers');
  await fresh.createScheduledJobHandlers({ pool, logger: quiet }).pendingPaymentReminder();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].payload.category, 'reminder');
  assert.match(queued[0].dedupeKey, /^pending-payment-reminder:pay-1:\d{4}-\d{2}-\d{2}$/);
});

test('the scheduled jobs no longer send WhatsApp themselves', () => {
  const source = require('node:fs').readFileSync(require.resolve('../lib/scheduledJobHandlers'), 'utf8');
  assert.doesNotMatch(source, /sendWhatsApp\(/);
  assert.doesNotMatch(source, /installmentSentToday/, 'the in-memory Set a restart emptied is gone');
  assert.match(source, /dedupeKey: `installment-reminder:\$\{subscriber\.id\}:\$\{dueDate\}:\$\{plan\.courseId \|\| ''\}`/);
});
