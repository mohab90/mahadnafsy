'use strict';
/**
 * The inbox bot: «نشغل منه ai chat bot نقدر نسطبه ويكون احترافي».
 *
 * It answers in the team inbox, from the same company number, page and
 * Instagram account, and only where it was asked to:
 *
 *   mode 'always'      every conversation nobody has taken over
 *   mode 'off_hours'   outside the working hours set below
 *   mode 'unassigned'  conversations no rep owns yet
 *
 * What it knows is what the institute has written down: the published courses
 * and tracks with their price per branch (lib/priceTiers.js), the FAQ, the
 * contacts, and whatever the owner adds in its settings. It is told to invent
 * nothing beyond that.
 *
 * It steps aside — and the conversation goes to the team, with a notification —
 * when the customer asks for a person, wants to book or pay, complains, or asks
 * something it cannot answer from what it knows ([HANDOFF] in its answer), and
 * after `maxReplies` answers in one conversation. A person replying stops it
 * in that conversation (routes/team-inbox.js); «رجّع للبوت» starts it again.
 *
 * A customer often sends three messages in a row. The answer waits a few
 * seconds and is skipped if a newer message arrived meanwhile — that one's
 * answer covers all three.
 */
const logger = require('./logger').child({ module: 'inbox-bot' });
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { getTenantSetting, setTenantSetting } = require('./tenantSettings');
const { generateAdminAi, resolveAiConfig } = require('./adminAi');
const { getBrandSettings } = require('./brandSettings');
const { listCatalogPricing } = require('./priceTiers');
const { recordOnThread, isWindowOpen } = require('./inboxThreads');
const { zonedDateTimeParts } = require('./dates');

const SETTING_KEY = 'inbox_bot';
const HANDOFF = '[HANDOFF]';
const DEFAULT_DELAY_MS = 6000;

const DEFAULTS = Object.freeze({
  enabled: false,
  platforms: { whatsapp: true, messenger: true, instagram: true },
  mode: 'always',
  workingHours: { days: [0, 1, 2, 3, 4, 6], from: '10:00', to: '22:00' },
  name: 'مساعد المعهد',
  instructions: '',
  extraKnowledge: '',
  knowledge: { courses: true, prices: true, faq: true, contacts: true },
  handoffKeywords: ['موظف', 'حد يكلمني', 'خدمة العملاء', 'مكالمة', 'اكلم حد'],
  handoffMessage: 'تمام، هحوّلك لزميل من فريقنا يرد عليك في أقرب وقت 🙏',
  maxReplies: 6,
});

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const text = (value, max) => String(value ?? '').slice(0, max);
const hhmm = (value, fallback) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value)) ? String(value) : fallback);

/** Settings as stored, with every field present and in range. */
function normalizeSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const hours = source.workingHours || {};
  return {
    enabled: source.enabled === true,
    platforms: {
      whatsapp: source.platforms?.whatsapp !== false,
      messenger: source.platforms?.messenger !== false,
      instagram: source.platforms?.instagram !== false,
    },
    mode: ['always', 'off_hours', 'unassigned'].includes(source.mode) ? source.mode : DEFAULTS.mode,
    workingHours: {
      days: Array.isArray(hours.days) ? [...new Set(hours.days.map(Number).filter(d => d >= 0 && d <= 6))] : [...DEFAULTS.workingHours.days],
      from: hhmm(hours.from, DEFAULTS.workingHours.from),
      to: hhmm(hours.to, DEFAULTS.workingHours.to),
    },
    name: text(source.name, 60).trim() || DEFAULTS.name,
    instructions: text(source.instructions, 4000),
    extraKnowledge: text(source.extraKnowledge, 20000),
    knowledge: {
      courses: source.knowledge?.courses !== false,
      prices: source.knowledge?.prices !== false,
      faq: source.knowledge?.faq !== false,
      contacts: source.knowledge?.contacts !== false,
    },
    handoffKeywords: (Array.isArray(source.handoffKeywords) ? source.handoffKeywords : DEFAULTS.handoffKeywords)
      .map(k => text(k, 40).trim()).filter(Boolean).slice(0, 20),
    handoffMessage: text(source.handoffMessage, 500).trim() || DEFAULTS.handoffMessage,
    maxReplies: clamp(source.maxReplies, 1, 30, DEFAULTS.maxReplies),
  };
}

