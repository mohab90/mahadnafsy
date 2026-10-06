'use strict';

// «المساعد الذكي»: «لازم يكون ذكي فعلا ويرد كويس ... لازم يكون في الاول اختيار
// هو عاوز استفسار عن كورس ولا عنده مشكله عاوز مساعده؟ لو عاوز استفسار عن كورس
// يروح للمبيعات ولو عنده مشكله يروح لخدمه العملاء».
//
// It answered from a list of keywords. It now answers with the AI agent the
// institute configures («وكيل الذكاء الاصطناعي»: provider, key, model, prompt,
// knowledge base), knowing the catalogue at the visitor's prices and the
// student's own courses, and falls back to the guided answers when no agent is
// set up or the provider fails. The first message of a conversation hands it
// to people: a course question becomes a lead for sales, a problem a ticket in
// customer service's inbox, and the rest of that problem conversation follows
// into the ticket.

const express = require('express');
const { pool } = require('../lib/db');
const logger = require('../lib/logger').child({ module: 'student-ai-route' });
const { requireAuth } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimits');
const { resolveSubscriberRow } = require('../lib/subscriberIdentity');
const { getTenantSetting } = require('../lib/tenantSettings');
const { generateAdminAi, resolveAiConfig } = require('../lib/adminAi');
const { resolveClientContext } = require('../lib/clientContext');
const { capturePublicLead } = require('../lib/publicLead');
const { uuidv4 } = require('../lib/id');
const { isRealPhone } = require('../lib/phoneNumber');
const { createRoutedTicket } = require('./support');

const router = express.Router();
const TOPICS = new Set(['course', 'support']);

function normalizeMessage(value) {
  return String(value || '').trim().slice(0, 1200);
}

/**
 * File one question-and-answer into the messaging inbox.
 *
 * One conversation per customer per tenant, appended to rather than replaced, so
 * the thread reads as a conversation instead of a pile of one-line rows. The
 * transcript lives in the same `messages` JSON column the other inbox channels
 * use, which is why this needs no schema change and no new screen.
 *
 * unread_count counts only the customer's side: the assistant answering is not
 * something a human still has to read.
 */
async function recordAssistantExchange({ tenantId, email, context, message, reply }) {
  const contactId = String(email || '').toLowerCase().trim();
  if (!contactId) return;
  const id = `ai-${tenantId}-${contactId}`.slice(0, 100);
  const now = new Date().toISOString();

  const [[existing]] = await pool.query(
    'SELECT messages, unread_count FROM inbox_conversations WHERE id=? AND tenant_id=? LIMIT 1',
    [id, tenantId]
  );
  let thread = [];
  if (existing?.messages) {
    try { thread = JSON.parse(existing.messages) || []; } catch { thread = []; }
  }
  // Bounded so one customer cannot grow a single row without limit.
  thread = [...thread, { from: 'customer', text: message, at: now }, { from: 'assistant', text: reply, at: now }]
    .slice(-200);

  await pool.query(
    `INSERT INTO inbox_conversations
       (id, tenant_id, channel, contact_name, contact_id, last_message, last_message_at,
        unread_count, status, messages, linked_subscriber_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       contact_name=VALUES(contact_name), last_message=VALUES(last_message),
       last_message_at=VALUES(last_message_at), unread_count=unread_count+1,
       messages=VALUES(messages), linked_subscriber_id=COALESCE(VALUES(linked_subscriber_id),linked_subscriber_id)`,
    [
      id, tenantId, 'ai_assistant',
      context?.subscriber?.name || contactId, contactId,
      message.slice(0, 500), now,
      1, 'open', JSON.stringify(thread),
      context?.subscriber?.id || null, now,
    ]
  );
}

const includesAny = (text, words) => words.some(word => text.includes(word));
// A number typed into the chat, for a student whose account has none.
const phoneIn = text => (String(text).match(/\+?\d[\d\s-]{8,}\d/g) || []).find(isRealPhone) || '';
const price = (course, currency) => Number(course[`price_${currency.toLowerCase()}`]) || 0;
const priceText = (course, currency) => (price(course, currency) > 0
  ? `${Math.round(price(course, currency)).toLocaleString('en-US')} ${{ EGP: 'جنيه', SAR: 'ريال', USD: 'دولار' }[currency]}`
  : 'السعر مع فريق المبيعات');

