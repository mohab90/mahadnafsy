'use strict';
/**
 * «لازم يوصل اشعار مهم بان عميل بعت رساله دلوقتي بمشكله … انا بجرب وانا فاتح الرساله ومع ذلك عمل كدا
 * الشات مقفول — العميل مش فاتحه دلوقتي. ليه؟ هو مكنش مقفول؟» (16 Oct 2026).
 *
 * Two causes behind «closed while I have it open»: presence was a dashboard-wide beat matched to the
 * ticket through the e-mail (a minute apart, none from a background tab), and the staff screen
 * looked again only for the open/closed flag. The conversation now reports in itself, a client who
 * has just written counts as there, and the staff drawer refreshes the state and the thread.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.RATE_LIMIT_REDIS_ENABLED = 'false';
const { clientChatState } = require('../lib/ticketChat');
const { onlineMap } = require('../lib/onlineUsers');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const ticket = { id: 'tk-1', subscriber_id: null, subscriber_email: null };

const dbWith = ({ presenceAge = null, wroteAge = null }) => ({
  async query(sql) {
    const flat = String(sql).replace(/\s+/g, ' ');
    if (/FROM ticket_chat_presence/.test(flat)) return [[presenceAge === null ? undefined : { age: presenceAge }]];
    if (/FROM ticket_replies/.test(flat)) return [[{ age: wroteAge }]];
    return [[]];
  },
});

test('the chat is open while the client\'s conversation is open on their screen — no account lookup needed', async () => {
  onlineMap.clear();
  const open = await clientChatState(dbWith({ presenceAge: 12 }), 't', ticket);
  assert.equal(open.open, true);
  assert.ok(open.lastSeen <= Date.now());
  // Away for two minutes: closed, and it says when they were last here.
  const away = await clientChatState(dbWith({ presenceAge: 120 }), 't', ticket);
  assert.equal(away.open, false);
  assert.equal(away.reason, 'offline');
  assert.ok(away.lastSeen && away.lastSeen < Date.now() - 100_000, 'the last time they were here is given');
});

test('a client who wrote a minute ago is there; one who wrote an hour ago is not', async () => {
  onlineMap.clear();
  assert.equal((await clientChatState(dbWith({ wroteAge: 60 }), 't', ticket)).open, true);
  assert.equal((await clientChatState(dbWith({ wroteAge: 3600 }), 't', ticket)).open, false);
});

test('a ticket with no account and no sign of the client stays «no account»', async () => {
  onlineMap.clear();
  assert.equal((await clientChatState(dbWith({}), 't', ticket)).reason, 'no_account');
});

test('the client\'s open conversation reports in, and what they write rings customer service', () => {
  const support = read('api/routes/support.js');
  const detail = support.slice(support.indexOf("router.get('/api/me/tickets/:id'"), support.indexOf("router.post('/api/me/tickets/:id/reply'"));
  assert.match(detail, /req\.query\.live === '1'[\s\S]{0,120}markConversationOpen/, 'only ?live=1 counts as the chat being open');
  for (const route of ["router.post('/api/me/tickets'", "router.post('/api/me/tickets/:id/reply'", "router.post('/api/public/enquiry/:token/reply'", "router.post('/api/public/enquiry'"]) {
    const from = support.indexOf(route);
    assert.ok(from > 0, route);
    const body = support.slice(from, from + 5500);
    assert.match(body, /notifyClientMessage\(/, `${route} rings customer service`);
  }

  const alerts = read('api/lib/ticketAlerts.js');
  assert.match(alerts, /'ticket_client_message'/);
  assert.match(alerts, /coalesceMinutes: 2/, 'a burst from one person is one line with a count');
  assert.match(read('api/lib/notificationAudience.js'), /ticket_client_message: \{ perms: \[\], roles: \['support'\] \}/);
  assert.match(read('admin/pages/dashboard/NotificationsBell.tsx'), /ticket_client_message: \{[^}]*severity: 'critical'/, 'it reads as important in the bell');
});

test('the client\'s conversation refreshes itself, and the staff drawer refreshes the state and the thread', () => {
  const client = read('client/components/student-dashboard/StudentSupportTab.tsx');
  assert.match(client, /\?live=1/);
  assert.match(client, /useVisibleInterval\(\(\) => \{ void refreshThread\(\); \}, 10_000/);
  const staff = read('admin/pages/dashboard/tabs/CustomerInboxTab.tsx');
  assert.match(staff, /useVisibleInterval\(refreshChat, 10000/);
  assert.match(staff, /setChatLastSeen/);
  assert.match(staff, /اتأكد تاني/);
});