async function loadSettings(tenantId, db = pool) {
  return normalizeSettings(await getTenantSetting(SETTING_KEY, { tenantId, fallback: {}, db }).catch(() => ({})));
}

async function saveSettings(tenantId, value, db = pool) {
  const settings = normalizeSettings(value);
  await setTenantSetting(SETTING_KEY, settings, { tenantId, db });
  return settings;
}

/** Inside the working hours, on the Cairo clock. A window past midnight (20:00–02:00) wraps. */
function withinWorkingHours(hours, now = new Date()) {
  const parts = zonedDateTimeParts(now);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const minute = parts.hour * 60 + parts.minute;
  const [fh, fm] = hours.from.split(':').map(Number);
  const [th, tm] = hours.to.split(':').map(Number);
  const from = fh * 60 + fm; const to = th * 60 + tm;
  if (from === to) return hours.days.includes(weekday);
  if (from < to) return hours.days.includes(weekday) && minute >= from && minute < to;
  // Past midnight: the late part belongs to the day it started on.
  const yesterday = (weekday + 6) % 7;
  return (hours.days.includes(weekday) && minute >= from) || (hours.days.includes(yesterday) && minute < to);
}

/** Whether the bot answers this conversation now, and if not, why not. */
function shouldAnswer(settings, thread, now = new Date()) {
  if (!settings.enabled) return { ok: false, reason: 'disabled' };
  if (!settings.platforms[thread.platform]) return { ok: false, reason: 'platform_off' };
  if (thread.bot_paused) return { ok: false, reason: 'paused' };
  if (thread.status === 'closed') return { ok: false, reason: 'closed' };
  if (thread.last_direction !== 'IN') return { ok: false, reason: 'answered' };
  if (!isWindowOpen(thread.last_inbound_at, now.getTime())) return { ok: false, reason: 'window_closed' };
  if (settings.mode === 'unassigned' && thread.assigned_staff_id) return { ok: false, reason: 'assigned' };
  if (settings.mode === 'off_hours' && withinWorkingHours(settings.workingHours, now)) return { ok: false, reason: 'working_hours' };
  if (Number(thread.bot_replies) >= settings.maxReplies) return { ok: false, reason: 'limit' };
  return { ok: true };
}

const strip = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const fmt = (n, currency) => `${Number(n).toLocaleString('en-US')} ${currency === 'EGP' ? 'جنيه' : currency === 'SAR' ? 'ريال' : 'دولار'}`;

