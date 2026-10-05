'use strict';
/**
 * «اعمل اعاده ارسال لكل عملاء صفحتنا علي فيس بوك».
 *
 * Meta does not allow a page to message everyone who ever wrote to it: plain
 * messages only reach someone within 24 hours of their last message, message
 * tags are retired, and Marketing Messages are not offered for Egypt. What a
 * page *can* do — and what this module gives the team — is:
 *
 *   1. Bring the page's past conversations into the CRM (importPageHistory):
 *      every person who wrote becomes a lead with their conversation, so they
 *      are in the pipeline and in the team inbox.
 *   2. Turn a Messenger contact into a WhatsApp contact (findPhone): people
 *      write their number in the chat all the time. It is put on their lead,
 *      and WhatsApp campaigns (audience «ليدز» with source messenger_inbound)
 *      reach them with an approved template — and an opt-out.
 *   3. Message everyone whose 24-hour window is open now (messageOpenWindow) —
 *      allowed, and the warmest audience the page has.
 *   4. Export the numbers for a Facebook custom audience (audienceRows), next
 *      to the «people who messaged your page» audience Ads Manager builds.
 */
const logger = require('./logger').child({ module: 'page-audience' });
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { toDialable } = require('./phoneNumber');

const SOURCES = { messenger: 'messenger_inbound', instagram: 'instagram_inbound' };
const WINDOW_SQL = 'DATE_SUB(NOW(), INTERVAL 23 HOUR)'; // an hour short of 24, so a slow send still lands

const latin = value => String(value || '')
  .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0));

/**
 * The first phone number written in a message, as a dialable number, or ''.
 * «رقمي 01012345678», «+966 50 123 4567», «٠١٠١٢٣٤٥٦٧٨». A 14-digit national
 * id or an order number is not a phone and is not taken.
 */
function findPhone(text) {
  const source = latin(text);
  const candidates = source.match(/(?:\+|00)?\d[\d\s\-().]{7,17}\d/g) || [];
  for (const raw of candidates) {
    const digits = raw.replace(/[^\d+]/g, '');
    const bare = digits.replace(/^\+/, '').replace(/^00/, '');
    if (bare.length === 14 && /^[23]/.test(bare)) continue; // Egyptian national id
    if (bare.length < 10 || bare.length > 15) continue;
    // A local Egyptian mobile, or anything written with its country code.
    const local = /^01[0125]\d{8}$/.test(bare);
    const international = /^(\+|00)/.test(digits) || /^(20|966|971|965|974|973|968|962|961|212|213|216|218|249|1|44)\d{8,}/.test(bare);
    if (!local && !international) continue;
    const dialable = toDialable(raw);
    if (dialable) return dialable;
  }
  return '';
}

/**
 * Puts a number written in a Messenger/Instagram message on the lead, when the
 * lead has none. Never replaces a number someone already entered.
 * @returns {Promise<string>} the number saved, or ''
 */
async function capturePhone(db, { tenantId, leadId, text }) {
  if (!leadId) return '';
  const phone = findPhone(text);
  if (!phone) return '';
  const [result] = await db.query(
    `UPDATE leads SET phone=?, updated_at=NOW()
      WHERE tenant_id=? AND id=? AND (phone IS NULL OR phone='')`, [phone, tenantId, leadId]);
  return result.affectedRows ? phone : '';
}

/** How many people wrote to the page, and how many of them can be reached and how. */
async function audienceSummary(tenantId, db = pool) {
  const [rows] = await db.query(
    `SELECT t.platform,
            COUNT(*) AS contacts,
            SUM(t.last_inbound_at >= ${WINDOW_SQL}) AS window_open,
            SUM(COALESCE(NULLIF(l.phone,''), NULLIF(s.phone,'')) IS NOT NULL) AS with_phone,
            MIN(t.created_at) AS first_at
       FROM inbox_threads t
       LEFT JOIN leads l ON l.id = t.lead_id AND l.tenant_id = t.tenant_id
       LEFT JOIN subscribers s ON s.id = t.subscriber_id AND s.tenant_id = t.tenant_id
      WHERE t.tenant_id = ? AND t.platform IN ('messenger','instagram')
      GROUP BY t.platform`, [tenantId]);
  const out = {};
  for (const platform of ['messenger', 'instagram']) {
    const row = rows.find(r => r.platform === platform) || {};
    out[platform] = {
      contacts: Number(row.contacts) || 0,
      windowOpen: Number(row.window_open) || 0,
      withPhone: Number(row.with_phone) || 0,
      firstAt: row.first_at || null,
    };
  }
  return out;
}

/**
 * Read every past Messenger/Instagram message for a number the customer wrote,
 * and put it on their lead. For the conversations recorded before numbers were
 * picked up as they arrived.
 */
