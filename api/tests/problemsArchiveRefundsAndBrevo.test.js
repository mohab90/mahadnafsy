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

test('the inbox shows only work in hand; every old problem is in the archive and nothing is deleted', () => {
  const server = read('api/routes/support.js');
  assert.match(server, /const archive = String\(req\.query\.archive \|\| ''\) === '1'/);
  assert.match(server, /if \(archive\) where\.push\(`t\.status IN \('resolved','closed'\)`\)/);
  assert.match(server, /else if \(status === 'open' \|\| !status\) where\.push\(`t\.status IN \('open','in_progress'\)`\)/, 'the default list is the open ones only');
  assert.match(server, /archiveCount/);

  const screen = read('admin/pages/dashboard/tabs/CustomerInboxTab.tsx');
  assert.match(screen, /أرشيف المشاكل/);
  assert.match(screen, /params\.set\('archive', '1'\)/);
  assert.match(screen, /role="tab"/);
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
  assert.match(migration, /ticket_history/);
  assert.match(migration, /refund_request_id/);
});

test('the refunds list says a history exists but does not ship it for every row', () => {
  const route = read('api/routes/finance/refunds.js');
  assert.match(route, /AS has_ticket_history/);
  assert.match(route, /const \{ ticket_history: _history, \.\.\.rest \} = row/);
});

test('the refunds screen keeps its actions in view: small icons, a menu that is not clipped', () => {
  const panel = read('admin/pages/dashboard/tabs/financial/FinancialRefundsPanel.tsx');
  assert.match(panel, /h-7 w-7/, 'icon buttons');
  assert.match(panel, /role="menu" style=\{\{ top: menuAt\.top, left: menuAt\.left \}\}/, 'the result menu is positioned in the page layer');
  assert.match(panel, /sticky left-0/, 'the action cell stays visible when the list scrolls');
  assert.doesNotMatch(panel, /<th className=\{th\}>إجراءات<\/th>[\s\S]{0,40}<th/, 'the actions are the last column');
  assert.match(panel, /ticket-history/);
});

test('a managed mail relay (Brevo) is accepted as a sender, and port 587 is upgraded or refused', () => {
  const email = require('../lib/email');
  assert.equal(email.isManagedRelay('smtp-relay.brevo.com'), true);
  assert.equal(email.isManagedRelay('smtp-relay.sendinblue.com'), true);
  assert.equal(email.isManagedRelay('smtp.hostinger.com'), false);
  assert.equal(email.isManagedRelay('evilbrevo.com'), false, 'only the provider\'s own domain');
  assert.equal(email.isManagedRelay(''), false);
  assert.match(read('api/lib/email.js'), /requireTLS: port === 587/);
  assert.match(read('api/routes/config.js'), /isManagedRelay\(next\.smtpHost\)/);
});