/** What the institute has written down, as plain text for the model. */
async function buildKnowledge(tenantId, settings, db = pool) {
  const sections = [];
  if (settings.knowledge.contacts) {
    const brand = await getBrandSettings(tenantId, db).catch(() => null);
    if (brand) {
      sections.push(['## المعهد',
        `الاسم: ${brand.instituteName}`,
        brand.websiteUrl && `الموقع: ${brand.websiteUrl}`,
        brand.supportPhone && `التليفون: ${brand.supportPhone}`,
        brand.supportWhatsapp && `واتساب: ${brand.supportWhatsapp}`,
        brand.supportAddress && `العنوان: ${brand.supportAddress}`,
      ].filter(Boolean).join('\n'));
    }
  }
  if (settings.knowledge.courses) {
    const [courses] = await db.query(
      `SELECT id, title, slug, short_description, duration, type, hours FROM courses
        WHERE tenant_id=? AND is_published=1 AND deleted_at IS NULL ORDER BY sort_order, created_at DESC LIMIT 40`, [tenantId])
      .catch(() => db.query(
        `SELECT id, title, slug, short_description, duration, type, NULL AS hours FROM courses
          WHERE tenant_id=? AND is_published=1 AND deleted_at IS NULL LIMIT 40`, [tenantId]));
    const [bundles] = await db.query(
      `SELECT id, title, slug, short_description FROM bundles WHERE tenant_id=? AND is_published=1 AND deleted_at IS NULL LIMIT 20`, [tenantId])
      .catch(() => [[]]);
    const pricing = settings.knowledge.prices ? await listCatalogPricing(db, tenantId).catch(() => ({ course: {}, bundle: {} })) : null;
    const priceLine = (type, id) => {
      const tiers = pricing?.[type]?.[id]?.tiers || [];
      const shown = tiers.filter(t => t.price != null && !t.inherited);
      if (!shown.length) return '';
      return ' — الأسعار: ' + shown.map(t => `${t.label}: ${fmt(t.price, t.currency)}${t.discountPrice != null ? ` (بعد الخصم ${fmt(t.discountPrice, t.currency)})` : ''}`).join('، ');
    };
    if (courses.length) {
      sections.push('## الكورسات\n' + courses.map(c => `- ${c.title}${c.duration ? ` (${c.duration})` : ''}${c.type ? ` [${c.type}]` : ''}: ${strip(c.short_description).slice(0, 220)}${priceLine('course', c.id)}${c.slug ? ` — /course/${c.slug}` : ''}`).join('\n'));
    }
    if (bundles.length) {
      sections.push('## المسارات\n' + bundles.map(b => `- ${b.title}: ${strip(b.short_description).slice(0, 220)}${priceLine('bundle', b.id)}${b.slug ? ` — /bundle/${b.slug}` : ''}`).join('\n'));
    }
  }
  if (settings.knowledge.faq) {
    const [faq] = await db.query(
      'SELECT question, answer FROM faq_entries WHERE tenant_id=? AND is_published=1 ORDER BY sort_order LIMIT 60', [tenantId])
      .catch(() => [[]]);
    if (faq.length) sections.push('## أسئلة شائعة\n' + faq.map(f => `س: ${strip(f.question)}\nج: ${strip(f.answer).slice(0, 600)}`).join('\n'));
  }
  if (settings.extraKnowledge.trim()) sections.push('## معلومات إضافية من الإدارة\n' + settings.extraKnowledge.trim());
  return sections.join('\n\n');
}

function systemPrompt(settings, knowledge, platformLabel) {
  return [
    `إنت «${settings.name}»، مساعد خدمة العملاء لمعهد تعليمي، بترد على العملاء على ${platformLabel}.`,
    'القواعد:',
    '- رد بنفس لغة العميل؛ لو كتب بالعربي رد بالمصري البسيط المحترم.',
    '- خليك مختصر: من سطر لخمس سطور، من غير مقدمات طويلة.',
    '- استخدم المعلومات اللي تحت بس. ما تخترعش سعر ولا ميعاد ولا خصم ولا رابط مش مكتوب.',
    '- لو السعر بيختلف حسب الفرع أو البلد، اسأل العميل هو فين (الدقي، التجمع، أونلاين من مصر، السعودية، بره) وقوله سعر فرعه.',
    '- لو العميل مهتم يحجز: اسأله عن اسمه بالكامل والكورس اللي عايزه، وقوله إن زميل هيكمل معاه الحجز.',
    `- لو العميل عايز يكلم موظف، أو عايز يدفع أو يحجز فعلاً، أو عنده شكوى، أو سأل حاجة مش موجودة في المعلومات: رد رد قصير مهذب وحط في آخر الرد ${HANDOFF}.`,
    '- ما تطلبش بيانات بطاقة بنكية أو كلمات سر أبداً.',
    settings.instructions.trim() && `تعليمات الإدارة:\n${settings.instructions.trim()}`,
    `\nالمعلومات المتاحة:\n${knowledge || '(مفيش معلومات مسجلة — حوّل أي سؤال للفريق)'}`,
  ].filter(Boolean).join('\n');
}

const PLATFORM_LABEL = { whatsapp: 'واتساب', messenger: 'ماسنجر فيسبوك', instagram: 'انستجرام' };

