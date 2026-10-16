'use strict';

// Is the client there to read a reply?
//
// «مفتوح شات للخدمة العملاء يبعتوا للعميل والعميل اصلا مش موجود او قفل … محتاجين الشات
// يكون مفتوح وقت ما العميل يكون فاتح الشات وهيتقبل رسالة، غير كدا مقفول ونستبدله بزر
// واتس اب وزر تواصل» (14 Oct 2026). The client's dashboard sends a heartbeat while it is
// open (POST /api/me/heartbeat → lib/onlineUsers.js); a chat is open for as long as the
// client's account has one in the last two minutes.

const { listOnlineUsers } = require('./onlineUsers');

// The conversation reports in every ~10 seconds while it is open on the client's
// screen (ticket_chat_presence); a minute without one and the client has left.
const CHAT_WINDOW_MS = 2 * 60 * 1000;
const CONVERSATION_WINDOW_MS = 60 * 1000;
// A client who has just written is plainly there, whatever the beats say.
const JUST_WROTE_MS = 5 * 60 * 1000;

/** The client's conversation is open on their screen: written by the client's own ticket calls. */
async function markConversationOpen(db, tenantId, ticketId) {
  await db.query(
    `INSERT INTO ticket_chat_presence (tenant_id, ticket_id, seen_at) VALUES (?,?,NOW())
     ON DUPLICATE KEY UPDATE seen_at=NOW()`,
    [tenantId, ticketId]
  );
}

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
 * { open, lastSeen, reason } — open when the client has this ticket's conversation open, wrote in it
 * minutes ago, or is on their dashboard; otherwise `reason` says why it is closed: no_account (nothing
 * to chat with) or offline (with `lastSeen`, the last time they were seen, when known).
 */
async function clientChatState(db, tenantId, ticket) {
  if (!ticket) return { open: false, lastSeen: null, reason: 'no_account' };
  const now = Date.now();

  // 1. The conversation itself says it is open (and this needs no account lookup at all).
  let conversationSeen = null;
  const [[presence]] = await db.query(
    'SELECT TIMESTAMPDIFF(SECOND, seen_at, NOW()) AS age FROM ticket_chat_presence WHERE tenant_id=? AND ticket_id=? LIMIT 1',
    [tenantId, ticket.id]
  ).catch(() => [[null]]);
  if (presence && presence.age !== null) {
    conversationSeen = now - Number(presence.age) * 1000;
    if (Number(presence.age) * 1000 <= CONVERSATION_WINDOW_MS) return { open: true, lastSeen: conversationSeen, reason: null };
  }

  // 2. They have just written in it.
  const [[wrote]] = await db.query(
    `SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), NOW()) AS age FROM ticket_replies
      WHERE tenant_id=? AND ticket_id=? AND author_type='CLIENT'`,
    [tenantId, ticket.id]
  ).catch(() => [[null]]);
  if (wrote && wrote.age !== null && Number(wrote.age) * 1000 <= JUST_WROTE_MS) {
    return { open: true, lastSeen: now - Number(wrote.age) * 1000, reason: null };
  }

  // 3. Signed in on their dashboard (the general beat), matched through their account.
  const uids = await accountIdsOf(db, tenantId, ticket);
  if (!uids.size && !conversationSeen) return { open: false, lastSeen: null, reason: 'no_account' };
  const online = uids.size ? await listOnlineUsers(tenantId, CHAT_WINDOW_MS) : [];
  const seen = online.filter(user => uids.has(String(user.uid))).map(user => user.lastSeen);
  if (seen.length) return { open: true, lastSeen: Math.max(...seen), reason: null };
  return { open: false, lastSeen: conversationSeen, reason: 'offline' };
}

module.exports = { clientChatState, markConversationOpen, CHAT_WINDOW_MS, CONVERSATION_WINDOW_MS, JUST_WROTE_MS };
