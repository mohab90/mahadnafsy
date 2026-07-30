'use strict';

const crypto = require('node:crypto');
const { resolveSecret } = require('./secretResolver');

const PREFIX = 'mhq1';
const secret = () => resolveSecret('ATTENDANCE_QR_SECRET')
  || resolveSecret('JWT_SECRET')
  || process.env.JWT_SECRET
  || 'development-attendance-qr-secret';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = payload => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

function createAttendanceQr({ tenantId, subscriberId, expiresInDays = 365 }) {
  const payload = encode({
    t: tenantId,
    s: subscriberId,
    e: Math.floor(Date.now() / 1000) + Math.max(1, expiresInDays) * 86400,
  });
  return `${PREFIX}.${payload}.${sign(payload)}`;
}

function verifyAttendanceQr(token, tenantId) {
  const [prefix, payload, signature] = String(token || '').split('.');
  if (prefix !== PREFIX || !payload || !signature) return null;
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (decoded.t !== tenantId || !decoded.s || Number(decoded.e) < Math.floor(Date.now() / 1000)) return null;
    return { subscriberId: String(decoded.s), expiresAt: Number(decoded.e) };
  } catch {
    return null;
  }
}

module.exports = { createAttendanceQr, verifyAttendanceQr };