/** The conversation so far as the model reads it: the customer is the user, any answer is the assistant. */
async function threadHistory(db, tenantId, threadId) {
  const [rows] = await db.query(
    `SELECT direction, notes FROM communications WHERE tenant_id=? AND thread_id=? ORDER BY date DESC LIMIT 14`,
    [tenantId, threadId]);
  return rows.reverse().map(row => ({ role: row.direction === 'IN' ? 'user' : 'assistant', content: String(row.notes || '') }))
    .filter(m => m.content.trim());
}

const normalizeAr = value => String(value || '').toLowerCase()
  .replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
const asksForPerson = (settings, message) => settings.handoffKeywords.some(k => normalizeAr(message).includes(normalizeAr(k)));

/**
 * The bot's answer to a conversation, without sending it — what «جرّب البوت»
 * shows and what `answerThread` sends.
 *
 * @returns {Promise<{reply: string, handoff: boolean, reason?: string}>}
 */
async function composeReply({ tenantId, settings, messages, platform = 'whatsapp' }, deps = {}) {
  const db = deps.db || pool;
  const last = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  if (asksForPerson(settings, last)) return { reply: settings.handoffMessage, handoff: true, reason: 'asked_for_person' };
  const aiSettings = await getTenantSetting('settings', { tenantId, fallback: {}, db }).catch(() => ({}));
  const config = resolveAiConfig(aiSettings, 'agent');
  if (!config) return { reply: '', handoff: false, reason: 'no_ai_key' };
  const knowledge = await buildKnowledge(tenantId, settings, db);
  const generate = deps.generate || generateAdminAi;
  const answer = String(await generate(config, {
    systemPrompt: systemPrompt(settings, knowledge, PLATFORM_LABEL[platform] || platform),
    messages,
    maxTokens: 600,
  }) || '').trim();
  const handoff = answer.includes(HANDOFF);
  const reply = answer.replaceAll(HANDOFF, '').trim() || (handoff ? settings.handoffMessage : '');
  return { reply, handoff };
}

/** Sends a text on the conversation's own channel. */
async function deliver(thread, message, tenantId) {
  if (thread.platform === 'whatsapp') {
    const { sendWhatsApp } = require('./whatsapp');
    const result = await sendWhatsApp(thread.contact_key, message, { tenantId, channelId: thread.channel_id || null, category: 'inbox_reply' });
    return { ok: !!result?.ok, id: result?.idMessage || null, channelId: result?.channelId || thread.channel_id || null, reason: result?.reason };
  }
  const { sendMessengerMessage, PLATFORM } = require('./messenger');
  const { getSendableChannel } = require('./messagingChannels');
  const resolved = (thread.channel_id && await getSendableChannel({ tenantId, channelId: thread.channel_id, kind: 'messenger' }).catch(() => null))
    || await getSendableChannel({ tenantId, kind: 'messenger' }).catch(() => null);
  if (!resolved) return { ok: false, reason: 'not_configured' };
  const result = await sendMessengerMessage(thread.contact_key, message, resolved.credentials);
  return { ok: !!result?.ok, id: result?.idMessage ? `${PLATFORM[thread.platform].idPrefix}${result.idMessage}` : null, channelId: resolved.row.id, reason: result?.reason };
}

/**
 * Answer one conversation if the bot should. Called after a customer's
 * message is filed; reads everything fresh, so a late or repeated call is safe.
 */
