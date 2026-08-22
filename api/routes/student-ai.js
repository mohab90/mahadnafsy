'use strict';

const express = require('express');
const { pool } = require('../lib/db');
const logger = require('../lib/logger').child({ module: 'student-ai-route' });
const { requireAuth } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimits');

const router = express.Router();

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
      context?.name || contactId, contactId,
      message.slice(0, 500), now,
      1, 'open', JSON.stringify(thread),
      context?.id || null, now,
    ]
  );
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function courseListText(courses = []) {
  const titles = courses.map((course) => course.title).filter(Boolean).slice(0, 4);
  if (titles.length === 0) return '';
  return `الكورسات المرتبطة بحسابك حاليا: ${titles.join('، ')}.`;
}

async function loadSubscriberContext(email, tenantId) {
  if (!email || !tenantId) return null;
  const [[subscriber]] = await pool.query(
    `SELECT id, name, email, enrolled_courses
     FROM subscribers
     WHERE tenant_id=? AND LOWER(TRIM(email)) = LOWER(TRIM(?))
     LIMIT 1`,
    [tenantId, email],
  );
  if (!subscriber) return null;

  let enrolledIds = [];
  try {
    enrolledIds = Array.isArray(subscriber.enrolled_courses)
      ? subscriber.enrolled_courses
      : JSON.parse(subscriber.enrolled_courses || '[]');
  } catch {
    enrolledIds = [];
  }

  let courses = [];
  if (enrolledIds.length > 0) {
    const placeholders = enrolledIds.slice(0, 20).map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT id, title FROM courses WHERE tenant_id=? AND id IN (${placeholders}) LIMIT 20`,
      [tenantId, ...enrolledIds.slice(0, 20)],
    );
    courses = rows;
  }

  return { subscriber, courses };
}

function generateAssistantReply(message, context) {
  const text = message.toLowerCase();
  const name = context?.subscriber?.name ? ` يا ${context.subscriber.name}` : '';
  const enrolledText = courseListText(context?.courses || []);

  if (includesAny(text, ['فيديو', 'محاضرة', 'يفتح', 'تشغيل', 'صوت'])) {
    return `تمام${name}. لو عندك مشكلة في فيديو أو محاضرة، جرّب تحديث الصفحة، ثم افتح الكورس من لوحة حسابي > المسارات التعليمية. لو المشكلة مستمرة افتح تذكرة دعم من قسم الدعم داخل حسابك مع اسم الكورس ورقم المحاضرة. ${enrolledText}`;
  }

  if (includesAny(text, ['شهادة', 'certificate', 'اعتماد'])) {
    return `الشهادات تظهر من لوحة حسابي > المسارات التعليمية > الشهادات بعد اكتمال شروط الكورس وسداد المطلوب. لو الشهادة لا تظهر رغم اكتمال الشروط، افتح تذكرة دعم وسيتم مراجعة حسابك. ${enrolledText}`;
  }

  if (includesAny(text, ['دفع', 'قسط', 'فاتورة', 'ايصال', 'تحويل', 'pay'])) {
    return 'تقدر تراجع المدفوعات من لوحة حسابي > المدفوعات. لو حولت مبلغ، ارفع صورة الإيصال من نفس القسم، وسيظهر للإدارة للمراجعة ثم ينعكس على حسابك بعد الاعتماد.';
  }

  if (includesAny(text, ['كورس', 'دورة', 'محتوى', 'درس', 'محاضرات'])) {
    return `تقدر تدخل للكورسات من لوحة حسابي > المسارات التعليمية. ${enrolledText || 'لو لسه مش مشترك، افتح صفحة الكورسات واختار المسار المناسب، أو تواصل مع فريق المبيعات.'}`;
  }

  if (includesAny(text, ['دعم', 'مشكلة', 'خطأ', 'مش شغال', 'لا يعمل'])) {
    return 'لو المشكلة مرتبطة بحسابك أو الدفع أو ظهور المحتوى، افتح تذكرة من لوحة حسابي > الدعم. اكتب وصف مختصر وصورة إن وجدت، وسيظهر الطلب لفريق الدعم.';
  }

  return `أهلا${name}. أقدر أساعدك في الكورسات، المحاضرات، الشهادات، المدفوعات، أو فتح تذكرة دعم. اكتب لي سؤالك بتفصيل بسيط وسأوجهك للخطوة المناسبة. ${enrolledText}`;
}

router.post('/chat', requireAuth, aiLimiter, async (req, res) => {
  try {
    const message = normalizeMessage(req.body?.message);
    if (!message) return res.status(400).json({ error: 'الرسالة مطلوبة.' });

    const context = await loadSubscriberContext(req.user?.email, req.tenantId).catch((error) => {
      logger.warn('failed to load subscriber context', { email: req.user?.email, error: error.message });
      return null;
    });

    const reply = generateAssistantReply(message, context);
    res.json({ ok: true, reply });

    // Record the exchange. Until now this route answered and forgot: nothing was
    // ever written, so a customer could ask the assistant something the whole
    // week and no one at the institute would ever see it. It lands in
    // inbox_conversations under its own channel, which is the surface the
    // messaging inbox already reads, so it needs no new screen to be visible.
    //
    // After res.json on purpose — a failure to file the transcript must never
    // cost the customer their answer.
    void recordAssistantExchange({
      tenantId: req.tenantId,
      email: req.user?.email || '',
      context,
      message,
      reply,
    }).catch(error => logger.warn('[student-ai] could not file the conversation', error.message));
  } catch (error) {
    logger.error('student ai chat failed', error);
    res.status(500).json({ error: 'حدث خطأ أثناء تجهيز الرد.' });
  }
});

module.exports = router;
