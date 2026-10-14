'use strict';

// «خلي لما حد يحجز استشارة سريعة يبعتلي انا مسدج علي الواتس اب علي رقمي الادارة
// اللى بتعتلهم تقرير» (10 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');

const outboxed = [];
let reportSettings = {};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/outbox', { enqueue: async message => { outboxed.push(message); return 'id'; } });
stub('../lib/tenantSettings', { getTenantSetting: async () => reportSettings, setTenantSetting: async () => {} });

const { openConsultationRequest } = require('../lib/consultationRequests');
const db = { query: async sql => (/^SELECT id FROM consultations/.test(String(sql).trim()) ? [[]] : [{ affectedRows: 1 }]) };
const booking = source => ({ tenantId: 't', orderId: `o-${source}`, name: 'سارة أحمد', phone: '01012345678', email: 's@example.com', source, amount: 500, currency: 'EGP' });

test('an express booking tells the numbers the daily report goes to', async () => {
  reportSettings = { phones: ['01000000001', '01000000002'] };
  outboxed.length = 0;
  await openConsultationRequest(db, booking('site_express'));
  assert.deepEqual(outboxed.map(m => m.recipient), ['01000000001', '01000000002']);
  assert.equal(outboxed[0].payload.category, 'staff_alert', 'a message to the institute\'s own management, never held back as marketing');
  assert.match(outboxed[0].payload.message, /حجز استشارة سريعة جديد[\s\S]*سارة أحمد[\s\S]*01012345678[\s\S]*500 EGP/);
  assert.match(outboxed[0].dedupeKey, /^express-consultation:t:/);
});

test('a regular booking, or no report numbers, sends nothing', async () => {
  reportSettings = { phones: ['01000000001'] };
  outboxed.length = 0;
  await openConsultationRequest(db, booking('site_regular'));
  assert.equal(outboxed.length, 0);
  reportSettings = {};
  await openConsultationRequest(db, booking('site_express'));
  assert.equal(outboxed.length, 0);
});
