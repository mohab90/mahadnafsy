'use strict';
/**
 * Customer Lifecycle / Journey engine (growth nervous-system).
 *
 * A declarative journey: each business event maps to one or more messages
 * (email / whatsapp) that are enqueued into the transactional outbox and
 * delivered by the background worker. Every step is individually toggleable from
 * settings (key 'lifecycle'); defaults are ON. Time-based nudges (stalled
 * learners, due installments) are evaluated against *current* DB state by
 * scanScheduled(), so they self-cancel when no longer relevant.
 *
 * Events:  lead_created · payment_received · enrolled · certificate_ready
 * Scans :  learner_stalled · installment_due
 */
const { pool, cached } = require('./db');
const logger = require('./logger');
const outbox = require('./outbox');

const H = (n) => n * 3600 * 1000;
const money = (a, c) => `${Number(a || 0).toLocaleString()} ${c === 'SAR' ? 'ر.س' : c === 'USD' ? '$' : 'ج.م'}`;
const SITE = 'https://mahadnafsy.com';

// ── Journey definition ────────────────────────────────────────────────────────
// Each step: { key, channel, delayH, subject?, build(ctx) → html|text }
const JOURNEY = {
  lead_created: [
    {
      key: 'lead_welcome_email', channel: 'email', delayH: 0,
      subject: 'أهلاً بك في معهد الدراسات النفسية 🌿',
      build: (c) => `<p>أهلاً ${c.name || ''}،</p>
        <p>سعداء باهتمامك${c.courseTitle ? ` بـ <b>${c.courseTitle}</b>` : ' ببرامجنا'}. فريقنا هيتواصل معك قريباً، وتقدر دلوقتي تستكشف كل البرامج وتحجز مكانك:</p>
        <p><a class="btn" href="${SITE}/courses">استكشف البرامج واحجز</a></p>
        <p>لو عندك أي سؤال، رد على الرسالة دي أو راسلنا واتساب.</p>`,
    },
    {
      key: 'lead_welcome_wa', channel: 'whatsapp', delayH: 0,
      build: (c) => `أهلاً ${c.name || ''} 🌿\nشكراً لاهتمامك بمعهد الدراسات النفسية${c.courseTitle ? ` — ${c.courseTitle}` : ''}.\nفريقنا هيكلّمك قريب، ولو حابب تحجز دلوقتي: ${SITE}/courses\nأي استفسار احنا معاك 💚`,
    },
  ],
  payment_received: [
    {
      key: 'payment_receipt_email', channel: 'email', delayH: 0,
      subject: 'تأكيد الدفع وتفعيل وصولك ✅',
      build: (c) => `<p>أهلاً ${c.name || ''}،</p>
        <p>تم استلام دفعتك بنجاح${c.itemTitle ? ` لـ <b>${c.itemTitle}</b>` : ''}.</p>
        <table class="details"><tr><td>المبلغ</td><td>${money(c.amount, c.currency)}</td></tr>
        ${c.method ? `<tr><td>طريقة الدفع</td><td>${c.method}</td></tr>` : ''}
        <tr><td>التاريخ</td><td>${new Date().toISOString().slice(0, 10)}</td></tr></table>
        <p>وصولك اتفعّل — ابدأ التعلّم دلوقتي:</p>
        <p><a class="btn" href="${SITE}/dashboard">ابدأ التعلّم</a></p>`,
    },
    {
      key: 'payment_receipt_wa', channel: 'whatsapp', delayH: 0,
      build: (c) => `تم استلام دفعتك ✅ (${money(c.amount, c.currency)})${c.itemTitle ? ` لـ ${c.itemTitle}` : ''}.\nوصولك اتفعّل — ابدأ من حسابك: ${SITE}/dashboard\nبالتوفيق 💚`,
    },
  ],
  enrolled: [
    {
      key: 'onboarding_email', channel: 'email', delayH: 0,
      subject: 'رحلتك بدأت — ابدأ من هنا 🎓',
      build: (c) => `<p>مبروك ${c.name || ''}! 🎉</p>
        <p>تم تسجيلك${c.courseTitle ? ` في <b>${c.courseTitle}</b>` : ''}. عشان تبدأ صح:</p>
        <ol><li>افتح حسابك من <a href="${SITE}/dashboard">هنا</a></li>
        <li>ابدأ بأول محاضرة</li>
        <li>تابع تقدّمك واكمل عشان تستحق الشهادة 🏆</li></ol>
        <p><a class="btn" href="${SITE}/dashboard">ابدأ المحاضرة الأولى</a></p>`,
    },
  ],
  abandoned_interest: [
    {
      key: 'abandoned_email', channel: 'email', delayH: 0,
      subject: (c) => `لسه فاكر ${c.courseTitle || 'البرنامج'}؟ مكانك محجوز 🎓`,
      build: (c) => `<p>أهلاً ${c.name || ''},</p>
        <p>لاحظنا اهتمامك${c.courseTitle ? ` بـ <b>${c.courseTitle}</b>` : ' ببرامجنا'} وما أكملتش الحجز. الأماكن محدودة وحبينا نفكّرك:</p>
        <p><a class="btn" href="${SITE}/courses">أكمل حجزك الآن</a></p>
        <p>عندك سؤال أو محتاج تقسيط؟ رد على الرسالة دي ونرتّبلك 💚</p>`,
    },
    {
      key: 'abandoned_wa', channel: 'whatsapp', delayH: 0,
      build: (c) => `أهلاً ${c.name || ''} 🌿\nلاحظنا اهتمامك${c.courseTitle ? ` بـ ${c.courseTitle}` : ''} وما أكملتش الحجز.\nمكانك لسه محجوز — أكمل من هنا: ${SITE}/courses\nفيه تقسيط متاح، كلّمنا ونرتّبلك 💚`,
    },
  ],
  learner_stalled: [
    {
      key: 'stalled_email', channel: 'email', delayH: 0,
      subject: 'محاضرتك الأولى في انتظارك 🎓',
      build: (c) => `<p>أهلاً ${c.name || ''},</p>
        <p>لاحظنا إنك سجّلت معانا بس لسه ما بدأتش التعلّم. أول خطوة هي الأهم — ابدأ دلوقتي وكمّل على راحتك:</p>
        <p><a class="btn" href="${SITE}/dashboard">ابدأ التعلّم الآن</a></p>
        <p>محتاج مساعدة للدخول؟ رد على الرسالة دي ونحن معاك 💚</p>`,
    },
    {
      key: 'stalled_wa', channel: 'whatsapp', delayH: 0,
      build: (c) => `أهلاً ${c.name || ''} 🌿\nسجّلت معانا بس لسه ما بدأتش — أول محاضرة مستنياك!\nابدأ من هنا: ${SITE}/dashboard\nأي مساعدة احنا معاك 💚`,
    },
  ],
  certificate_ready: [
    {
      key: 'certificate_email', channel: 'email', delayH: 0,
      subject: 'مبروك! شهادتك جاهزة 🏆',
      build: (c) => `<p>مبروك ${c.name || ''}! 🎉</p>
        <p>أتممت${c.courseTitle ? ` <b>${c.courseTitle}</b>` : ' برنامجك'} وشهادتك أصبحت جاهزة.</p>
        <p><a class="btn" href="${SITE}/dashboard">استلم شهادتك</a></p>
        <p>عجبتك الرحلة؟ رشّح صديق واحصل على مكافأة — كلّمنا للتفاصيل 💚</p>`,
    },
  ],
};