// Who is asking, what they study, and what the institute teaches — at the
// prices this visitor's version of the site shows (Egypt EGP, Saudi SAR,
// elsewhere USD).
async function loadContext(req) {
  // What they study is in enrollments: subscribers has no enrolled_courses
  // column, and asking for one failed the whole lookup («Unknown column»), so
  // the assistant never knew who it was talking to.
  const subscriber = await resolveSubscriberRow(req, ['id', 'name', 'email', 'phone']).catch(() => null);
  const enrolledIds = subscriber?.id
    ? (await pool.query(
      'SELECT course_id FROM enrollments WHERE tenant_id=? AND subscriber_id=?',
      [req.tenantId, subscriber.id]).catch(() => [[]]))[0].map(row => row.course_id)
    : [];
  const [catalogue] = await pool.query(
    `SELECT id, title, short_description, type, duration, hours, level, price_egp, price_sar, price_usd
       FROM courses WHERE tenant_id=? AND is_published=1 AND deleted_at IS NULL ORDER BY sort_order, title LIMIT 60`,
    [req.tenantId]);
  const client = await resolveClientContext(req).catch(() => ({ currency: 'EGP', branch: 'ONLINE_EGYPT' }));
  return {
    subscriber,
    phone: subscriber?.phone || req.user?.phone || '',
    enrolled: catalogue.filter(course => enrolledIds.map(String).includes(String(course.id))),
    catalogue,
    currency: client.currency || 'EGP',
    branch: client.branch || 'ONLINE_EGYPT',
  };
}

function systemPrompt(agent, context, topic) {
  const catalogue = context.catalogue.map(course => [
    `- ${course.title}`,
    course.short_description ? ` — ${String(course.short_description).slice(0, 160)}` : '',
    course.duration ? ` | المدة: ${course.duration}` : '',
    course.type ? ` | ${course.type === 'Live' ? 'لايف' : 'مسجّل'}` : '',
    ` | السعر: ${priceText(course, context.currency)}`,
  ].join('')).join('\n');
  const knowledge = (Array.isArray(agent?.knowledgeBase) ? agent.knowledgeBase : [])
    .map(entry => `${entry.title || ''}\n${entry.content || ''}`.trim())
    .join('\n\n').slice(0, 12_000);
  return [
    'أنت المساعد الذكي لمعهد الدراسات النفسية (mahadnafsy.com). بترد باللهجة المصرية، بإيجاز ووضوح ولطف، وبدون ما تخترع معلومة.',
    topic === 'course'
      ? `الطالب عنده استفسار عن كورس. ساعده يختار: اشرح المحتوى والمدة والسعر من القايمة تحت بس. لو سأل عن خصم أو تقسيط أو حاجة مش في القايمة، ${context.phone
        ? 'قوله إن فريق المبيعات وصله سؤاله وهيتواصل معاه بالتفاصيل.'
        : 'اطلب منه يكتب رقم موبايله (واتساب) عشان فريق المبيعات يتواصل معاه بالتفاصيل — حسابه مفيهوش رقم.'}`
      : 'الطالب عنده مشكلة في الموقع أو حسابه. افهم المشكلة واسأل سؤال واحد لو محتاج، واقترح خطوات حل عملية (تحديث الصفحة، تسجيل الخروج والدخول، مكان الحاجة في «حسابي»). قوله إن طلبه وصل لخدمة العملاء وهيتابعوه لو المشكلة ما اتحلتش.',
    'أماكن مهمة في الموقع: «حسابي > المسارات التعليمية» للكورسات والمحاضرات، «حسابي > الشهادات»، «حسابي > المدفوعات» لرفع إيصال التحويل، «حسابي > الدعم» لمتابعة الطلبات.',
    context.subscriber?.name ? `اسم الطالب: ${context.subscriber.name}.` : '',
    context.enrolled.length ? `الكورسات المشترك فيها: ${context.enrolled.map(course => course.title).join('، ')}.` : 'مش مشترك في كورسات لسه.',
    `كورسات المعهد (الأسعار بعملة الطالب):\n${catalogue || '—'}`,
    knowledge ? `معلومات من المعهد:\n${knowledge}` : '',
    agent?.systemPrompt ? `تعليمات الإدارة:\n${String(agent.systemPrompt).slice(0, 4000)}` : '',
  ].filter(Boolean).join('\n\n');
}

