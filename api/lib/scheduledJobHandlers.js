'use strict';

const { tryJson } = require('./helpers');
const { sendWhatsApp } = require('./whatsapp');
const { renderTemplate } = require('./messageTemplates');
const { createNotification } = require('./notification');
const { getTenantSetting, setTenantSetting } = require('./tenantSettings');
const { invalidateFxCache } = require('./finance');
const { cacheInvalidate } = require('./db');

function createScheduledJobHandlers({ pool, logger }) {
  const installmentSentToday = new Set();
  let installmentResetDate = new Date().toISOString().slice(0, 10);

  async function installmentReminder() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (today !== installmentResetDate) {
        installmentSentToday.clear();
        installmentResetDate = today;
      }
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 3);
      const target = targetDate.toISOString().slice(0, 10);
      const [subscribers] = await pool.query(
        "SELECT id,tenant_id,name,phone,crm_json FROM subscribers WHERE is_active=1 AND crm_json LIKE '%installmentPlans%' LIMIT 2000"
      );
      let sent = 0;
      for (const subscriber of subscribers) {
        const plans = tryJson(subscriber.crm_json, {}).installmentPlans || [];
        for (const plan of plans) {
          for (const entry of plan.entries || []) {
            const dueDate = String(entry.dueDate || '').slice(0, 10);
            const key = `${subscriber.tenant_id}:${subscriber.id}:${dueDate}:${plan.courseId || ''}`;
            if (dueDate !== target || entry.paidAt || !subscriber.phone || installmentSentToday.has(key)) continue;
            installmentSentToday.add(key);
            const message = renderTemplate('installment_reminder', {
              amount: entry.amount,
              currency: plan.currency || 'EGP',
              dueDate,
              courseName: plan.courseTitle || 'قسط',
            }, subscriber.tenant_id);
            await sendWhatsApp(subscriber.phone, message, { tenantId: subscriber.tenant_id }).catch(() => {});
            sent += 1;
            if (sent % 5 === 0) await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      if (sent) logger.info(`[jobs] installment reminders sent=${sent}`);
    } catch (error) {
      logger.warn('[jobs] installment reminder failed:', error.message);
    }
  }

  async function pendingPaymentReminder() {
    try {
      const cutoff = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      const [rows] = await pool.query(
        `SELECT p.id,p.tenant_id,p.amount,p.currency,p.date,s.name,s.phone
           FROM payments p
           JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=p.tenant_id
          WHERE p.status='pending' AND p.date<=? AND s.phone IS NOT NULL AND s.phone!=''
          LIMIT 50`,
        [cutoff]
      );
      for (const row of rows) {
        const message = renderTemplate('pending_payment_reminder', {
          amount: row.amount,
          currency: row.currency || 'EGP',
          date: String(row.date || '').slice(0, 10),
        }, row.tenant_id);
        await sendWhatsApp(row.phone, message, { tenantId: row.tenant_id });
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      const counts = rows.reduce((result, row) => {
        result[row.tenant_id] = (result[row.tenant_id] || 0) + 1;
        return result;
      }, {});
      for (const [tenantId, count] of Object.entries(counts)) {
        await createNotification(
          'reminder',
          'تذكيرات دفع مُرسلة',
          `تم إرسال ${count} تذكير للمدفوعات المعلّقة تلقائياً`,
          { count },
          tenantId
        );
      }
      if (rows.length) logger.info(`[jobs] pending payment reminders sent=${rows.length}`);
    } catch (error) {
      logger.warn('[jobs] pending payment reminder failed:', error.message);
    }
  }

  async function refreshFxRates() {
    try {
      const response = await fetch('https://open.er-api.com/v6/latest/EGP', {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`provider returned ${response.status}`);
      const data = await response.json();
      if (!data.rates?.SAR || !data.rates?.USD) throw new Error('provider response has no SAR/USD rates');
      const sarToEgp = Number((1 / data.rates.SAR).toFixed(4));
      const usdToEgp = Number((1 / data.rates.USD).toFixed(4));
      const [tenants] = await pool.query("SELECT id FROM tenants WHERE status='active'");
      for (const tenant of tenants) {
        const content = await getTenantSetting('content', { tenantId: tenant.id, fallback: {} });
        await setTenantSetting('content', {
          ...content,
          'exchange.sar_to_egp': String(sarToEgp),
          'exchange.usd_to_egp': String(usdToEgp),
          'exchange.source': 'open.er-api.com',
          'exchange.updated_at': new Date().toISOString(),
        }, { tenantId: tenant.id, actorId: 'fx-refresh' });
        invalidateFxCache(tenant.id);
      }
      cacheInvalidate('site_content');
      logger.info(`[jobs] FX refreshed SAR=${sarToEgp} USD=${usdToEgp}`);
    } catch (error) {
      logger.warn('[jobs] FX refresh failed:', error.message);
      throw error;
    }
  }

  async function daqqiSessionReminder() {
    try {
      const now = Date.now();
      const windows = [
        [now + 23 * 3600000, now + 25 * 3600000, '24 ساعة'],
        [now + 110 * 60000, now + 130 * 60000, 'ساعتين'],
      ];
      const [rounds] = await pool.query(
        `SELECT dr.id,dr.tenant_id,dr.code,dr.time_slot,dr.start_date,dr.current_lecture,
                dr.postponed_weeks_json,c.title course_title
           FROM daqqi_rounds dr
           JOIN courses c ON c.id=dr.course_id AND c.tenant_id=dr.tenant_id
          WHERE dr.status='ACTIVE'`
      );
      const mondayOf = value => {
        const date = new Date(value);
        const day = date.getDay();
        date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
        return date.toISOString().slice(0, 10);
      };
      for (const [from, to, label] of windows) {
        const due = rounds.filter(round => {
          if (!round.start_date) return false;
          const postponed = tryJson(round.postponed_weeks_json, []);
          const next = new Date(new Date(round.start_date).getTime()
            + (Number(round.current_lecture || 0) + postponed.length) * 7 * 86400000);
          if (postponed.includes(mondayOf(next))) return false;
          round.nextSession = next;
          return next.getTime() >= from && next.getTime() <= to;
        });
        if (!due.length) continue;
        const [attendees] = await pool.query(
          `SELECT da.round_id,da.tenant_id,s.phone,s.name
             FROM daqqi_attendees da
             JOIN subscribers s ON s.id=da.subscriber_id AND s.tenant_id=da.tenant_id
            WHERE da.round_id IN (?)`,
          [due.map(round => round.id)]
        );
        let sent = 0;
        for (const round of due) {
          const sessionDate = round.nextSession.toLocaleDateString('ar-EG', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          });
          const timeLabel = round.time_slot === 'MORNING' ? 'الصباح'
            : round.time_slot === 'NOON' ? 'الظهيرة' : 'المساء';
          for (const attendee of attendees.filter(row => row.round_id === round.id)) {
            if (!attendee.phone) continue;
            const message = renderTemplate('daqqi_session_reminder', {
              name: attendee.name,
              courseTitle: round.course_title,
              sessionDate,
              timeLabel,
            }, round.tenant_id);
            await sendWhatsApp(attendee.phone, message, { tenantId: round.tenant_id }).catch(() => {});
            sent += 1;
          }
        }
        if (sent) logger.info(`[jobs] Daqqi reminder ${label} sent=${sent}`);
      }
    } catch (error) {
      logger.warn('[jobs] Daqqi reminder failed:', error.message);
    }
  }

  async function leadRetargeting() {
    try {
      const [leads] = await pool.query(
        `SELECT id,tenant_id,name,phone,email FROM leads
          WHERE hidden=0
            AND status NOT IN ('converted','lost','not_interested','no_answer')
            AND (retargeting_sent_at IS NULL OR retargeting_sent_at<DATE_SUB(NOW(),INTERVAL 30 DAY))
            AND created_at<DATE_SUB(NOW(),INTERVAL 30 DAY)
            AND phone IS NOT NULL AND phone!=''
          LIMIT 50`
      );
      let sent = 0;
      for (const lead of leads) {
        const message = renderTemplate('lead_retargeting', { name: lead.name }, lead.tenant_id);
        const result = await sendWhatsApp(lead.phone, message, { tenantId: lead.tenant_id })
          .catch(() => ({ ok: false }));
        if (!result.ok) continue;
        await pool.query(
          'UPDATE leads SET retargeting_sent_at=NOW() WHERE id=? AND tenant_id=?',
          [lead.id, lead.tenant_id]
        );
        await pool.query(
          `INSERT IGNORE INTO retargeting_log
             (id,tenant_id,lead_id,channel,template,status,sent_at)
           VALUES (UUID(),?,?,'WHATSAPP','reactivation_30d','SENT',NOW())`,
          [lead.tenant_id, lead.id]
        );
        sent += 1;
      }
      if (sent) logger.info(`[jobs] lead retargeting sent=${sent}`);
    } catch (error) {
      logger.warn('[jobs] lead retargeting failed:', error.message);
    }
  }

  async function waitlistNotify() {
    try {
      const [rows] = await pool.query(
        `SELECT cw.id,cw.tenant_id,cw.subscriber_id,cw.course_id,cw.position,
                s.name,s.phone,c.title course_title
           FROM course_waitlist cw
           JOIN subscribers s ON s.id=cw.subscriber_id AND s.tenant_id=cw.tenant_id
           JOIN courses c ON c.id=cw.course_id AND c.tenant_id=cw.tenant_id
          WHERE cw.notify_sent=0 AND cw.status='waiting' AND c.capacity IS NOT NULL
            AND (SELECT COUNT(*) FROM enrollments e
                  WHERE e.course_id=cw.course_id AND e.tenant_id=cw.tenant_id)<c.capacity
          ORDER BY cw.position ASC LIMIT 20`
      );
      for (const row of rows) {
        if (!row.phone) continue;
        const message = `أهلاً ${row.name} 🎉\nيسعدنا إبلاغك بأن مقعداً أصبح متاحاً في كورس:\n📚 ${row.course_title}\n\nيرجى التواصل معنا خلال 48 ساعة لتأكيد حجزك قبل انتقاله للتالي في القائمة ⏳\n— مهاد نفسي 💚`;
        const result = await sendWhatsApp(row.phone, message, { tenantId: row.tenant_id })
          .catch(() => ({ ok: false }));
        if (!result.ok) continue;
        await pool.query(
          'UPDATE course_waitlist SET notify_sent=1,notified_at=NOW() WHERE id=? AND tenant_id=?',
          [row.id, row.tenant_id]
        );
      }
      if (rows.length) logger.info(`[jobs] waitlist notifications eligible=${rows.length}`);
    } catch (error) {
      logger.warn('[jobs] waitlist notification failed:', error.message);
    }
  }

  // Lead scores factor in age and overdue follow-ups, but were only ever
  // recomputed when a human saved the lead — so an untouched lead kept day-one's
  // score and the pipeline ordering drifted away from reality. This decays them
  // on a schedule instead.
  async function leadScoreRefresh() {
    try {
      const { refreshLeadScores } = require('./leadScoreRefresh');
      const { scanned, updated } = await refreshLeadScores(pool);
      if (updated) logger.info(`[jobs] lead scores refreshed scanned=${scanned} updated=${updated}`);
    } catch (error) {
      logger.warn('[jobs] lead score refresh failed:', error.message);
    }
  }

  return {
    leadScoreRefresh,
    installmentReminder,
    pendingPaymentReminder,
    refreshFxRates,
    daqqiSessionReminder,
    leadRetargeting,
    waitlistNotify,
  };
}

module.exports = { createScheduledJobHandlers };
