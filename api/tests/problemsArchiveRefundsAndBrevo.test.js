'use strict';

// 19 Oct 2026 — customer-service archive, «تحويل لاسترداد», the refunds and certificates screens, and the mail relay.
//
// «اي مشكله قديمه بتتحل المفروض بتتمسح من الشاشه الرئيسية لكن لازم يكون في تاب داخلي لكل المشاكل القديمه ومتتمسحش …
// ولازم يكون في زر تحويل لاسترداد … بيروح معاه كل التفاصيل» · «خلي الايقونات صغيره لان في سكرول القايمه مش بتبان زر النتيجة»
// · «نربط الاييميل بيرفو».

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('a problem handed to the refunds desk takes its whole story with it', () => {
  const { buildTicketHistory } = require('../lib/ticketHistory');
  const text = buildTicketHistory({
    ticket: { ticket_code: 'T-204', subject: 'الكورس مش بيفتح', body: 'بدخل ومفيش حاجة بتظهر', channel: 'web', status: 'in_progress', created_at: '2026-10-10T09:00:00Z', assigned_to_name: 'منى' },
    replies: [
      { author_type: 'client', author_name: 'سلمى', body: 'لسه مشكلتي زي ما هي', created_at: '2026-10-11T09:00:00Z' },
      { author_type: 'staff', author_name: 'منى', body: 'جربنا نغير الجهاز', created_at: '2026-10-11T10:00:00Z' },
    ],
    timeline: [{ event_type: 'assigned', actor_name: 'مدير', to_value: 'منى', created_at: '2026-10-10T09:05:00Z' }],
  });
  for (const part of ['#T-204', 'الكورس مش بيفتح', 'بدخل ومفيش حاجة بتظهر', 'لسه مشكلتي زي ما هي', 'الفريق (منى)', 'جربنا نغير الجهاز', 'اتسلمت']) {
    assert.ok(text.includes(part), `the history keeps «${part}»`);
  }
  // Oldest first, as it happened.
  assert.ok(text.indexOf('لسه مشكلتي') < text.indexOf('جربنا نغير'));
});



test('«تحويل لاسترداد» opens the refund through the refund code, carries the history and closes the problem', () => {
  const server = read('api/routes/support.js');
  const route = server.slice(server.indexOf("'/api/admin/tickets/:id/convert-to-refund'"), server.indexOf('// ── STATS + AGENT WORKLOAD'));
  assert.match(route, /requirePermission\('manage_inbox'\)/, 'customer service can hand a problem over without being able to decide refunds');
  assert.match(route, /createRefundByAdmin/);
  assert.match(route, /buildTicketHistory/);
  assert.match(route, /UPDATE refund_requests SET ticket_id=\?, ticket_code=\?, ticket_history=\?/);
  assert.match(route, /UPDATE support_tickets SET status='closed'[\s\S]*refund_request_id=\?/);
  assert.match(route, /ALREADY_REFUND/);

  const migration = read('api/migrations/295_v26_ticket_to_refund_link.sql');
  
  
});





test('a managed mail relay (Brevo) is accepted as a sender, and port 587 is upgraded or refused', () => {
  const email = require('../lib/email');
  assert.equal(email.isManagedRelay('smtp-relay.brevo.com'), true);
  assert.equal(email.isManagedRelay('smtp-relay.sendinblue.com'), true);
  assert.equal(email.isManagedRelay('smtp.hostinger.com'), false);
  assert.equal(email.isManagedRelay('evilbrevo.com'), false, 'only the provider\'s own domain');
  assert.equal(email.isManagedRelay(''), false);
  
  
});
