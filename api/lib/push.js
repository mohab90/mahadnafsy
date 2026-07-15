'use strict';

const logger = require('./logger').child({ lib: 'push' });

let webpush = null;
try {
  webpush = require('web-push');
} catch (error) {
  logger.warn('web-push package is not installed; push notifications disabled');
}

const publicVapidKey = process.env.PUBLIC_VAPID_KEY || process.env.VAPID_PUBLIC_KEY || '';
const privateVapidKey = process.env.PRIVATE_VAPID_KEY || process.env.VAPID_PRIVATE_KEY || '';
const vapidSubject = process.env.VAPID_SUBJECT || process.env.PUSH_VAPID_SUBJECT || 'mailto:support@mahadnafsy.com';

function isPushConfigured() {
  return Boolean(webpush && publicVapidKey && privateVapidKey);
}

if (isPushConfigured()) {
  webpush.setVapidDetails(vapidSubject, publicVapidKey, privateVapidKey);
}

async function sendPushNotification(subscription, payload) {
  if (!isPushConfigured()) {
    const err = new Error('push notifications are not configured');
    err.statusCode = 503;
    throw err;
  }
  await webpush.sendNotification(subscription, JSON.stringify(payload));
  return true;
}

module.exports = {
  isPushConfigured,
  publicVapidKey,
  sendPushNotification,
};
