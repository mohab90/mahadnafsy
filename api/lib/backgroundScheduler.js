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

  later(() => {
    const sync = () => syncAllConfiguredSheets()
      .then(result => {
        if (result?.imported) logger.info(`[jobs] Google Sheets imported=${result.imported}`);
      })
      .catch(error => logger.warn('[jobs] Google Sheets sync failed:', error.message));
    sync();
    repeat(sync, 30 * 60 * 1000);
  }, 20000);

  schedule('installment_reminder', 60 * 60 * 1000);
  schedule('pending_payment_reminder', 24 * 60 * 60 * 1000, 2 * 60 * 1000);
  schedule('fx_refresh', 24 * 60 * 60 * 1000, 30000);
  schedule('subscription_billing', 24 * 60 * 60 * 1000, 5 * 60 * 1000, { tenantId: 'system' });

  const automation = () => require('./automationEngine')
    .runAutomationWorkflows({ actor: 'scheduled-automation' })
    .catch(error => logger.warn('[jobs] automation failed:', error.message));
  later(() => { automation(); repeat(automation, 24 * 60 * 60 * 1000); }, 90000);
  later(() => {
    scheduledJobs.daqqiSessionReminder();
    repeat(scheduledJobs.daqqiSessionReminder, 60 * 60 * 1000);
  }, 3 * 60 * 1000);
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

  const outbox = require('./outbox');
  const email = require('./email');
  const sms = require('./otpProvider');
  const financeOutbox = require('./financeOutbox');
  const leadDealValue = require('./leadDealValue');
  const crmSla = require('./crmSla');
  const connectorEvents = require('./connectorEvents');
  const { processFacebookLeadEvent } = require('./facebookLeadEvents');
  const handlers = {
    fx_refresh: scheduledJobs.refreshFxRates,
    installment_reminder: scheduledJobs.installmentReminder,
    pending_payment_reminder: scheduledJobs.pendingPaymentReminder,
    subscription_billing: () => subscriptionBilling.runSubscriptionBilling(),
  };
  const worker = async () => {
    try {
      await crmSla.enqueueOverdueLeadAlerts();
      await promoteLegacyEmailSequenceQueue();
      await outbox.drain({
        email: ({ recipient, subject, body, html, tenantId }) =>
          email.sendEmail(recipient, subject, html || body || '', { tenantId }),
        whatsapp: ({ recipient, message, tenantId }) =>
          sendWhatsApp(recipient, message || '', { tenantId }),
        sms: ({ recipient, message, tenantId }) =>
          sms.sendSms({ phone: recipient, message: message || '', tenantId }),
      });
      await financeOutbox.drainFinanceOutbox({
        sync_lead_deal_value: ({ tenant_id: tenantId, payload }) =>
          leadDealValue.syncLeadDealValue(payload.subscriberId, tenantId, true),
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