// ── Config (toggles) ──────────────────────────────────────────────────────────
async function getConfig() {
  return cached('lifecycle_config', 60 * 1000, async () => {
    try {
      const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key`='lifecycle' LIMIT 1");
      const saved = rows[0]?.value ? (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value) : {};
      return { enabled: saved.enabled !== false, steps: saved.steps || {} }; // steps[key]=false to disable
    } catch { return { enabled: true, steps: {} }; }
  });
}

// Fire an event → enqueue its (enabled) messages. Never throws into the caller.
// opts.channels restricts to specific channels (e.g. ['email']) when another path
// already handles the rest (avoids duplicate sends).
async function trigger(event, ctx = {}, opts = {}) {
  try {
    const cfg = await getConfig();
    if (!cfg.enabled) return;
    const steps = JOURNEY[event];
    if (!steps) return;
    for (const step of steps) {
      if (cfg.steps[step.key] === false) continue;
      if (opts.channels && !opts.channels.includes(step.channel)) continue;
      const recipient = step.channel === 'email' ? ctx.email : (ctx.phone || '').replace(/\D/g, '');
      if (!recipient) continue;
      const content = step.build(ctx);
      const subject = typeof step.subject === 'function' ? step.subject(ctx) : (step.subject || null);
      const payload = step.channel === 'email' ? { body: content } : { message: content };
      await outbox.enqueue({
        channel: step.channel, recipient, subject, payload,
        tenantId: ctx.tenantId || 'mahad',
        sendAt: step.delayH ? Date.now() + H(step.delayH) : null,
        dedupeKey: opts.dedupeKey ? `${opts.dedupeKey}:${step.key}` : null,
      });
    }
    logger.info('[lifecycle] triggered', { event, to: ctx.email || ctx.phone });
  } catch (e) { logger.warn('[lifecycle] trigger failed', { event, err: e.message }); }
}

// ISO-week stamp for weekly dedupe keys.
function weekStamp(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}W${week}`;
}

// Time-based nudges, evaluated against live state (so they self-cancel). Run daily.
// v1: re-engage learners who paid/enrolled 7+ days ago but never watched anything.
// (Installment reminders are already handled by the server's installment cron.)
async function scanScheduled() {
  const cfg = await getConfig();
  if (!cfg.enabled) return { stalled: 0 };
  let stalled = 0;
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT s.id, s.name, s.email, s.phone
      FROM subscribers s
      JOIN enrollments e ON e.subscriber_id = s.id
      LEFT JOIN lecture_progress lp ON lp.subscriber_id = s.id
      WHERE e.enrolled_at < (NOW() - INTERVAL 7 DAY)
        AND e.enrolled_at > (NOW() - INTERVAL 60 DAY)
        AND lp.id IS NULL
        AND (s.email IS NOT NULL OR s.phone IS NOT NULL)
      LIMIT 300
    `);
    const wk = weekStamp();
    for (const s of rows) {
      await trigger('learner_stalled',
        { name: s.name, email: s.email, phone: s.phone },
        { dedupeKey: `stalled:${s.id}:${wk}` }); // once per subscriber per week
      stalled++;
    }
    if (stalled) logger.info('[lifecycle] scanScheduled: queued stalled-learner nudges', { count: stalled });
  } catch (e) { logger.warn('[lifecycle] scanScheduled (stalled) failed', { err: e.message }); }

  // Abandoned interest: interested leads (not converted/lost) created 3–21 days
  // ago with no payment yet → remind them about the course they wanted.
  let abandoned = 0;
  try {
    const [rows] = await pool.query(`
      SELECT l.id, l.name, l.email, l.phone, c.title AS course_title
      FROM leads l
      LEFT JOIN courses c ON c.id = l.enrolled_course_id
      WHERE l.hidden = 0
        AND LOWER(l.status) NOT IN ('converted','lost')
        AND l.created_at < (NOW() - INTERVAL 3 DAY)
        AND l.created_at > (NOW() - INTERVAL 21 DAY)
        AND (l.deal_value IS NULL OR l.deal_value = 0)
        AND (l.email IS NOT NULL OR l.phone IS NOT NULL)
        AND (l.enrolled_course_id IS NOT NULL OR l.interested_course_ids_json IS NOT NULL)
      LIMIT 300
    `);
    const wk = weekStamp();
    for (const l of rows) {
      await trigger('abandoned_interest',
        { name: l.name, email: l.email, phone: l.phone, courseTitle: l.course_title },
        { dedupeKey: `abandoned:${l.id}:${wk}` });
      abandoned++;
    }
    if (abandoned) logger.info('[lifecycle] scanScheduled: queued abandoned-interest nudges', { count: abandoned });
  } catch (e) { logger.warn('[lifecycle] scanScheduled (abandoned) failed', { err: e.message }); }

  return { stalled, abandoned };
}

module.exports = { trigger, scanScheduled, getConfig, JOURNEY };
