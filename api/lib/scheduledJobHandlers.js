'use strict';

const { tryJson } = require('./helpers');
const outbox = require('./outbox');
const { filterSuppressed, WHATSAPP_OPT_OUT_HINT } = require('./marketingConsent');
const { toDialable } = require('./phoneNumber');
const { renderTemplate } = require('./messageTemplates');
const { createNotification } = require('./notification');
const { getTenantSetting, setTenantSetting } = require('./tenantSettings');
const { invalidateFxCache } = require('./finance');
const { cacheInvalidate } = require('./db');
const { notifyWaitlistForFreedSeats } = require('./courseWaitlist');
const { cairoToday, addDaysToDateOnly } = require('./dates');
const { installmentPlansBySubscriber } = require('./installmentPlansBySubscriber');

// Every message these jobs send goes through the outbox (lib/outbox.js), each
// under a key that says what it is about, so a second run of the job — the
// next hour, a restart, a second process — finds it already queued instead of
// sending it again. They used to call sendWhatsApp one by one: the installment
// reminder remembered what it had sent in a Set that a restart emptied, and
// the Dokki reminder's 24-hour window is two hours wide, so an hourly job
// reached the same people twice.
const DAY_MS = 24 * 60 * 60 * 1000;
// «كل 30 يوم» — the re-engagement message's window: one per lead per window.
const REENGAGEMENT_WINDOW_DAYS = 30;
const reengagementWindow = (now = Date.now()) => Math.floor(now / (REENGAGEMENT_WINDOW_DAYS * DAY_MS));

function queueWhatsApp({ tenantId, phone, message, category, dedupeKey, refType = null, refId = null }) {
  const recipient = toDialable(phone);
  if (!recipient || !message) return Promise.resolve(null);
  return outbox.enqueue({
    channel: 'whatsapp', recipient, tenantId, dedupeKey, refType, refId,
    payload: { message, category },
  });
}