// A course the question names: every word of its title of three letters or more.
function namedCourse(text, catalogue) {
  return catalogue.find(course => {
    const words = String(course.title || '').toLowerCase().split(/\s+/).filter(word => word.length >= 3);
    return words.length && words.filter(word => text.includes(word)).length >= Math.min(2, words.length);
  }) || null;
}

const salesLine = context => (context.phone
  ? 'فريق المبيعات وصله سؤالك وهيتواصل معاك بتفاصيل الحجز والتقسيط.'
  : 'اكتبلي رقم موبايلك (واتساب) عشان فريق المبيعات يتواصل معاك بتفاصيل الحجز والتقسيط.');

/** The guided answer, when no AI agent is set up or the provider fails. */
function guidedReply(message, context, topic) {
  const text = message.toLowerCase();
  const name = context.subscriber?.name ? ` يا ${context.subscriber.name}` : '';
  if (topic === 'course') {
    const course = namedCourse(text, context.catalogue);
    if (course) {
      return [`«${course.title}»${course.short_description ? `: ${String(course.short_description).slice(0, 300)}` : ''}`,
        course.duration ? `المدة: ${course.duration}.` : '', `السعر: ${priceText(course, context.currency)}.`,
        salesLine(context)].filter(Boolean).join('\n');
    }
    const titles = context.catalogue.slice(0, 8).map(course => `• ${course.title} — ${priceText(course, context.currency)}`).join('\n');
    return `أهلًا${name}! دي أشهر برامجنا:\n${titles}\nقولّي اسم البرنامج اللي يهمك وأنا أقولك تفاصيله. ${salesLine(context)}`;
  }
  if (includesAny(text, ['فيديو', 'محاضرة', 'يفتح', 'تشغيل', 'صوت', 'بيقف'])) {
    return `تمام${name}. جرّب تحدّث الصفحة، وافتح الكورس من «حسابي > المسارات التعليمية». لو لسه مش شغال، اكتبلي اسم الكورس ورقم المحاضرة وإيه اللي بيظهر لك — طلبك وصل لخدمة العملاء وهيتابعوه.`;
  }
  if (includesAny(text, ['شهادة', 'certificate', 'اعتماد'])) {
    return 'الشهادات بتظهر في «حسابي > الشهادات» بعد اكتمال شروط الكورس وسداد المطلوب. لو الشروط كاملة ومش ظاهرة، خدمة العملاء وصلها طلبك وهتراجع حسابك.';
  }
  if (includesAny(text, ['دفع', 'قسط', 'فاتورة', 'ايصال', 'إيصال', 'تحويل', 'pay'])) {
    return 'تقدر تراجع مدفوعاتك وترفع صورة إيصال التحويل من «حسابي > المدفوعات». بعد المراجعة بتنعكس على حسابك. لو دفعت ومش ظاهر، خدمة العملاء وصلها طلبك وهتتابع.';
  }
  if (includesAny(text, ['باسورد', 'كلمة السر', 'دخول', 'login', 'حساب'])) {
    return 'لو مش قادر تدخل: استخدم «نسيت كلمة المرور» من صفحة الدخول، أو ادخل برقم الواتساب. لو المشكلة مستمرة، خدمة العملاء وصلها طلبك وهيتواصلوا معاك.';
  }
  return `وصلت${name}. اكتبلي المشكلة بالتفصيل: في أنهي صفحة، وإيه اللي ظهر لك. طلبك وصل لخدمة العملاء وهيتابعوه.`;
}

async function answer(req, context, topic, message, history) {
  const settings = await getTenantSetting('settings', { tenantId: req.tenantId, fallback: {} }).catch(() => ({}));
  // The site's own agent when one is set up; otherwise the key the institute
  // set for the admin assistant, which was the only one set — so the site's
  // assistant answered from a keyword list.
  const agent = resolveAiConfig(settings, 'agent');
  if (agent) {
    try {
      const text = await generateAdminAi(agent, {
        messages: [...history, { role: 'user', content: message }],
        systemPrompt: systemPrompt(agent, context, topic),
        maxTokens: 700,
      });
      if (text) return { reply: text, source: 'ai' };
    } catch (error) {
      logger.warn('[student-ai] the AI agent did not answer; the guided answer is used', { error: error.message });
    }
  }
  return { reply: guidedReply(message, context, topic), source: 'guided' };
}

