'use strict';

const { sendWhatsApp } = require('./whatsapp');
const { promoteLegacyEmailSequenceQueue } = require('./emailSequence');
const { syncAllConfiguredSheets } = require('./sheets');

function recurring(queue, type, everyMs, options = {}) {
  return queue.enqueue(type, {}, {
    ...options,
    dedupeKey: queue.recurringDedupeKey(type, everyMs),
  });
}

function startBackgroundScheduler({ pool, logger, port }) {
  require('./dbBackup').scheduleDbBackup();
  require('./errorMonitor').initErrorMonitor();

  if (process.env.ARCHIVE_ACTIVITY_LOGS === 'true') {
    const archive = () => require('./archiveJob').archiveActivityLogs(pool);
    setTimeout(archive, 10 * 60 * 1000).unref?.();
    const interval = setInterval(archive, 24 * 60 * 60 * 1000);
    interval.unref?.();
  }

  const enabled = process.env.NODE_ENV === 'production' || process.env.ENABLE_LOCAL_JOBS === '1';
  if (!enabled) {
    logger.info('[jobs] background scheduler disabled outside production');
    return { enabled: false };
  }

  const queue = require('./jobQueue');
  const scheduledJobs = require('./scheduledJobHandlers').createScheduledJobHandlers({ pool, logger });
  const subscriptionBilling = require('./subscriptionBilling');
  const intervals = [];
  const timeouts = [];
  const later = (fn, delay) => {
    const timer = setTimeout(fn, delay);
    timer.unref?.();
    timeouts.push(timer);
  };
  const repeat = (fn, everyMs) => {
    const timer = setInterval(fn, everyMs);
    timer.unref?.();
    intervals.push(timer);
  };
  const schedule = (type, everyMs, delay = 0, options = {}) => {
    const enqueue = () => recurring(queue, type, everyMs, options).catch(error =>
      logger.warn(`[jobs] enqueue ${type} failed:`, error.message));
    if (delay) later(enqueue, delay); else enqueue();
    repeat(enqueue, everyMs);
  };

  require('./hrAuditRetentionJob').scheduleHrAuditRetention({ pool, logger });

  // Yesterday's unmarked working days, for tenants that switched automatic
  // absence on (lib/autoAbsence.js — off by default). Hourly and idempotent: the
  // insert ignores a day that already has a row, so repeats and a second instance
  // change nothing.
  later(() => {
    const run = async () => {
      try {
        const { markAutoAbsences } = require('./autoAbsence');
        const [tenants] = await pool.query("SELECT id FROM tenants WHERE status='active'").catch(() => [[]]);
        for (const tenant of (tenants.length ? tenants : [{ id: process.env.DEFAULT_TENANT_ID || 'tenant-default' }])) {
          const result = await markAutoAbsences({ pool, tenantId: tenant.id });
          if (result.marked) logger.info(`[jobs] auto-absence ${tenant.id} ${result.date}: ${result.marked}`);
        }
      } catch (error) { logger.warn('[jobs] auto-absence failed:', error.message); }
    };
    run();
    repeat(run, 60 * 60 * 1000);
  }, 5 * 60 * 1000);

  later(() => {
    const sync = () => syncAllConfiguredSheets()
      .then(result => {
        if (result?.imported) logger.info(`[jobs] Google Sheets imported=${result.imported}`);
      })
      .catch(error => logger.warn('[jobs] Google Sheets sync failed:', error.message));
    sync();
    repeat(sync, 30 * 60 * 1000);
  }, 20000);
  // Collection officers' linked sheets (lib/collectionSheets.js), offset from
  // the leads sync above.
  later(() => {
    const sync = () => require('./collectionSheets').syncAllCollectionSheets()
      .then(result => {
        if (result?.created) logger.info(`[jobs] collection sheets created=${result.created}`);
      })
      .catch(error => logger.warn('[jobs] collection sheets sync failed:', error.message));
    sync();
    repeat(sync, 30 * 60 * 1000);
  }, 5 * 60 * 1000);

  schedule('installment_reminder', 60 * 60 * 1000);
  schedule('pending_payment_reminder', 24 * 60 * 60 * 1000, 2 * 60 * 1000);
  schedule('fx_refresh', 24 * 60 * 60 * 1000, 30000);
  // Every 6h, offset well clear of the reminder sweeps so the two aren't
  // competing for connections on the same table.
  schedule('lead_score_refresh', 6 * 60 * 60 * 1000, 3 * 60 * 1000);
  // Daily, and offset well past the score refresh so the two are not
  // rewriting the same rows at once.
  schedule('lead_auto_archive', 24 * 60 * 60 * 1000, 20 * 60 * 1000);
  schedule('subscription_billing', 24 * 60 * 60 * 1000, 5 * 60 * 1000, { tenantId: 'system' });

  const automation = () => require('./automationEngine')
    .runAutomationWorkflows({ actor: 'scheduled-automation' })
    .catch(error => logger.warn('[jobs] automation failed:', error.message));
  later(() => { automation(); repeat(automation, 24 * 60 * 60 * 1000); }, 90000);
  later(() => {
    scheduledJobs.daqqiSessionReminder();
    repeat(scheduledJobs.daqqiSessionReminder, 60 * 60 * 1000);
  }, 3 * 60 * 1000);
  // Leads left waiting once every rep reached the day's cap (lib/leadBacklog.js).
  later(() => {
    const backlog = () => require('./leadBacklog').runLeadBacklog()
      .catch(error => logger.warn('[jobs] lead backlog failed:', error.message));
    backlog();
    repeat(backlog, 60 * 60 * 1000);
  }, 8 * 60 * 1000);
  later(() => {
    scheduledJobs.leadRetargeting();
    repeat(scheduledJobs.leadRetargeting, 24 * 60 * 60 * 1000);
  }, 5 * 60 * 1000);
  later(() => {
    scheduledJobs.waitlistNotify();
    repeat(scheduledJobs.waitlistNotify, 30 * 60 * 1000);
  }, 7 * 60 * 1000);
  const dripCampaigns = () => require('./dripCampaigns')
    .processDripCampaigns({ pool, logger })
    .catch(error => logger.warn('[jobs] CRM drip failed:', error.message));
  later(() => {
    dripCampaigns();
    repeat(dripCampaigns, 15 * 60 * 1000);
  }, 2 * 60 * 1000);

  // «يبعتي تقرير يومي علي الواتس اب بتاعي»: queued once its hour has come,
  // one a day by its dedupe key.
  const ownerReports = require('./ownerDailyReport');
  later(() => {
    const tick = () => ownerReports.queueDueOwnerReports({ queue, logger })
      .catch(error => logger.warn('[jobs] owner report tick failed:', error.message));
    tick();
    repeat(tick, 10 * 60 * 1000);
  }, 4 * 60 * 1000);

  later(() => {
    const tick = () => require('./aiAutopilot').queueDueAutopilot({ queue, logger })
      .catch(error => logger.warn('[jobs] ai autopilot tick failed:', error.message));
    tick();
    repeat(tick, 15 * 60 * 1000);
  }, 6 * 60 * 1000);

  const outbox = require('./outbox');
  const email = require('./email');
  const sms = require('./otpProvider');
  const messenger = require('./messenger');
  const financeOutbox = require('./financeOutbox');
  const leadDealValue = require('./leadDealValue');
  const commissionCalc = require('./commissionCalc');
  const crmSla = require('./crmSla');
  const connectorEvents = require('./connectorEvents');
  const { processFacebookLeadEvent } = require('./facebookLeadEvents');
  const handlers = {
    fx_refresh: scheduledJobs.refreshFxRates,
    installment_reminder: scheduledJobs.installmentReminder,
    pending_payment_reminder: scheduledJobs.pendingPaymentReminder,
    lead_score_refresh: scheduledJobs.leadScoreRefresh,
    lead_auto_archive: scheduledJobs.leadAutoArchive,
    subscription_billing: () => subscriptionBilling.runSubscriptionBilling(),
    // «خلي السيستم يفيد نفسه»: SEO, community posts, study articles, quizzes.
    ai_autopilot: ({ tenantId, date, only }) => require('./aiAutopilot').runAutopilot({ tenantId, date, only }),
    // A report that reached no number is retried; a switched-off one is not.
    owner_daily_report: async ({ tenantId, date }) => {
      const result = await ownerReports.sendOwnerDailyReport({ tenantId, date });
      if (!result.sent && result.results?.length) {
        throw new Error(`owner report not delivered: ${result.results.map(r => r.reason).join(', ')}`);
      }
    },
  };
  const worker = async () => {
    try {
      await crmSla.enqueueOverdueLeadAlerts();
      await promoteLegacyEmailSequenceQueue();
      await outbox.drain({
        // A category queued with the message (a receipt is 'payment') survives
        // EMAIL_OUTBOUND_CATEGORIES the way the direct send does.
        email: ({ recipient, subject, body, html, tenantId, category }) =>
          email.sendEmail(recipient, subject, html || body || '', { tenantId, category }),
        // channelId decides which identity it goes out from — the company
        // number, or the rep's own WhatsApp the campaign was composed against.
        // The category the message was queued with. Every queued message was
        // sent as 'broadcast' — a receipt, a welcome, a reply to a ticket, an
        // alert to a rep — so the gate refused them all as bulk messaging, and
        // opening 'payment' could never have let a receipt through.
        whatsapp: ({ recipient, message, tenantId, channelId, staffId, category }) =>
          sendWhatsApp(recipient, message || '', { tenantId, channelId, staffId, category: category || 'broadcast' }),
        messenger: async ({ recipient, message, tenantId, channelId }) => {
          const { getSendableChannel } = require('./messagingChannels');
          const resolved = await getSendableChannel({ tenantId, channelId, kind: 'messenger' });
          if (!resolved) return { ok: false, reason: 'not_configured' };
          return messenger.sendMessengerMessage(recipient, message || '', resolved.credentials);
        },
        sms: ({ recipient, message, tenantId }) =>
          sms.sendSms({ phone: recipient, message: message || '', tenantId }),
      });
      await financeOutbox.drainFinanceOutbox({
        sync_lead_deal_value: ({ tenant_id: tenantId, payload }) =>
          leadDealValue.syncLeadDealValue(payload.subscriberId, tenantId, true),
        // Commission used to be computed in a setImmediate off the Paymob
        // callback whose catch only logged, so any fault silently dropped what a
        // rep was owed. Here a fault is retried by the outbox instead.
        record_commission: ({ tenant_id: tenantId, payload }) =>
          commissionCalc.recordCommissionForPayment({
            tenantId,
            paymentId: payload.paymentId,
            subscriberId: payload.subscriberId,
            amount: payload.amount,
            branchId: payload.branchId,
          }),
      });
      await connectorEvents.drainConnectorEvents({
        facebook_leads: processFacebookLeadEvent,
      });
      await queue.processBatch(handlers, `srv-${process.pid}`);
    } catch (error) {
      logger.warn('[worker] tick failed:', error.message);
    }
  };
  repeat(worker, 60 * 1000);

  const lifecycle = () => require('./lifecycle').scanScheduled()
    .catch(error => logger.warn('[lifecycle] scan failed:', error.message));
  later(() => { lifecycle(); repeat(lifecycle, 60 * 60 * 1000); }, 10 * 60 * 1000);

  const selfPing = () => {
    const delay = 10 * 60 * 1000 + Math.floor(Math.random() * 3 * 60 * 1000);
    later(() => {
      const request = require('http').get(
        `http://127.0.0.1:${port}/api/health`,
        { timeout: 5000 },
        response => response.resume()
      );
      request.on('error', () => {});
      request.end();
      selfPing();
    }, delay);
  };
  selfPing();
  logger.info('[jobs] background scheduler started');
  return { enabled: true, intervals, timeouts };
}

module.exports = { startBackgroundScheduler };
