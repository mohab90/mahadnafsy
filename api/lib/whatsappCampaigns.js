'use strict';
/**
 * WhatsApp marketing campaigns.
 *
 * Three rules drive the whole design, and each one is a way campaigns go wrong:
 *
 *   Pace it.       An email provider takes 10,000 messages at once. A WhatsApp
 *                  number that does the same gets banned, and if it is a rep's
 *                  personal number, that is their own phone. Delivery is
 *                  staggered across the outbox's sendAt rather than dumped.
 *
 *   Send it once.  The same person is often both a lead and a subscriber. Two
 *                  copies of a marketing message reads as spam to the customer
 *                  and costs the number its reputation, so recipients are
 *                  deduplicated by dialable number, not by record id.
 *
 *   Respect no.    Anyone who unsubscribed is dropped before the queue, and the
 *                  reason is recorded so "why didn't Ahmed get it?" has an
 *                  answer that is not "we don't know".
 */
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { toDialable } = require('./phoneNumber');
const { filterSuppressed } = require('./marketingConsent');
const outbox = require('./outbox');
const logger = require('./logger');

// Above this a campaign is a data-export problem, not a message. The cap also
// bounds the memory this holds while building the audience.
const MAX_RECIPIENTS = Number(process.env.WA_CAMPAIGN_MAX_RECIPIENTS || 20000);
const MIN_THROTTLE = 1;
const MAX_THROTTLE = 600;

/**
 * Fill {{name}}-style placeholders.
 *
 * Unknown placeholders collapse to an empty string rather than being left as
 * literal braces: a customer receiving "أهلاً {{name}}" is worse than one
 * receiving "أهلاً".
 */
function renderTemplate(template, values = {}) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const value = values[key];
    return value === undefined || value === null ? '' : String(value);
  }).trim();
}

/** The placeholders a template actually uses — for the composer's preview. */
function templateVariables(template) {
  return [...new Set([...String(template || '').matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]))];
}

/**
 * Build the recipient list.
 *
 * Returns everyone the campaign *would* address, already deduplicated by
 * dialable number and annotated with why anyone was dropped. Nothing is queued
 * here — the composer calls this for a dry run and the sender reuses it, so the
 * preview and the send can never disagree.
 */
async function buildAudience({ tenantId, audience, filter = {}, limit = MAX_RECIPIENTS }, db = pool) {
  const cap = Math.min(Number(limit) || MAX_RECIPIENTS, MAX_RECIPIENTS);
  const collected = [];
  const skipped = [];

  const wantLeads = audience === 'leads' || audience === 'all' || audience === 'segment';
  const wantSubscribers = audience === 'subscribers' || audience === 'all';

  if (wantLeads) {
    const where = ["l.tenant_id=?", "l.hidden=0", "l.phone IS NOT NULL", "l.phone<>''"];
    const params = [tenantId];
    // Segment filters are whitelisted one by one; a free-form filter here would
    // be a SQL injection surface reachable from the campaign composer.
    if (filter.status) { where.push('l.status=?'); params.push(String(filter.status)); }
    if (filter.source) { where.push('l.source=?'); params.push(String(filter.source)); }
    if (filter.branchId) { where.push('l.branch_id=?'); params.push(String(filter.branchId)); }
    if (filter.assignedSalesId) { where.push('l.assigned_sales_id=?'); params.push(String(filter.assignedSalesId)); }
    if (filter.createdAfter) { where.push('l.created_at >= ?'); params.push(String(filter.createdAfter)); }
    params.push(cap);
    const [rows] = await db.query(
      `SELECT l.id, l.name, l.phone, l.client_code, l.status
         FROM leads l WHERE ${where.join(' AND ')}
        ORDER BY l.created_at DESC LIMIT ?`,
      params
    );
    collected.push(...rows.map(r => ({ ...r, subjectType: 'lead' })));
  }

  if (wantSubscribers) {
    const where = ["s.tenant_id=?", 's.deleted_at IS NULL', 's.is_active=1', 's.phone IS NOT NULL', "s.phone<>''"];
    const params = [tenantId];
    if (filter.branchId) { where.push('s.branch_id=?'); params.push(String(filter.branchId)); }
    params.push(cap);
    const [rows] = await db.query(
      `SELECT s.id, s.name, s.phone, s.client_code
         FROM subscribers s WHERE ${where.join(' AND ')}
        ORDER BY s.created_at DESC LIMIT ?`,
      params
    );
    collected.push(...rows.map(r => ({ ...r, subjectType: 'subscriber' })));
  }

  if (audience === 'manual' && Array.isArray(filter.phones)) {
    collected.push(...filter.phones.slice(0, cap).map(phone => ({
      id: null, name: null, phone: String(phone), subjectType: 'manual',
    })));
  }

  // ── Dedupe by the address, not the record ──────────────────────────────────
  // A person who is both a lead and a subscriber has two rows and one phone.
  // Subscribers win: they are the record with the better name and history.
  const byNumber = new Map();
  for (const person of collected) {
    const dialable = toDialable(person.phone);
    if (!dialable) {
      skipped.push({ ...person, reason: 'رقم غير صالح للإرسال' });
      continue;
    }
    const existing = byNumber.get(dialable);
    if (existing) {
      if (existing.subjectType !== 'subscriber' && person.subjectType === 'subscriber') {
        byNumber.set(dialable, { ...person, dialable });
      }
      continue;
    }
    byNumber.set(dialable, { ...person, dialable });
  }

  let recipients = [...byNumber.values()];

  // ── Consent ────────────────────────────────────────────────────────────────
  const allowed = await filterSuppressed(tenantId, 'whatsapp', recipients, 'dialable', db)
    .catch(error => {
      // Failing open here would message people who explicitly opted out, which
      // is the one failure mode that is worse than sending nothing.
      logger.error('[wa-campaign] consent check failed — refusing to send', error.message);
      throw Object.assign(new Error('تعذّر التحقق من قائمة إلغاء الاشتراك — لم يتم الإرسال'), { statusCode: 503 });
    });
  const allowedSet = new Set(allowed.map(r => r.dialable));
  for (const person of recipients) {
    if (!allowedSet.has(person.dialable)) skipped.push({ ...person, reason: 'ألغى الاشتراك' });
  }
  recipients = recipients.filter(person => allowedSet.has(person.dialable));

  return {
    recipients: recipients.slice(0, cap),
    skipped,
    capReached: recipients.length > cap,
    total: recipients.length,
  };
}

