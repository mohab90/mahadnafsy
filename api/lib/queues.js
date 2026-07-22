'use strict';

const logger = require('./logger').child({ module: 'queues' });

let queueState = null;

function createDisabledQueue(reason) {
  return {
    enabled: false,
    reason,
    backgroundQueue: null,
    async addJob(name, data) {
      logger.warn('background queue disabled; job skipped', { name, reason });
      return { skipped: true, name, data, reason };
    },
  };
}

function getQueueState() {
  if (queueState) return queueState;

  if (process.env.QUEUE_ENABLED !== 'true') {
    queueState = createDisabledQueue('QUEUE_ENABLED is not true');
    return queueState;
  }

  try {
    const { Queue, Worker } = require('bullmq');
    const Redis = require('ioredis');
    const connection = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => (times > 10 ? null : Math.min(times * 50, 2000)),
    });

    const backgroundQueue = new Queue('background-jobs', { connection });
    const worker = new Worker('background-jobs', async (job) => {
      logger.info('starting background job', { id: job.id, name: job.name });

      if (job.name === 'send-whatsapp') {
        const { sendWhatsApp } = require('./whatsapp');
        const { phone, message, tenantId } = job.data || {};
        if (!phone || !message) throw new Error('Missing WhatsApp job payload');
        return sendWhatsApp(phone, message, { tenantId });
      }

      if (job.name === 'send-email') {
        const { sendEmail } = require('./email');
        const { to, subject, html, tenantId } = job.data || {};
        if (!to || !subject) throw new Error('Missing email job payload');
        return sendEmail(to, subject, html, { tenantId });
      }

      if (job.name === 'check-abandoned-carts') {
        const { checkAbandonedCarts } = require('./abandonedCheckout');
        return checkAbandonedCarts();
      }

      logger.warn('unknown background job type', { name: job.name });
      return false;
    }, { connection });

    worker.on('failed', (job, err) => {
      logger.error('background job failed', { id: job && job.id, name: job && job.name, error: err.message });
    });

    backgroundQueue.add('check-abandoned-carts', {}, {
      repeat: { pattern: '0 * * * *' },
      jobId: 'abandoned-cart-cron',
    }).catch((err) => logger.warn('failed to schedule abandoned cart job', err));

    queueState = {
      enabled: true,
      backgroundQueue,
      addJob: (name, data, options) => backgroundQueue.add(name, data, options),
    };
  } catch (err) {
    queueState = createDisabledQueue(err.message);
  }

  return queueState;
}

async function addJob(name, data, options) {
  return getQueueState().addJob(name, data, options);
}

module.exports = {
  addJob,
  getQueueState,
  get backgroundQueue() {
    return getQueueState().backgroundQueue;
  },
};
