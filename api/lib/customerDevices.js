'use strict';

// Two devices per customer account; the third is refused with a message that
// says so (migration 221 has the owner's words and why a device is not an IP).
//
// A device is the browser: a random id in a long-lived httpOnly cookie, stored
// only as a keyed hash so a copy of the table cannot be turned back into
// cookies. Signing in from a device already on the list just refreshes it;
// from a new one takes a free place, or is refused when both are taken. Staff
// are never counted — they sign in with allowConcurrent (lib/singleSession.js).

const crypto = require('crypto');
const { uuidv4 } = require('./id');
const { resolveSecret } = require('./secretResolver');
const { getClientIp } = require('./clientContext');

const DEVICE_COOKIE = 'mahadDevice';
const MAX_CUSTOMER_DEVICES = Math.max(1, Number(process.env.CUSTOMER_MAX_DEVICES) || 2);
const COOKIE_MAX_AGE_SECONDS = 5 * 365 * 24 * 60 * 60;
const DEVICE_LIMIT_MESSAGE = `انت فتحت حسابك من أكتر من جهاز. الحساب مسموح عليه ${MAX_CUSTOMER_DEVICES === 2 ? 'جهازين' : `${MAX_CUSTOMER_DEVICES} أجهزة`} بس — `
  + 'لو غيّرت جهازك تواصل مع الدعم يفتحلك الجهاز الجديد.';

function hashDeviceId(deviceId) {
  const secret = resolveSecret('SESSION_BINDING_SECRET') || resolveSecret('JWT_SECRET');
  if (!secret) throw new Error('SESSION_BINDING_SECRET or JWT_SECRET is required');
  return crypto.createHmac('sha256', secret).update(`device:${deviceId}`).digest('hex');
}

/** The device id this browser already carries, or a new one set on the response. */
function deviceIdFor(req) {
  if (req?.mahadDeviceId) return req.mahadDeviceId;
  const carried = String(req?.headers?.cookie || '').match(/(?:^|;\s*)mahadDevice=([0-9a-f-]{36})(?:;|$)/i)?.[1];
  let deviceId = carried ? carried.toLowerCase() : null;
  if (!deviceId) {
    deviceId = uuidv4();
    req?.res?.append?.('Set-Cookie',
      `${DEVICE_COOKIE}=${deviceId}; HttpOnly; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=None; Secure`);
  }
  if (req) req.mahadDeviceId = deviceId;
  return deviceId;
}

function deviceLimitError() {
  return Object.assign(new Error(DEVICE_LIMIT_MESSAGE), { statusCode: 403, code: 'DEVICE_LIMIT' });
}

/**
 * Record this sign-in's device for a customer, inside the caller's transaction
 * and after the user row is locked, so two sign-ins at once cannot both take
 * the last place. Throws DEVICE_LIMIT when the account already has its two.
 */
async function registerCustomerDevice(conn, { tenantId, userId, req }) {
  const deviceHash = hashDeviceId(deviceIdFor(req));
  const ip = getClientIp(req) || null;
  const userAgent = String(req?.get?.('user-agent') || '').slice(0, 255) || null;
  const [devices] = await conn.query(
    'SELECT id, device_hash FROM customer_devices WHERE tenant_id=? AND user_id=?', [tenantId, userId]);
  const known = devices.find(device => device.device_hash === deviceHash);
  if (known) {
    await conn.query('UPDATE customer_devices SET last_ip=?, user_agent=?, last_seen_at=NOW() WHERE id=?',
      [ip, userAgent, known.id]);
    return { deviceCount: devices.length, known: true };
  }
  if (devices.length >= MAX_CUSTOMER_DEVICES) throw deviceLimitError();
  await conn.query(
    'INSERT INTO customer_devices (id, tenant_id, user_id, device_hash, last_ip, user_agent) VALUES (?,?,?,?,?,?)',
    [uuidv4(), tenantId, userId, deviceHash, ip, userAgent]);
  return { deviceCount: devices.length + 1, known: false };
}

async function listCustomerDevices(db, { tenantId, userId }) {
  const [rows] = await db.query(
    `SELECT id, last_ip, user_agent, first_seen_at, last_seen_at FROM customer_devices
      WHERE tenant_id=? AND user_id=? ORDER BY first_seen_at`, [tenantId, userId]);
  return rows.map(row => ({
    id: row.id, ip: row.last_ip, userAgent: row.user_agent, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,
  }));
}

async function clearCustomerDevices(db, { tenantId, userId }) {
  const [result] = await db.query('DELETE FROM customer_devices WHERE tenant_id=? AND user_id=?', [tenantId, userId]);
  return result.affectedRows || 0;
}

module.exports = {
  DEVICE_COOKIE, DEVICE_LIMIT_MESSAGE, MAX_CUSTOMER_DEVICES,
  clearCustomerDevices, deviceIdFor, listCustomerDevices, registerCustomerDevice,
};
