'use strict';
/**
 * Facebook Messenger — the Page inbox.
 *
 * Two things about Messenger shape everything built on it, and getting them
 * wrong produces a feature that looks finished and fails in production:
 *
 * 1. You cannot address a person by phone or email. Messenger only knows a PSID
 *    (page-scoped id) which is issued the first time *they* message the page.
 *    So Messenger is a reply channel, never an outbound prospecting one — there
 *    is no such thing as a Messenger blast to people who have not written in.
 *
 * 2. Outside 24 hours from the customer's last message, a plain text reply is
 *    rejected. Only specific message tags are allowed after that. The window is
 *    tracked here so the UI can say "this conversation has gone cold" rather
 *    than letting an agent type a reply that silently fails.
 *
 * A Page has one inbox, so unlike WhatsApp there is no per-employee Messenger:
 * it is a shared inbox with assignment.
 */
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { createNotification } = require('./notification');
const { upsertThread, recordOnThread } = require('./inboxThreads');
const logger = require('./logger');

/**
 * Instagram Direct rides the same Messenger Platform: the same webhook (object
 * 'instagram' instead of 'page'), the same send endpoint and the page's own
 * token, an Instagram-scoped id in place of the PSID. What differs is only
 * where the id and the reply window live on the lead and how the timeline
 * labels the message.
 */
const PLATFORM = {
  messenger: {
    idColumn: 'messenger_psid', windowColumn: 'messenger_last_inbound_at', type: 'MESSENGER',
    idPrefix: 'msgr:', source: 'messenger_inbound', visitor: 'زائر ماسنجر',
    newTitle: '🆕 زائر جديد كلّمنا على الماسنجر', title: 'رسالة ماسنجر جديدة', empty: '(رسالة ماسنجر بدون نص)',
  },
  instagram: {
    idColumn: 'instagram_id', windowColumn: 'instagram_last_inbound_at', type: 'INSTAGRAM',
    idPrefix: 'ig:', source: 'instagram_inbound', visitor: 'زائر انستجرام',
    newTitle: '🆕 زائر جديد كلّمنا على الانستجرام', title: 'رسالة انستجرام جديدة', empty: '(رسالة انستجرام بدون نص)',
  },
};

const GRAPH = 'https://graph.facebook.com/v19.0';
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} psid       page-scoped recipient id
 * @param {object} credentials { pageAccessToken, pageId }
 */
async function sendMessengerMessage(psid, text, credentials = {}) {
  const token = credentials.pageAccessToken || credentials.accessToken;
  if (!token) return { ok: false, provider: 'messenger', reason: 'not_configured' };
  if (!psid) return { ok: false, provider: 'messenger', reason: 'invalid_recipient' };

  const response = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: psid },
      // RESPONSE is the only type valid inside the 24h window without a tag.
      messaging_type: 'RESPONSE',
      message: { text: String(text || '').slice(0, 2000) },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    logger.warn('[Messenger] send failed', data);
    return { ok: false, provider: 'messenger', reason: data };
  }
  return { ok: true, provider: 'messenger', idMessage: data.message_id };
}

/**
 * Prove the page credentials work, without messaging anybody.
 *
 * WhatsApp channels verify themselves by sending a test message. Messenger
 * cannot: it has no addressable recipient until someone writes in first. So
 * without this a Messenger channel could never leave 'pending' — and since
 * sending requires 'connected', it could never send at all. Asking Graph who
 * the token belongs to is the honest equivalent.
 *
 * @returns {Promise<{ok: boolean, pageName?: string, pageId?: string, reason?: any}>}
 */
