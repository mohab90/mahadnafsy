'use strict';

const { tryJson } = require('./helpers');
const { sendWhatsApp } = require('./whatsapp');
const { renderTemplate } = require('./messageTemplates');
const { createNotification } = require('./notification');
const { getTenantSetting, setTenantSetting } = require('./tenantSettings');
const { invalidateFxCache } = require('./finance');
const { cacheInvalidate } = require('./db');
const { notifyWaitlistForFreedSeats } = require('./courseWaitlist');

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
            await sendWhatsApp(subscriber.phone, message, { tenantId: subscriber.tenant_id, category: 'reminder' }).catch(() => {});
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
        await sendWhatsApp(row.phone, message, { tenantId: row.tenant_id, category: 'reminder' });
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
        // Recipient filter, deliberately scoped to this messaging path only.
        // Archiving a client (DELETE /api/admin/subscribers/:id -> is_active=0
        // + deleted_at) and privacy erasure (is_unsubscribed=1) both leave the
        // daqqi_attendees row intact, which is what keeps the attendance history
        // and the per-round counts whole. Neither client should still receive a
        // WhatsApp, so the narrowing belongs here and must not be pushed down
        // into getDaqqiAttendees(), which feeds those counts.
        const [attendees] = await pool.query(
          `SELECT da.round_id,da.tenant_id,s.phone,s.name
             FROM daqqi_attendees da
             JOIN subscribers s ON s.id=da.subscriber_id AND s.tenant_id=da.tenant_id
            WHERE da.round_id IN (?)
              AND s.deleted_at IS NULL AND s.is_active=1 AND s.is_unsubscribed=0`,
          [due.map(round => round.id)]
        );
        let sent = 0;
        for (const round of due) {
          const sessionDate = round.nextSession.toLocaleDateString('ar-EG-u-nu-latn', {
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
            await sendWhatsApp(attendee.phone, message, { tenantId: round.tenant_id, category: 'reminder' }).catch(() => {});
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
        const result = await sendWhatsApp(lead.phone, message, { tenantId: lead.tenant_id, category: 'reminder' })
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

  // The sweep calls the rule instead of carrying its own copy of it.
  //
  // It used to query cw.notify_sent and c.capacity. Neither column exists —
  // course_waitlist tracks status and notified_at, and a course's size is
  // max_students. So every run since this was written threw 1054 on its first
  // query, the catch below logged it as a warning, and nobody on any waiting
  // list has ever been told a seat opened. It runs seven minutes after boot and
  // every thirty minutes after that.
  //
  // lib/courseWaitlist.js has the correct implementation and always did — it
  // fires on revokeCourseEntitlement. This was a second copy that had drifted
  // off the schema, so it is now the same one function, called per course that
  // has anyone waiting.
  async function waitlistNotify() {
    try {
      const [pending] = await pool.query(
        `SELECT DISTINCT cw.tenant_id, cw.course_id
           FROM course_waitlist cw
           JOIN courses c ON c.id=cw.course_id AND c.tenant_id=cw.tenant_id
          WHERE cw.status='waiting' AND c.max_students IS NOT NULL
            AND c.deleted_at IS NULL
          LIMIT 100`
      );
      let notified = 0;
      for (const row of pending) {
        const conn = await pool.getConnection();
        try {
          notified += await notifyWaitlistForFreedSeats(row.tenant_id, row.course_id, conn);
        } catch (error) {
          logger.warn('[jobs] waitlist notify failed for course', row.course_id, error.message);
        } finally {
          conn.release();
        }
      }
      if (notified) logger.info(`[jobs] waitlist notifications sent=${notified} across ${pending.length} course(s)`);
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

  // Leads nobody ever contacted, old enough that nobody is going to. They are
  // not a work list — they are what makes the work list unreadable. Off unless
  // crm_settings.autoArchiveDays says otherwise, because archiving thousands
  // of leads is a decision about how the desk works, not a default.
  async function leadAutoArchive() {
    try {
      const settings = await getTenantSetting('crm_settings', { fallback: {} });
      const olderThanDays = Number(settings?.autoArchiveDays) || 0;
      if (olderThanDays <= 0) return;
      const { archiveColdLeads } = require('./leadAutoArchive');
      const { eligible, archived } = await archiveColdLeads(pool, { olderThanDays });
      if (archived) {
        logger.info('[jobs] cold leads archived', { olderThanDays, eligible, archived });
      }
    } catch (error) {
      logger.warn('[jobs] lead auto-archive failed:', error.message);
    }
  }

  return {
    leadScoreRefresh,
    leadAutoArchive,
    installmentReminder,
    pendingPaymentReminder,
    refreshFxRates,
    daqqiSessionReminder,
    leadRetargeting,
    waitlistNotify,
  };
}

module.exports = { createScheduledJobHandlers };
