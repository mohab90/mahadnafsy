'use strict';
/**
 * «الشات يكون مفتوح وقت ما العميل يكون فاتح الشات … غير كدا مقفول ونستبدله بزر واتس وتواصل»
 * (14 Oct 2026).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.RATE_LIMIT_REDIS_ENABLED = 'false';
const { setOnlineUser, onlineMap } = require('../lib/onlineUsers');
const { clientChatState } = require('../lib/ticketChat');

const db = {
  async query(sql) {
    const flat = String(sql).replace(/\s+/g, ' ');
    if (/FROM subscribers/.test(flat)) return [[{ email: 'Client@Example.com', firebase_uid: null }]];
    if (/FROM users/.test(flat)) return [[{ id: 'u-1' }]];
    return [[]];
  },
};
const ticket = { subscriber_id: 's-1', subscriber_email: null };

test('the chat is open while the client\'s account is on the site, closed otherwise', async () => {
  onlineMap.clear();
  assert.equal((await clientChatState(db, 't', ticket)).open, false, 'nobody is there');
  await setOnlineUser('t', 'u-1', { name: 'عميل', email: 'client@example.com' });
  assert.equal((await clientChatState(db, 't', ticket)).open, true);
  onlineMap.get('t:u-1').lastSeen = Date.now() - 3 * 60 * 1000;
  assert.equal((await clientChatState(db, 't', ticket)).open, false, 'gone for three minutes');
  onlineMap.clear();
});

test('a client with no account is never in the chat', async () => {
  onlineMap.clear();
  const nobody = { async query() { return [[]]; } };
  assert.equal((await clientChatState(nobody, 't', { subscriber_id: null, subscriber_email: null })).open, false);
});

test('staff can write in the chat only when it is open, and the drawer offers call and WhatsApp instead', () => {
  const support = fs.readFileSync(path.join(__dirname, '..', 'routes', 'support.js'), 'utf8');
  const reply = support.slice(support.indexOf("router.post('/api/admin/tickets/:id/reply'"));
  assert.ok(reply.indexOf('clientChatState') < reply.indexOf('INSERT INTO ticket_replies'));
  assert.match(reply, /CLIENT_NOT_IN_CHAT/);
  const tab = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'CustomerInboxTab.tsx'), 'utf8');
  assert.match(tab, /chatOpen \? \(/);
  assert.match(tab, /الشات مقفول/);
});
