'use strict';

// Is the client there to read a reply?
//
// «مفتوح شات للخدمة العملاء يبعتوا للعميل والعميل اصلا مش موجود او قفل … محتاجين الشات
// يكون مفتوح وقت ما العميل يكون فاتح الشات وهيتقبل رسالة، غير كدا مقفول ونستبدله بزر
// واتس اب وزر تواصل» (14 Oct 2026). The client's dashboard sends a heartbeat while it is
// open (POST /api/me/heartbeat → lib/onlineUsers.js); a chat is open for as long as the
// client's account has one in the last two minutes.

const { listOnlineUsers } = require('./onlineUsers');

const CHAT_WINDOW_MS = 2 * 60 * 1000;

/** The accounts a ticket's client signs in with: by the ticket's e-mail, else the client file's. */
async function accountIdsOf(db, tenantId, ticket) {
  const emails = new Set();
  const uids = new Set();
  if (ticket.subscriber_email) emails.add(String(ticket.subscriber_email).toLowerCase().trim());
  if (ticket.subscriber_id) {
    const [[sub]] = await db.query('SELECT email, firebase_uid FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [ticket.subscriber_id, tenantId]);
    if (sub?.email) emails.add(String(sub.email).toLowerCase().trim());
    if (sub?.firebase_uid) uids.add(String(sub.firebase_uid));
  }
  if (emails.size) {
    const [users] = await db.query('SELECT id FROM users WHERE tenant_id=? AND LOWER(TRIM(email)) IN (?) LIMIT 5', [tenantId, [...emails]]);
    for (const user of users) uids.add(String(user.id));
  }
  return uids;
}

/**
 * { open, lastSeen, reason } — open when one of the client's accounts was seen within the window;
 * otherwise `reason` says why it is closed: no_account (nothing to chat with) or offline.
 */
async function clientChatState(db, tenantId, ticket) {
  if (!ticket) return { open: false, lastSeen: null, reason: 'no_account' };
  const uids = await accountIdsOf(db, tenantId, ticket);
  if (!uids.size) return { open: false, lastSeen: null, reason: 'no_account' };
  const online = await listOnlineUsers(tenantId, CHAT_WINDOW_MS);
  const seen = online.filter(user => uids.has(String(user.uid))).map(user => user.lastSeen);
  return seen.length ? { open: true, lastSeen: Math.max(...seen), reason: null } : { open: false, lastSeen: null, reason: 'offline' };
}

module.exports = { clientChatState, CHAT_WINDOW_MS };