async function backfillPhones(tenantId, db = pool) {
  const [rows] = await db.query(
    `SELECT c.lead_id, c.notes
       FROM communications c
       JOIN leads l ON l.id = c.lead_id AND l.tenant_id = c.tenant_id
      WHERE c.tenant_id = ? AND c.type IN ('MESSENGER','INSTAGRAM') AND c.direction = 'IN'
        AND (l.phone IS NULL OR l.phone = '')
      ORDER BY c.date DESC LIMIT 20000`, [tenantId]);
  let found = 0;
  const done = new Set();
  for (const row of rows) {
    if (done.has(row.lead_id)) continue;
    if (await capturePhone(db, { tenantId, leadId: row.lead_id, text: row.notes })) { found += 1; done.add(row.lead_id); }
  }
  return { scanned: rows.length, found };
}

/** Everyone on Messenger/Instagram whose 24-hour window is open now. */
async function openWindowThreads(tenantId, platform, db = pool) {
  const [rows] = await db.query(
    `SELECT id, platform, contact_key, channel_id, lead_id, subscriber_id
       FROM inbox_threads
      WHERE tenant_id = ? AND platform = ? AND last_inbound_at >= ${WINDOW_SQL}
      ORDER BY last_inbound_at DESC LIMIT 500`, [tenantId, platform]);
  return rows;
}

/**
 * Send one message to everyone whose window is open. Paced, recorded on each
 * conversation, and {name} filled per person.
 */
async function messageOpenWindow({ tenantId, platform, text, staffId = null }, deps = {}) {
  const db = deps.db || pool;
  if (!SOURCES[platform]) throw Object.assign(new Error('المنصة لازم تكون ماسنجر أو انستجرام'), { statusCode: 400 });
  const body = String(text || '').trim().slice(0, 1800);
  if (!body) throw Object.assign(new Error('اكتب الرسالة'), { statusCode: 400 });
  const { sendMessengerMessage, PLATFORM } = require('./messenger');
  const { getSendableChannel } = require('./messagingChannels');
  const { recordOnThread } = require('./inboxThreads');
  const send = deps.send || sendMessengerMessage;
  const resolved = deps.credentials ? { row: { id: null }, credentials: deps.credentials }
    : await getSendableChannel({ tenantId, kind: 'messenger' }).catch(() => null);
  if (!resolved) throw Object.assign(new Error('صفحة الفيسبوك مش متصلة — اربطها من قنوات المراسلة'), { statusCode: 409 });

  const threads = await openWindowThreads(tenantId, platform, db);
  const names = new Map();
  const leadIds = threads.map(t => t.lead_id).filter(Boolean);
  if (leadIds.length) {
    const [leads] = await db.query('SELECT id, name FROM leads WHERE tenant_id=? AND id IN (?)', [tenantId, leadIds]);
    for (const lead of leads) names.set(lead.id, lead.name);
  }
  let sent = 0; let failed = 0;
  for (const thread of threads) {
    const name = String(names.get(thread.lead_id) || '').startsWith('زائر') ? '' : (names.get(thread.lead_id) || '').split(' ')[0];
    const message = body.replace(/\{name\}|\{الاسم\}/g, name).replace(/\s+([،,!.؟?])/g, '$1');
    const result = await send(thread.contact_key, message, resolved.credentials).catch(error => ({ ok: false, reason: error.message }));
    if (!result?.ok) { failed += 1; continue; }
    sent += 1;
    const now = new Date();
    const id = uuidv4();
    await db.query(
      `INSERT INTO communications
         (id, tenant_id, lead_id, subscriber_id, type, direction, provider_message_id, channel_id,
          thread_id, delivery_status, date, notes, outcome, staff_id, created_at)
       VALUES (?,?,?,?,?, 'OUT', ?, ?, ?, 'sent', ?, ?, 'BROADCAST', ?, NOW())`,
      [id, tenantId, thread.lead_id, thread.subscriber_id, PLATFORM[platform].type,
        result.idMessage ? `${PLATFORM[platform].idPrefix}${result.idMessage}` : null,
        resolved.row.id || thread.channel_id || null, thread.id, now, message, staffId]);
    await recordOnThread(db, { tenantId, threadId: thread.id, direction: 'OUT', text: message, at: now });
    if (!deps.noPause) await new Promise(resolve => setTimeout(resolve, 250));
  }
  return { audience: threads.length, sent, failed };
}

/** Name and number of everyone who wrote to the page and left a number. */
async function audienceRows(tenantId, db = pool) {
  const [rows] = await db.query(
    `SELECT l.name, l.phone, l.source, l.status, l.created_at
       FROM leads l
      WHERE l.tenant_id = ? AND l.source IN ('messenger_inbound','instagram_inbound')
        AND l.phone IS NOT NULL AND l.phone <> '' AND l.hidden = 0 AND l.deleted_at IS NULL
        AND COALESCE(l.is_unsubscribed, 0) = 0
      ORDER BY l.created_at DESC LIMIT 50000`, [tenantId]);
  return rows;
}

