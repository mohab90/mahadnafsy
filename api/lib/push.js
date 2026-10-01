'use strict';

const logger = require('./logger').child({ lib: 'push' });

let webpush = null;
try {
  webpush = require('web-push');
} catch (error) {
  logger.warn('web-push package is not installed; push notifications disabled');
}

// The key pair comes from the environment when it is set there. When it is not
// — and it never was on production, which is why no phone ever subscribed —
// the server makes one once and keeps it: the public half in the clear, the
// private half sealed (lib/secretBox.js), in the platform's tenant settings.
// Nobody has a secret to paste, and a restart keeps the same pair, so the
// phones already subscribed stay subscribed.
const envPublic = process.env.PUBLIC_VAPID_KEY || process.env.VAPID_PUBLIC_KEY || '';
const envPrivate = process.env.PRIVATE_VAPID_KEY || process.env.VAPID_PRIVATE_KEY || '';
const vapidSubject = process.env.VAPID_SUBJECT || process.env.PUSH_VAPID_SUBJECT || 'mailto:support@mahadnafsy.com';

let keys = envPublic && envPrivate ? { publicKey: envPublic, privateKey: envPrivate } : null;
let loading = null;

async function ensureVapid() {
  if (!webpush) return null;
  if (keys) return keys;
  if (!loading) {
    loading = (async () => {
      const { getTenantSetting, setTenantSetting } = require('./tenantSettings');
      const { seal, open } = require('./secretBox');
      const { DEFAULT_TENANT } = require('../middleware/tenantContext');
      const saved = await getTenantSetting('push_vapid', { tenantId: DEFAULT_TENANT, fallback: null }).catch(() => null);
      if (saved?.publicKey && saved?.privateSealed) {
        return { publicKey: saved.publicKey, privateKey: open(saved.privateSealed) };
      }
      const made = webpush.generateVAPIDKeys();
      await setTenantSetting('push_vapid', { publicKey: made.publicKey, privateSealed: seal(made.privateKey) }, { tenantId: DEFAULT_TENANT });
      logger.info('generated the web push key pair');
      return made;
    })();
  }
  try {
    keys = await loading;
    webpush.setVapidDetails(vapidSubject, keys.publicKey, keys.privateKey);
    return keys;
  } catch (error) {
    loading = null;
    logger.warn('web push keys unavailable', { err: error.message });
    return null;
  } finally {
    if (keys) loading = null;
  }
}

if (keys && webpush) webpush.setVapidDetails(vapidSubject, keys.publicKey, keys.privateKey);

async function getPublicKey() {
  return (await ensureVapid())?.publicKey || null;
}

async function sendPushNotification(subscription, payload) {
  if (!await ensureVapid()) {
    const err = new Error('push notifications are not configured');
    err.statusCode = 503;
    throw err;
  }
  await webpush.sendNotification(subscription, JSON.stringify(payload));
  return true;
}

module.exports = {
  ensureVapid,
  getPublicKey,
  sendPushNotification,
};
