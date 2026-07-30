#!/usr/bin/env node
'use strict';

require('dotenv').config();
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const baseUrl = process.env.CUSTOMER_AUTH_GEO_SMOKE_API || 'http://127.0.0.1:3101';
const target = new URL(baseUrl);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || process.env.NODE_ENV !== 'test') {
  throw new Error('customer auth/geo smoke is restricted to a local NODE_ENV=test API');
}
if (!['127.0.0.1', 'localhost'].includes(process.env.DB_HOST || '') || Number(process.env.DB_PORT) !== 3307) {
  throw new Error('customer auth/geo smoke requires the isolated local database on port 3307');
}

const cases = [
  { country: 'EG', currency: 'EGP', branch: 'ONLINE_EGYPT', ip: '203.0.113.10' },
  { country: 'SA', currency: 'SAR', branch: 'ONLINE_SAUDI', ip: '203.0.113.20' },
  { country: 'US', currency: 'USD', branch: 'ONLINE_ABROAD', ip: '203.0.113.30' },
];

async function api(path, { method = 'GET', token, body, ip, country } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip || '203.0.113.100',
      ...(country ? { 'x-test-country-code': country } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  let course;
  try {
    [[course]] = await db.query(
      `SELECT id,title,price_egp,price_sar,price_usd
         FROM courses WHERE tenant_id='tenant-default' AND is_published=1 AND price_egp>0
         ORDER BY created_at DESC LIMIT 1`
    );
    assert.ok(course, 'a published positive-price course fixture is required');
    const fixtureSar = Number(course.price_sar) > 0 ? Number(course.price_sar) : Number((Number(course.price_egp) / 13).toFixed(2));
    const fixtureUsd = Number(course.price_usd) > 0 ? Number(course.price_usd) : Number((Number(course.price_egp) / 48).toFixed(2));
    await db.query('UPDATE courses SET price_sar=?,price_usd=? WHERE id=? AND tenant_id=?', [
      fixtureSar, fixtureUsd, course.id, 'tenant-default',
    ]);
    const expected = { EGP: Number(course.price_egp), SAR: fixtureSar, USD: fixtureUsd };
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const accounts = [];

    for (const item of cases) {
      const context = await api('/api/public/client-context', item);
      assert.equal(context.status, 200);
      assert.equal(context.payload.countryCode, item.country);
      assert.equal(context.payload.currency, item.currency);
      assert.equal(context.payload.branch, item.branch);

      const email = `auth-geo-${item.country.toLowerCase()}-${stamp}@example.test`;
      const password = 'Strong-Test-Password-2026!';
      const registration = await api('/api/auth/register', {
        method: 'POST', ip: item.ip, country: item.country,
        body: { email, password, name: `Geo ${item.country}`, phone: `2010${String(Date.now()).slice(-7)}${cases.indexOf(item)}` },
      });
      assert.equal(registration.status, 200, JSON.stringify(registration.payload));
      const token = registration.payload.token;
      assert.ok(token);
      const [[lead]] = await db.query(
        'SELECT branch FROM leads WHERE tenant_id=? AND LOWER(TRIM(email))=? ORDER BY created_at DESC LIMIT 1',
        ['tenant-default', email]
      );
      assert.equal(lead?.branch, item.branch);
      accounts.push({ ...item, email, password, token });
    }

    const egypt = accounts[0];
    assert.equal((await api('/api/auth/me', { token: egypt.token, ip: egypt.ip })).status, 200);
    assert.equal((await api('/api/auth/me', { token: egypt.token, ip: '203.0.113.11' })).status, 401);
    const relogin = await api('/api/auth/login', {
      method: 'POST', ip: '203.0.113.11',
      body: { email: egypt.email, password: egypt.password },
    });
    assert.equal(relogin.status, 200, JSON.stringify(relogin.payload));
    assert.equal((await api('/api/auth/me', { token: egypt.token, ip: egypt.ip })).status, 401);
    assert.equal((await api('/api/auth/me', { token: relogin.payload.token, ip: '203.0.113.11' })).status, 200);
    egypt.token = relogin.payload.token;
    egypt.ip = '203.0.113.11';

    for (const item of accounts) {
      const checkout = await api('/api/public/checkout-intent', {
        method: 'POST', token: item.token, ip: item.ip, country: item.country,
        body: {
          itemId: course.id, itemType: 'course', itemTitle: course.title,
          customerName: `Geo ${item.country}`, customerEmail: item.email,
          customerPhone: '201000000000',
        },
      });
      assert.equal(checkout.status, 200, JSON.stringify(checkout.payload));
      assert.equal(checkout.payload.currency, item.currency);
      assert.equal(Number(checkout.payload.amount), expected[item.currency]);
      const [[order]] = await db.query(
        'SELECT currency,amount FROM orders WHERE id=? AND tenant_id=? LIMIT 1',
        [checkout.payload.orderId, 'tenant-default']
      );
      assert.equal(order.currency, item.currency);
      assert.equal(Number(order.amount), expected[item.currency]);
    }

    const sessionPayload = jwt.decode(egypt.token);
    const [[active]] = await db.query(
      'SELECT active_session_id,active_session_ip_hash FROM users WHERE id=? AND tenant_id=?',
      [sessionPayload.uid, 'tenant-default']
    );
    assert.equal(active.active_session_id, sessionPayload.sid);
    assert.match(active.active_session_ip_hash, /^[a-f0-9]{64}$/);
    console.log('PASS customer-auth-geo-smoke countries=3 single-session=pass checkout-currencies=3');
  } finally {
    if (course) {
      await db.query('UPDATE courses SET price_sar=?,price_usd=? WHERE id=? AND tenant_id=?', [
        course.price_sar, course.price_usd, course.id, 'tenant-default',
      ]).catch(() => {});
    }
    await db.end();
  }
}

main().catch(error => {
  console.error(`FAIL customer-auth-geo-smoke: ${error.message}`);
  process.exitCode = 1;
});