async function answerThread({ tenantId, threadId, expectInboundAt = null }, deps = {}) {
  const db = deps.db || pool;
  const settings = deps.settings || await loadSettings(tenantId, db);
  if (!settings.enabled) return { answered: false, reason: 'disabled' };
  const [[thread]] = await db.query(
    `SELECT id, platform, contact_key, channel_id, lead_id, subscriber_id, assigned_staff_id, status,
            last_direction, last_inbound_at, bot_paused, bot_replies
       FROM inbox_threads WHERE tenant_id=? AND id=? LIMIT 1`, [tenantId, threadId]);
  if (!thread) return { answered: false, reason: 'missing' };
  // A newer message arrived while this one waited: that one's turn answers both.
  if (expectInboundAt && thread.last_inbound_at && new Date(thread.last_inbound_at).getTime() > new Date(expectInboundAt).getTime() + 999) {
    return { answered: false, reason: 'superseded' };
  }
  const gate = shouldAnswer(settings, thread, deps.now || new Date());
  if (!gate.ok) {
    if (gate.reason === 'limit') await handOff(db, tenantId, thread, 'وصل لأقصى عدد ردود للبوت');
    return { answered: false, reason: gate.reason };
  }

  const messages = await threadHistory(db, tenantId, thread.id);
  const { reply, handoff, reason } = await composeReply({ tenantId, settings, messages, platform: thread.platform }, { ...deps, db });
  if (!reply) return { answered: false, reason: reason || 'empty' };

  const sent = await (deps.deliver || deliver)(thread, reply, tenantId);
  if (!sent.ok) {
    logger.warn('[inbox-bot] send failed', { tenantId, threadId, reason: sent.reason });
    return { answered: false, reason: 'send_failed' };
  }
  const id = uuidv4();
  const now = new Date();
  const type = { whatsapp: 'WHATSAPP', messenger: 'MESSENGER', instagram: 'INSTAGRAM' }[thread.platform];
  await db.query(
    `INSERT INTO communications
       (id, tenant_id, lead_id, subscriber_id, type, direction, provider_message_id, channel_id,
        thread_id, delivery_status, date, notes, outcome, staff_id, created_at)
     VALUES (?,?,?,?,?, 'OUT', ?, ?, ?, ?, ?, ?, 'BOT', NULL, NOW())`,
    [id, tenantId, thread.lead_id, thread.subscriber_id, type, sent.id, sent.channelId, thread.id,
      sent.id ? 'sent' : null, now, reply]);
  await recordOnThread(db, { tenantId, threadId: thread.id, direction: 'OUT', text: reply, at: now });
  await db.query('UPDATE inbox_threads SET bot_replies = bot_replies + 1, bot_last_at = ? WHERE tenant_id=? AND id=?',
    [now, tenantId, thread.id]);
  if (handoff) await handOff(db, tenantId, thread, reason === 'asked_for_person' ? 'العميل طلب يكلم موظف' : 'البوت محتاج حد من الفريق');
  return { answered: true, handoff, id };
}

/** The bot steps aside: it stays quiet here and the team is told. */
async function handOff(db, tenantId, thread, why) {
  await db.query('UPDATE inbox_threads SET bot_paused=1 WHERE tenant_id=? AND id=?', [tenantId, thread.id]);
  const { createNotification } = require('./notification');
  await createNotification('inbox', '🤖 البوت محتاج حد من الفريق', `${why} — افتح المحادثة في صندوق الرسائل`,
    { threadId: thread.id, leadId: thread.lead_id || null }, tenantId, thread.assigned_staff_id || null).catch(() => {});
}

/**
 * After a customer's message is filed. Never throws and never delays the
 * webhook: the answer happens a few seconds later, in the background.
 */
function scheduleBotReply({ tenantId, threadId, inboundAt = new Date() }, { delayMs = Number(process.env.INBOX_BOT_DELAY_MS) || DEFAULT_DELAY_MS } = {}) {
  // Not under a test runner: a webhook test would otherwise leave a timer that
  // answers into a mocked database seconds later. Tests call answerThread directly.
  if ((process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) && !process.env.INBOX_BOT_IN_TESTS) return;
  const timer = setTimeout(() => {
    answerThread({ tenantId, threadId, expectInboundAt: inboundAt })
      .catch(error => logger.warn('[inbox-bot] answer failed', { tenantId, threadId, error: error.message }));
  }, delayMs);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = {
  DEFAULTS,
  HANDOFF,
  normalizeSettings,
  loadSettings,
  saveSettings,
  withinWorkingHours,
  shouldAnswer,
  buildKnowledge,
  systemPrompt,
  composeReply,
  answerThread,
  scheduleBotReply,
};
