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
      const payload = step.channel === 'email' ? { body: content } : { message: content };
      await outbox.enqueue({
        channel: step.channel, recipient, subject: step.subject || null, payload,
        tenantId: ctx.tenantId || 'mahad',
        sendAt: step.delayH ? Date.now() + H(step.delayH) : null,
      });
    }
    logger.info('[lifecycle] triggered', { event, to: ctx.email || ctx.phone });
  } catch (e) { logger.warn('[lifecycle] trigger failed', { event, err: e.message }); }
}

module.exports = { trigger, getConfig, JOURNEY };