const GRAPH = 'https://graph.facebook.com/v19.0';

/**
 * The page's past conversations, into the CRM: each person a lead (by their
 * page-scoped id, the same key live messages use), each conversation a thread,
 * their recent messages on the timeline, and any number they wrote on the lead.
 * Re-running is safe: messages are keyed on Meta's id, people on their PSID.
 *
 * Needs the page token's pages_messaging and pages_read_engagement permissions.
 */
async function importPageHistory({ tenantId, platform = 'messenger', maxConversations = 300 }, deps = {}) {
  const db = deps.db || pool;
  const fetchImpl = deps.fetch || fetch;
  const { PLATFORM, recordInboundMessenger } = require('./messenger');
  const { getSendableChannel } = require('./messagingChannels');
  const { upsertThread, recordOnThread } = require('./inboxThreads');
  const resolved = deps.credentials ? { row: { id: null }, credentials: deps.credentials }
    : await getSendableChannel({ tenantId, kind: 'messenger' }).catch(() => null);
  const token = resolved?.credentials?.pageAccessToken || resolved?.credentials?.accessToken;
  const pageId = String(resolved?.credentials?.pageId || '');
  if (!token || !pageId) throw Object.assign(new Error('صفحة الفيسبوك مش متصلة — اربطها من قنوات المراسلة'), { statusCode: 409 });

  const fields = 'participants,updated_time,messages.limit(10){id,message,from,created_time}';
  let url = `${GRAPH}/${encodeURIComponent(pageId)}/conversations?platform=${platform}&limit=50&fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
  const stats = { conversations: 0, newLeads: 0, messages: 0, phones: 0 };
  while (url && stats.conversations < maxConversations) {
    const response = await fetchImpl(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      const message = data?.error?.message || `HTTP ${response.status}`;
      throw Object.assign(new Error(`ميتا رفضت: ${message}`), { statusCode: 502 });
    }
    for (const conversation of data.data || []) {
      if (stats.conversations >= maxConversations) break;
      stats.conversations += 1;
      const person = (conversation.participants?.data || []).find(p => String(p.id) !== pageId);
      if (!person?.id) continue;
      const messages = [...(conversation.messages?.data || [])].reverse(); // oldest first
      let leadId = null;
      for (const message of messages) {
        const text = String(message.message || '').trim();
        const inbound = String(message.from?.id || '') !== pageId;
        if (inbound) {
          // The same path a live message takes: lead, timeline, thread — but no bot and no notification storm.
          const result = await recordInboundMessenger({
            tenantId, channelId: resolved.row.id || null, providerMessageId: message.id, psid: String(person.id),
            body: text, timestamp: Math.floor(new Date(message.created_time).getTime() / 1000), platform, quiet: true,
          }, db);
          if (result.recorded) stats.messages += 1;
          if (result.createdLead) stats.newLeads += 1;
          leadId = result.leadId || leadId;
          if (leadId && await capturePhone(db, { tenantId, leadId, text })) stats.phones += 1;
        } else if (text) {
          const thread = await upsertThread(db, { tenantId, platform, contactKey: String(person.id), leadId });
          const at = new Date(message.created_time);
          const [insert] = await db.query(
            `INSERT IGNORE INTO communications
               (id, tenant_id, lead_id, type, direction, provider_message_id, thread_id, date, notes, created_at)
             VALUES (?,?,?,?, 'OUT', ?, ?, ?, ?, NOW())`,
            [uuidv4(), tenantId, leadId, PLATFORM[platform].type, `${PLATFORM[platform].idPrefix}${message.id}`, thread.id, at, text]);
          if (insert.affectedRows) {
            stats.messages += 1;
            await recordOnThread(db, { tenantId, threadId: thread.id, direction: 'OUT', text, at });
          }
        }
      }
      // Old conversations are history, not a queue: only the last day's stay unread.
      await db.query(
        `UPDATE inbox_threads SET unread_count=0
          WHERE tenant_id=? AND platform=? AND contact_key=? AND (last_inbound_at IS NULL OR last_inbound_at < DATE_SUB(NOW(), INTERVAL 1 DAY))`,
        [tenantId, platform, String(person.id)]);
      // A name, when Meta gave one, is better than «زائر ماسنجر».
      if (leadId && person.name) {
        await db.query(`UPDATE leads SET name=? WHERE tenant_id=? AND id=? AND name LIKE 'زائر%'`, [String(person.name).slice(0, 255), tenantId, leadId]);
      }
    }
    url = data.paging?.next || null;
  }
  logger.info('[page-audience] history imported', { tenantId, ...stats });
  return stats;
}

module.exports = {
  findPhone,
  capturePhone,
  audienceSummary,
  backfillPhones,
  messageOpenWindow,
  audienceRows,
  importPageHistory,
};