async function verifyMessengerCredentials(credentials = {}) {
  const token = credentials.pageAccessToken || credentials.accessToken;
  if (!token) return { ok: false, reason: 'not_configured' };
  try {
    const response = await fetch(
      `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(Number(process.env.MESSENGER_TIMEOUT_MS || 8000)) }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.id) {
      logger.warn('[Messenger] credential check failed', data);
      return { ok: false, reason: data?.error?.message || data };
    }
    // A user token would also answer here, so confirm the configured page is the
    // one the token actually belongs to — otherwise replies would silently go
    // out from a different page.
    if (credentials.pageId && String(credentials.pageId) !== String(data.id)) {
      return { ok: false, reason: 'التوكن ده مش بتاع الصفحة المحددة' };
    }
    const subscription = await subscribePageToApp(data.id, token);
    return {
      ok: true, pageId: data.id, pageName: data.name,
      subscribed: subscription.ok, subscribedFields: subscription.fields || null, subscribeError: subscription.reason || null,
    };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

/**
 * Subscribe the page to the app, so Meta sends its messages (and its Lead Ads)
 * to the webhook. Connecting checked the token and stopped there: the Messenger
 * channel connected on 7 Oct 2026 read «متصل» and not one message reached the
 * system — a page sends nothing to an app it is not subscribed to. leadgen
 * needs a permission a page token may not carry, so messages alone are asked
 * for when the fuller request is refused.
 */
async function subscribePageToApp(pageId, token) {
  let reason = null;
  for (const fields of ['messages,messaging_postbacks,leadgen', 'messages,messaging_postbacks']) {
    try {
      const response = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ subscribed_fields: fields, access_token: token }).toString(),
        signal: AbortSignal.timeout(Number(process.env.MESSENGER_TIMEOUT_MS || 8000)),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.success) return { ok: true, fields };
      reason = data?.error?.message || `HTTP ${response.status}`;
    } catch (error) {
      reason = error.message;
    }
  }
  logger.warn('[Messenger] page subscription failed', { pageId, reason });
  return { ok: false, reason };
}

/**
 * Is this conversation still repliable with plain text?
 * @param {Date|string|null} lastInboundAt
 */
function isWithinReplyWindow(lastInboundAt) {
  if (!lastInboundAt) return false;
  const at = new Date(lastInboundAt).getTime();
  return Number.isFinite(at) && Date.now() - at < REPLY_WINDOW_MS;
}

/** Messenger (or Instagram) webhook body → the messages in it. */
function extractMessengerMessages(payload) {
  const platform = payload?.object === 'page' ? 'messenger' : payload?.object === 'instagram' ? 'instagram' : null;
  if (!platform) return [];
  return (payload.entry || []).flatMap(entry =>
    (entry.messaging || [])
      // Echoes are the page's own outbound messages coming back; recording them
      // would duplicate every reply an agent sends.
      .filter(event => event.message && !event.message.is_echo)
      .map(event => ({
        platform,
        providerMessageId: event.message.mid,
        psid: event.sender?.id,
        pageId: entry.id,
        body: event.message.text || ((event.message.attachments || []).length ? '📎 مرفق' : ''),
        // Messenger timestamps are milliseconds; WhatsApp's are seconds.
        timestamp: event.timestamp ? Math.floor(event.timestamp / 1000) : null,
        attachments: (event.message.attachments || []).length,
      }))
  );
}

/**
 * Turn a first Messenger contact into a lead.
 *
 * Assigned through the same round-robin the public forms and WhatsApp use, so
 * it lands in a queue somebody owns. The PSID is stored as the identity because
 * it is the only one Messenger provides — the name is a placeholder until a rep
 * asks, which is the natural first thing they will do anyway.
 *
 * @returns {Promise<{id, name, assigned_sales_id}|null>}
 */
async function createLeadFromMessenger({ tenantId, psid, text, platform = 'messenger' }, db = pool) {
  const { getNextSalesRep } = require('./leadAssignment');
  const p = PLATFORM[platform];
  const id = uuidv4();
  const name = p.visitor;
  try {
    const rep = await getNextSalesRep(tenantId, db, {
      lead: { source: p.source, courseIds: [] },
    }).catch(() => null);
    // Column names come from PLATFORM above, never from the request.
    const [result] = await db.query(
      `INSERT INTO leads
         (id, tenant_id, name, source, status, notes, ${p.idColumn},
          ${p.windowColumn}, assigned_sales_id, assigned_sales_name, hidden, created_at)
       VALUES (?,?,?,?, 'new', ?, ?, NOW(), ?, ?, 0, NOW())`,
      [id, tenantId, name, p.source, String(text || '').slice(0, 500) || null, psid,
       rep?.id || null, rep?.name || null]
    );
    if (!result.affectedRows) return null;
    logger.info('[messenger] created a lead from a first contact');
    return { id, name, assigned_sales_id: rep?.id || null };
  } catch (error) {
    // uq_leads_tenant_psid: two messages arriving together race here, and the
    // loser should adopt the row the winner made rather than fail.
    logger.warn('[messenger] lead creation failed, re-checking', error.message);
    const [[existing]] = await db.query(
      `SELECT id, name, assigned_sales_id FROM leads
        WHERE tenant_id=? AND ${p.idColumn}=? AND hidden=0 LIMIT 1`,
      [tenantId, psid]
    );
    return existing || null;
  }
}

/**
 * Record an inbound Messenger message against a lead or subscriber.
 *
 * A first contact creates the lead, so the conversation always has a CRM record
 * to hang from and always appears in someone's pipeline. The PSID is the link:
 * every later message on it lands on the same lead automatically, and a human
 * can merge it into an existing customer from the inbox once they know who it
 * is.
 */
// `quiet`: a message read back from the page's history (lib/pageAudience.js) —
// filed the same way, but nobody is notified and the bot does not answer it.
async function recordInboundMessenger({ tenantId, channelId, providerMessageId, psid, body, timestamp, platform = 'messenger', quiet = false }, db = pool) {
  if (!providerMessageId || !psid) return { recorded: false, reason: 'incomplete' };
  const p = PLATFORM[platform];
  if (!p) return { recorded: false, reason: 'unknown_platform' };
  const text = String(body || '').slice(0, 4000).trim();

  let [[lead]] = await db.query(
    `SELECT id, name, assigned_sales_id FROM leads
      WHERE tenant_id=? AND ${p.idColumn}=? AND hidden=0 LIMIT 1`,
    [tenantId, psid]
  );

  // Someone writing to the page is a lead, exactly as on WhatsApp. Until this
  // existed, a Messenger conversation had no CRM record at all: the message was
  // stored with lead_id NULL, so it never appeared on anyone's pipeline and the
  // rep had nothing to follow up.
  //
  // Unlike WhatsApp there is no phone to store — Messenger only ever gives a
  // page-scoped id — so the PSID is the identity, and the reply goes back
  // through the same conversation.
  let isNewLead = false;
  if (!lead) {
    lead = await createLeadFromMessenger({ tenantId, psid, text, platform }, db);
    isNewLead = Boolean(lead);
  }

  const id = uuidv4();
  const at = timestamp ? new Date(Number(timestamp) * 1000) : new Date();
  const when = Number.isFinite(at.getTime()) ? at : new Date();

  const [result] = await db.query(
    `INSERT IGNORE INTO communications
       (id, tenant_id, lead_id, type, direction, provider_message_id, channel_id,
        date, notes, outcome, staff_id, created_at)
     VALUES (?,?,?,?, 'IN', ?, ?, ?, ?, ?, ?, NOW())`,
    [
      id, tenantId, lead?.id || null, p.type,
      `${p.idPrefix}${providerMessageId}`, channelId || null, when,
      text || p.empty,
      // The PSID is kept on the row itself so messages that arrived before
      // anyone knew who this was can be adopted onto the lead the moment a
      // human makes the link. Without it those messages stay orphaned forever.
      JSON.stringify({ psid: String(psid) }),
      lead?.assigned_sales_id || null,
    ]
  );
  if (!result.affectedRows) return { recorded: false, reason: 'duplicate' };

  // The reply window starts at the customer's last message.
  if (lead?.id) {
    await db.query(`UPDATE leads SET ${p.windowColumn}=?, updated_at=updated_at WHERE tenant_id=? AND id=?`,
      [when, tenantId, lead.id]).catch(() => {});
  }

  let owner = lead?.assigned_sales_id || null;
  let threadId = null;
  try {
    const thread = await upsertThread(db, {
      tenantId, platform, contactKey: psid, channelId: channelId || null,
      leadId: lead?.id || null, contactName: lead?.name || null, ownerStaffId: lead?.assigned_sales_id || null,
    });
    await recordOnThread(db, { tenantId, threadId: thread.id, communicationId: id, direction: 'IN', text, at: when });
    owner = thread.assigned_staff_id || owner;
    threadId = thread.id;
  } catch (error) {
    logger.warn('[messenger] team inbox update failed', error.message);
  }

  // A number written in the chat goes on the lead, so WhatsApp can reach them.
  if (lead?.id && !quiet) {
    await require('./pageAudience').capturePhone(db, { tenantId, leadId: lead.id, text })
      .catch(error => logger.warn('[messenger] phone capture failed', error.message));
  }

  if (!quiet) await createNotification(
    platform,
    isNewLead ? p.newTitle : p.title,
    `${lead?.name || 'زائر'}: ${text.slice(0, 120) || 'رسالة'}`,
    { leadId: lead?.id || null, psid, communicationId: id },
    tenantId,
    owner
  );

  // The inbox bot answers a few seconds later when it is on (lib/inboxBot.js).
  // Required here, not at the top: inboxBot requires this file to send.
  if (threadId && !quiet) require('./inboxBot').scheduleBotReply({ tenantId, threadId, inboundAt: when });

  return { recorded: true, id, leadId: lead?.id || null, matched: Boolean(lead), createdLead: isNewLead };
}

module.exports = {
  PLATFORM,
  REPLY_WINDOW_MS,
  verifyMessengerCredentials,
  subscribePageToApp,
  sendMessengerMessage,
  isWithinReplyWindow,
  extractMessengerMessages,
  recordInboundMessenger,
};
