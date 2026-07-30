#!/usr/bin/env node
'use strict';

require('dotenv').config();
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const fs = require('node:fs');

const baseUrl = process.env.CUSTOMER_AUTH_GEO_SMOKE_API || 'http://127.0.0.1:3101';
const target = new URL(baseUrl);
const captureFile = String(process.env.FAKE_SMTP_CAPTURE_FILE || '').trim();
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || process.env.NODE_ENV !== 'test') {
  throw new Error('forgot-password smoke is restricted to a local NODE_ENV=test API');
}
if (!['127.0.0.1', 'localhost'].includes(process.env.DB_HOST || '') || Number(process.env.DB_PORT) !== 3307) {
  throw new Error('forgot-password smoke requires the isolated local database on port 3307');
}
if (!captureFile) throw new Error('FAKE_SMTP_CAPTURE_FILE is required to verify the delivered OTP without reading it from the database');

async function api(path, body, { token, ip = '203.0.113.50' } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      'x-test-country-code': 'EG',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  return { status: response.status, payload: await response.json().catch(() => ({})) };
}

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  try {
    const [[user]] = await db.query(
      `SELECT id,email FROM users
        WHERE tenant_id='tenant-default' AND email LIKE 'auth-geo-eg-%@example.test'
        ORDER BY created_at DESC LIMIT 1`
    );
    assert.ok(user, 'run smoke:customer-auth-geo first');
    const oldLogin = await api('/api/auth/login', {
      email: user.email, password: 'Strong-Test-Password-2026!',
    });
    assert.equal(oldLogin.status, 200, JSON.stringify(oldLogin.payload));

    const forgot = await api('/api/auth/forgot-password', { email: user.email });
    assert.equal(forgot.status, 200, JSON.stringify(forgot.payload));
    const [[otp]] = await db.query(
      `SELECT id,code,delivery_status,provider_message_id,sent_at
         FROM otp_codes WHERE tenant_id=? AND email=? AND type='password_reset'
         ORDER BY created_at DESC LIMIT 1`,
      ['tenant-default', user.email]
    );
    assert.equal(otp.delivery_status, 'accepted');
    assert.ok(otp.provider_message_id);
    assert.ok(otp.sent_at);
    assert.match(otp.code, /^[a-f0-9]{64}$/);
    const deliveredMessage = fs.readFileSync(captureFile, 'utf8');
    const otpMatch = deliveredMessage.match(/otp-box[^>]*>(\d{6})</i);
    assert.ok(otpMatch, 'delivered reset email did not contain a six-digit OTP');
    const deliveredOtp = otpMatch[1];
    assert.notEqual(otp.code, deliveredOtp, 'OTP must not be stored in plaintext');

    const verified = await api('/api/auth/verify-otp', { email: user.email, code: deliveredOtp });
    assert.equal(verified.status, 200, JSON.stringify(verified.payload));
    const newPassword = 'Reset-Test-Password-2026!';
    const reset = await api('/api/auth/reset-password', {
      resetToken: verified.payload.resetToken, newPassword,
    });
    assert.equal(reset.status, 200, JSON.stringify(reset.payload));
    const [[revoked]] = await db.query(
      'SELECT active_session_id,active_session_ip_hash FROM users WHERE id=? AND tenant_id=?',
      [user.id, 'tenant-default']
    );
    assert.equal(revoked.active_session_id, null);
    assert.equal(revoked.active_session_ip_hash, null);
    const oldSession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        authorization: `Bearer ${oldLogin.payload.token}`,
        'x-forwarded-for': '203.0.113.50',
      },
    });
    assert.equal(oldSession.status, 401);
    const newLogin = await api('/api/auth/login', { email: user.email, password: newPassword }, {
      ip: '203.0.113.51',
    });
    assert.equal(newLogin.status, 200, JSON.stringify(newLogin.payload));
    console.log('PASS forgot-password-smoke smtp-accepted=pass otp=pass reset-revocation=pass relogin=pass');
  } finally {
    await db.end();
  }
}

main().catch(error => {
  console.error(`FAIL forgot-password-smoke: ${error.message}`);
  process.exitCode = 1;
});