/**
 * Queue a campaign.
 *
 * Every message goes through the outbox, so retries, dedupe and delivery
 * receipts are the ones already in use everywhere else rather than a second
 * mechanism that has to be maintained in parallel.
 */
async function queueCampaign({ tenantId, campaign, recipients, channelId = null }, db = pool) {
  const perMinute = Math.max(MIN_THROTTLE, Math.min(Number(campaign.throttle_per_minute) || 60, MAX_THROTTLE));
  const gapMs = Math.ceil(60000 / perMinute);
  const startAt = campaign.scheduled_at ? new Date(campaign.scheduled_at).getTime() : Date.now();

  let queued = 0;
  for (const [index, person] of recipients.entries()) {
    const message = renderTemplate(campaign.message_template, {
      name: person.name || '',
      clientCode: person.client_code || '',
      status: person.status || '',
    });
    if (!message) continue;   // an empty render would send a blank message

    const recipientId = uuidv4();
    const outboxId = await outbox.enqueue({
      channel: 'whatsapp',
      recipient: person.dialable,
      payload: { message, channelId, campaignId: campaign.id },
      tenantId,
      // The stagger IS the throttle.
      sendAt: startAt + index * gapMs,
      // One send per person per campaign, enforced by the outbox's own unique
      // index — a double-clicked "send" cannot produce two blasts.
      dedupeKey: `wacamp:${campaign.id}:${person.dialable}`,
      refType: 'whatsapp_campaign',
      refId: campaign.id,
    }, db).catch(error => {
      logger.warn('[wa-campaign] enqueue failed', { campaign: campaign.id, err: error.message });
      return null;
    });

    await db.query(
      `INSERT IGNORE INTO whatsapp_campaign_recipients
         (id, tenant_id, campaign_id, subject_type, subject_id, phone, name, status, outbox_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [recipientId, tenantId, campaign.id, person.subjectType, person.id || null,
       person.dialable, person.name || null, outboxId ? 'queued' : 'failed', outboxId || null]
    );
    if (outboxId) queued++;
  }

  return { queued, estimatedMinutes: Math.ceil(recipients.length / perMinute) };
}

/** Record why people were left out, so the question can be answered later. */
async function recordSkipped({ tenantId, campaignId, skipped }, db = pool) {
  for (const person of skipped) {
    const dialable = toDialable(person.phone) || String(person.phone || '').slice(0, 32);
    if (!dialable) continue;
    await db.query(
      `INSERT IGNORE INTO whatsapp_campaign_recipients
         (id, tenant_id, campaign_id, subject_type, subject_id, phone, name, status, skip_reason)
       VALUES (?,?,?,?,?,?,?, 'skipped', ?)`,
      [uuidv4(), tenantId, campaignId, person.subjectType || 'manual', person.id || null,
       dialable, person.name || null, String(person.reason || '').slice(0, 120)]
    ).catch(() => {});
  }
}

module.exports = {
  MAX_RECIPIENTS,
  MIN_THROTTLE,
  MAX_THROTTLE,
  renderTemplate,
  templateVariables,
  buildAudience,
  queueCampaign,
  recordSkipped,
};