function createScheduledJobHandlers({ pool, logger }) {
  async function installmentReminder() {
    try {
      const target = addDaysToDateOnly(cairoToday(), 3);
      const [subscribers] = await pool.query(
        `SELECT DISTINCT s.id,s.tenant_id,s.name,s.phone,s.crm_json FROM subscribers s
          LEFT JOIN installment_plans ip ON ip.subscriber_id=s.id AND ip.tenant_id=s.tenant_id AND ip.status='active'
          WHERE s.is_active=1 AND s.deleted_at IS NULL
            AND (ip.id IS NOT NULL OR s.crm_json LIKE '%installmentPlans%') LIMIT 2000`
      );
      const plansBySub = new Map();
      for (const tenantId of new Set(subscribers.map(subscriber => subscriber.tenant_id))) {
        const ids = subscribers.filter(subscriber => subscriber.tenant_id === tenantId).map(subscriber => subscriber.id);
        for (const [id, plans] of await installmentPlansBySubscriber(tenantId, ids, pool)) plansBySub.set(id, plans);
      }
      let sent = 0;
      for (const subscriber of subscribers) {
        const plans = plansBySub.get(subscriber.id) || tryJson(subscriber.crm_json, {}).installmentPlans || [];
        for (const plan of plans) {
          for (const entry of plan.entries || []) {
            const dueDate = String(entry.dueDate || '').slice(0, 10);
            if (dueDate !== target || entry.paidAt || !subscriber.phone) continue;
            const message = renderTemplate('installment_reminder', {
              amount: entry.amount,
              currency: plan.currency || 'EGP',
              dueDate,
              courseName: plan.courseTitle || 'قسط',
            }, subscriber.tenant_id);
            // Hourly job, one reminder per installment: the key holds it.
            const queued = await queueWhatsApp({
              tenantId: subscriber.tenant_id, phone: subscriber.phone, message, category: 'reminder',
              dedupeKey: `installment-reminder:${subscriber.id}:${dueDate}:${plan.courseId || ''}`,
              refType: 'subscriber', refId: subscriber.id,
            }).catch(error => { logger.warn('[jobs] installment reminder not queued:', error.message); return null; });
            if (queued) sent += 1;
          }
        }
      }
      if (sent) logger.info(`[jobs] installment reminders queued=${sent}`);
    } catch (error) {
      logger.warn('[jobs] installment reminder failed:', error.message);
    }
  }

  async function pendingPaymentReminder() {
    try {
      const cutoff = addDaysToDateOnly(cairoToday(), -3);
      const [rows] = await pool.query(
        `SELECT p.id,p.tenant_id,p.amount,p.currency,p.date,s.name,s.phone
           FROM payments p
           JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=p.tenant_id
          WHERE p.status='pending' AND p.date<=? AND s.phone IS NOT NULL AND s.phone!='' AND p.deleted_at IS NULL
          LIMIT 50`,
        [cutoff]
      );
      // Once a day per payment still pending, as before — now by its key, so a
      // second run on the same day queues nothing.
      const today = cairoToday();
      for (const row of rows) {
        const message = renderTemplate('pending_payment_reminder', {
          amount: row.amount,
          currency: row.currency || 'EGP',
          date: String(row.date || '').slice(0, 10),
        }, row.tenant_id);
        await queueWhatsApp({
          tenantId: row.tenant_id, phone: row.phone, message, category: 'reminder',
          dedupeKey: `pending-payment-reminder:${row.id}:${today}`, refType: 'payment', refId: row.id,
        }).catch(error => logger.warn('[jobs] pending payment reminder not queued:', error.message));
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
      // One provider read for every institute (lib/fxRefresh.js — payments refresh on demand too).
      const { fetchProviderRates, storeTenantRates } = require('./fxRefresh');
      const { sarToEgp, usdToEgp } = await fetchProviderRates();
      const [tenants] = await pool.query("SELECT id FROM tenants WHERE status='active'");
      for (const tenant of tenants) await storeTenantRates(tenant.id, { sarToEgp, usdToEgp });
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
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Cairo',
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
            // The 24-hour window is two hours wide and the job runs hourly:
            // the key is what keeps that to one reminder per session.
            const queued = await queueWhatsApp({
              tenantId: round.tenant_id, phone: attendee.phone, message, category: 'reminder',
              dedupeKey: `daqqi-reminder:${round.id}:${round.nextSession.toISOString().slice(0, 10)}:${label}:${toDialable(attendee.phone)}`,
              refType: 'daqqi_round', refId: round.id,
            }).catch(error => { logger.warn('[jobs] Daqqi reminder not queued:', error.message); return null; });
            if (queued) sent += 1;
          }
        }
        if (sent) logger.info(`[jobs] Daqqi reminder ${label} sent=${sent}`);
      }
    } catch (error) {
      logger.warn('[jobs] Daqqi reminder failed:', error.message);
    }
  }

  // The 30-day re-engagement message to a lead gone quiet. A promotion nobody
  // asked for, so it is one: its own 'marketing' kind (closed until the owner
  // opens it in «أنواع الرسايل»), never to a number that wrote «ستوب» or a lead
  // whose data was erased (is_unsubscribed), and through the outbox, one per
  // lead per 30-day window. It went as 'reminder' — the kind a customer's own
  // session reminder uses — straight from here, without looking at either list.
  async function leadRetargeting() {
    try {
      const [leads] = await pool.query(
        `SELECT id,tenant_id,name,phone,email FROM leads
          WHERE hidden=0 AND COALESCE(is_unsubscribed,0)=0
            AND status NOT IN ('converted','lost','not_interested','no_answer')
            AND (retargeting_sent_at IS NULL OR retargeting_sent_at<DATE_SUB(NOW(),INTERVAL 30 DAY))
            AND created_at<DATE_SUB(NOW(),INTERVAL 30 DAY)
            AND phone IS NOT NULL AND phone!=''
          LIMIT 50`
      );
      const window = reengagementWindow();
      let queued = 0;
      let skipped = 0;
      const mark = (lead, status) => Promise.all([
        // Set for a skipped lead too: left unmarked, the same opted-out leads
        // would fill the 50 every day and nobody else would be reached.
        pool.query('UPDATE leads SET retargeting_sent_at=NOW() WHERE id=? AND tenant_id=?', [lead.id, lead.tenant_id]),
        pool.query(
          `INSERT IGNORE INTO retargeting_log
             (id,tenant_id,lead_id,channel,template,status,sent_at)
           VALUES (UUID(),?,?,'WHATSAPP','reactivation_30d',?,NOW())`,
          [lead.tenant_id, lead.id, status]
        ),
      ]);
      for (const tenantId of new Set(leads.map(lead => lead.tenant_id))) {
        const tenantLeads = leads.filter(lead => lead.tenant_id === tenantId);
        // Fails closed: a list that cannot be read sends nothing this round.
        const allowed = await filterSuppressed(tenantId, 'whatsapp', tenantLeads, 'phone', pool).catch(error => {
          logger.warn('[jobs] lead retargeting: opt-out list unreadable — nothing sent', error.message);
          return null;
        });
        if (!allowed) continue;
        const allowedIds = new Set(allowed.map(lead => lead.id));
        for (const lead of tenantLeads) {
          if (!allowedIds.has(lead.id)) {
            await mark(lead, 'SKIPPED');
            skipped += 1;
            continue;
          }
          const message = `${renderTemplate('lead_retargeting', { name: lead.name }, tenantId)}\n\n${WHATSAPP_OPT_OUT_HINT}`;
          const id = await queueWhatsApp({
            tenantId, phone: lead.phone, message, category: 'marketing',
            dedupeKey: `lead-reengagement:${lead.id}:${window}`, refType: 'lead', refId: lead.id,
          });
          if (!id) continue;
          await mark(lead, 'QUEUED');
          queued += 1;
        }
      }
      if (queued || skipped) logger.info(`[jobs] lead retargeting queued=${queued} opted-out=${skipped}`);
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

module.exports = { createScheduledJobHandlers, reengagementWindow, REENGAGEMENT_WINDOW_DAYS };