const TICKET_CATEGORY = text => (includesAny(text, ['شهادة', 'certificate']) ? 'certificate'
  : includesAny(text, ['فيديو', 'محاضرة', 'كورس', 'يفتح', 'مش ظاهر']) ? 'course_access'
    : includesAny(text, ['دفع', 'قسط', 'ايصال', 'إيصال', 'تحويل']) ? 'billing' : 'technical');

// The first message goes to people; a problem's next messages follow it into
// the ticket, with what the assistant answered as a note for the agent.
async function handOff(req, context, topic, message, reply, handoffId) {
  const subscriber = context.subscriber;
  const name = subscriber?.name || req.user?.name || req.user?.email || 'عميل';
  const email = subscriber?.email || req.user?.email || null;
  if (topic === 'course') {
    if (handoffId) return null;
    const phone = context.phone || phoneIn(message);
    if (!phone) return null;
    const lead = await capturePublicLead({
      tenantId: req.tenantId, name, phone, branch: context.branch, source: 'ai_assistant',
      notes: `المساعد الذكي — استفسار عن كورس: ${message.slice(0, 400)}`,
    });
    return { kind: 'sales', id: lead.id || null };
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let ticketId = null;
    if (handoffId) {
      const [[ticket]] = await conn.query(
        `SELECT id FROM support_tickets WHERE id=? AND tenant_id=? AND deleted_at IS NULL
            AND ((?<>'' AND subscriber_id=?) OR (?<>'' AND subscriber_email=?)) LIMIT 1 FOR UPDATE`,
        [handoffId, req.tenantId, subscriber?.id || '', subscriber?.id || '', email || '', email || '']);
      ticketId = ticket?.id || null;
      if (ticketId) {
        await conn.query('INSERT INTO ticket_replies (id, tenant_id, ticket_id, author_type, author_name, body) VALUES (?,?,?,?,?,?)',
          [uuidv4(), req.tenantId, ticketId, 'CLIENT', name, message]);
        await conn.query("UPDATE support_tickets SET status=IF(status IN ('resolved','closed'),'open',status), updated_at=NOW() WHERE id=? AND tenant_id=?",
          [ticketId, req.tenantId]);
      }
    }
    if (!ticketId) {
      const created = await createRoutedTicket(conn, {
        tenantId: req.tenantId, subscriberId: subscriber?.id, email, name,
        subject: `المساعد الذكي: ${message.slice(0, 80)}`, body: message,
        category: TICKET_CATEGORY(message.toLowerCase()), channel: 'ai_assistant', actor: { id: null, name },
      });
      ticketId = created.id;
    }
    await conn.query('INSERT INTO ticket_replies (id, tenant_id, ticket_id, author_type, author_name, body, is_internal) VALUES (?,?,?,?,?,?,1)',
      [uuidv4(), req.tenantId, ticketId, 'STAFF', 'المساعد الذكي', `رد المساعد: ${reply}`.slice(0, 15000)]);
    await conn.commit();
    return { kind: 'support', id: ticketId };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

router.post('/chat', requireAuth, aiLimiter, async (req, res) => {
  try {
    const message = normalizeMessage(req.body?.message);
    if (!message) return res.status(400).json({ error: 'الرسالة مطلوبة.' });
    const topic = TOPICS.has(req.body?.topic) ? req.body.topic : 'support';
    const history = (Array.isArray(req.body?.history) ? req.body.history : [])
      .filter(item => item && (item.role === 'user' || item.role === 'assistant') && item.content)
      .slice(-8)
      .map(item => ({ role: item.role, content: normalizeMessage(item.content) }));

    const context = await loadContext(req);
    const { reply, source } = await answer(req, context, topic, message, history);
    const handoffId = String(req.body?.handoffId || '').slice(0, 100) || null;
    const handoff = await handOff(req, context, topic, message, reply, handoffId).catch(error => {
      logger.warn('[student-ai] hand-off failed', { topic, error: error.message });
      return null;
    });
    res.json({ ok: true, reply, source, handoff });

    // Record the exchange in the messaging inbox as well, after answering: a
    // failure to file the transcript must never cost the customer their answer.
    void recordAssistantExchange({
      tenantId: req.tenantId, email: req.user?.email || '', context, message, reply,
    }).catch(error => logger.warn('[student-ai] could not file the conversation', error.message));
  } catch (error) {
    logger.error('student ai chat failed', error);
    res.status(500).json({ error: 'حدث خطأ أثناء تجهيز الرد.' });
  }
});

module.exports = router;
module.exports.guidedReply = guidedReply;
module.exports.systemPrompt = systemPrompt;
