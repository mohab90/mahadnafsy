#!/usr/bin/env node
'use strict';

/**
 * The Paymob path, end to end, on staging — without moving any money.
 *
 * A real card payment is the one step no tool here may take. Everything our
 * server does with a payment is testable without one: Paymob's side of the
 * exchange is an HMAC-signed callback, and this signs callbacks with staging's
 * own secret, exactly as Paymob would, then checks what the server did with
 * each — in the database, not in the response.
 *
 * Covers: catalogue price enforcement at reserve; a genuine capture crediting
 * the order, the payment row and the course access; a replayed callback crediting
 * nothing twice; a paid order refusing to be re-reserved; a short capture, a
 * wrong currency, a forged signature and a declined card each crediting nothing;
 * and the verify endpoint reporting a refused capture as not paid.
 *
 * Paymob is switched on for staging for the length of the run and put back
 * exactly as found. Refuses to run against any database but the staging one.
 *
 *   node tools/paymob-staging-smoke.cjs /var/www/mahad-staging/api/.env
 */

const path = require('path');
const envPath = process.argv[2] || path.join(__dirname, '..', '.env');
require('dotenv').config({ path: envPath });
const mysql = require('mysql2/promise');
const { buildPaymobHmacPayload } = require('../lib/paymobHmac');
const crypto = require('crypto');

const API = (process.env.SMOKE_API || `http://127.0.0.1:${process.env.PORT || 3002}`).replace(/\/$/, '');
const PASSWORD = process.env.UAT_PASSWORD || 'MahadUat#2026';
const TENANT = 'tenant-default';

if (process.env.DB_NAME !== 'mahadnafsy_test' || !/:3002$/.test(API)) {
  console.error(`refusing: this only runs against the staging database and port (got ${process.env.DB_NAME} / ${API})`);
  process.exit(2);
}

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  pass' : '  FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

async function call(p, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, cookie: res.headers.get('set-cookie') || '' };
}

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const started = new Date(Date.now() - 2000);
  const run = `smoke-paymob-${Date.now().toString(36)}`;
  const email = `release-smoke+${run}@mahad.test`;

  // ── owner session, and the gateway as it is now ───────────────────────
  const loginRes = await call('/api/auth/login', { method: 'POST', body: { email: 'uat.admin@mahad.test', password: PASSWORD } });
  const token = decodeURIComponent((/authToken=([^;]+)/.exec(loginRes.cookie) || [])[1] || '');
  if (!token) throw new Error('uat.admin login failed: ' + loginRes.status);
  const [[priorRow]] = await db.query("SELECT config_json FROM tenant_settings WHERE tenant_id=? AND section='sys_payment_gateway' LIMIT 1", [TENANT]);
  const snapshot = (await call('/api/admin/sys-config?section=payment_gateway', { token })).json;

  let restored = false;
  const restore = async () => {
    if (restored) return; restored = true;
    if (priorRow) {
      const r = await call('/api/admin/sys-config/payment_gateway', { method: 'PUT', token, body: snapshot });
      console.log(`\n  gateway restored to its previous saved config: ${r.status}`);
    } else {
      const r = await call('/api/admin/sys-config/payment_gateway/reset', { method: 'POST', token });
      await db.query("DELETE FROM tenant_settings WHERE tenant_id=? AND section='sys_payment_gateway'", [TENANT]);
      console.log(`\n  gateway restored: no saved config existed, so the reset row was removed again (${r.status})`);
    }
  };

  try {
    // Staging has no Paymob HMAC secret of its own, and production's is not ours
    // to borrow. A throwaway secret for this run only, gone with the restore.
    const runSecret = crypto.randomBytes(32).toString('hex');
    const enable = await call('/api/admin/sys-config/payment_gateway', { method: 'PUT', token,
      body: { ...(snapshot || {}), active_provider: 'paymob',
        paymob: { ...((snapshot || {}).paymob || {}), enabled: true, hmac_secret: runSecret } } });
    if (enable.status !== 200) throw new Error('could not enable paymob on staging: ' + enable.status + ' ' + enable.text.slice(0, 120));
    await new Promise(r => setTimeout(r, 1500));

    // The secret the webhook will check against, resolved the way the route does.
    const { getPaymentGatewaySettings } = require('../lib/saasSettings');
    const gw = await getPaymentGatewaySettings(TENANT);
    const secret = gw?.paymob?.hmac_secret || process.env.PAYMOB_HMAC_SECRET || '';
    if (!secret) throw new Error('staging has no Paymob HMAC secret to sign with');

    const courses = (await call('/api/courses')).json;
    const list = Array.isArray(courses) ? courses : (courses?.courses || courses?.items || []);
    const course = list.find(c => Number(c.price?.EGP) > 0);
    if (!course) throw new Error('no priced course on staging');
    const price = Number(course.price.EGP);
    console.log(`paymob on staging, course ${course.id} at ${price} EGP, run ${run}\n`);

    let txn = Math.floor(Date.now() / 1000) * 10;
    const reserve = (orderId, amount) => call('/api/orders/reserve', { method: 'POST', body: {
      orderId, type: 'course', itemId: course.id, itemTitle: course.title, amount, currency: 'EGP',
      paymentMethod: 'paymob', customerEmail: email, customerName: 'Release Smoke', customerPhone: '01000000000',
    } });
    const callback = (orderId, over = {}) => {
      const obj = {
        amount_cents: Math.round(price * 100), created_at: new Date().toISOString(), currency: 'EGP',
        error_occured: false, has_parent_transaction: false, id: ++txn, integration_id: 1,
        is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false,
        is_standalone_payment: true, is_voided: false, owner: 1, pending: false,
        order: { id: txn, merchant_order_id: `${orderId}~${Date.now().toString(36)}` },
        source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success: true, ...over,
      };
      const hmac = crypto.createHmac('sha512', secret).update(buildPaymobHmacPayload(obj)).digest('hex');
      return { obj, hmac };
    };
    const webhook = ({ obj, hmac }) => call(`/api/webhooks/paymob?hmac=${hmac}`, { method: 'POST', body: { type: 'TRANSACTION', obj } });
    // orders.status is ENUM('PAID','FAILED','REFUNDED','PENDING'); the code writes
    // and compares it case-insensitively, so this does too.
    const order = async id => {
      const row = (await db.query('SELECT status, amount FROM orders WHERE id=? LIMIT 1', [id]))[0][0];
      return row ? { ...row, status: String(row.status || '').toLowerCase() } : null;
    };
    const payments = async id => (await db.query('SELECT COUNT(*) n, MAX(amount) amount FROM payments WHERE id=? OR id=?', [`paymob-${id}`, id]))[0][0];

    // 1. price comes from the catalogue
    const tampered = await reserve(`${run}-t`, 1);
    record('reserve at a tampered price is refused', tampered.status === 409 && tampered.json?.code === 'PRICE_MISMATCH', `${tampered.status} ${tampered.json?.code || ''}`);

    // 2–5. a genuine capture, a replay, a re-reserve
    const A = `${run}-a`;
    const rA = await reserve(A, price);
    record('reserve at the catalogue price', rA.status === 200 && (await order(A))?.status === 'pending', `${rA.status}`);
    const cbA = callback(A);
    const wA = await webhook(cbA);
    const oA = await order(A); const pA = await payments(A);
    const [[sub]] = await db.query('SELECT id FROM subscribers WHERE tenant_id=? AND LOWER(email)=? LIMIT 1', [TENANT, email]);
    const [[enr]] = sub ? await db.query("SELECT COUNT(*) n FROM enrollments WHERE subscriber_id=? AND course_id=? AND status='active'", [sub.id, course.id]) : [[{ n: 0 }]];
    record('signed capture credits the order', wA.status === 200 && oA?.status === 'paid', `order=${oA?.status}`);
    record('…records exactly one payment at the order amount', Number(pA.n) === 1 && Math.abs(Number(pA.amount) - price) < 0.01, `payments=${pA.n} amount=${pA.amount}`);
    record('…and opens the course for the customer', Number(enr.n) >= 1, `enrollments=${enr.n}`);

    await webhook(cbA);
    record('a replayed callback credits nothing twice', Number((await payments(A)).n) === 1, `payments=${(await payments(A)).n}`);

    const again = await reserve(A, price);
    record('a paid order cannot be re-reserved', again.status === 409 && again.json?.code === 'ORDER_ALREADY_PAID' && (await order(A))?.status === 'paid', `${again.status} ${again.json?.code || ''}`);

    // 6–7. a short capture — webhook and verify
    const B = `${run}-b`;
    await reserve(B, price);
    const shortCb = callback(B, { amount_cents: Math.round(price * 100) - 100 });
    await webhook(shortCb);
    record('a capture 1 EGP short credits nothing', (await order(B))?.status === 'pending' && Number((await payments(B)).n) === 0, `order=${(await order(B))?.status}`);
    const verifyShort = callback(B, { amount_cents: Math.round(price * 100) - 100 });
    const flat = { ...verifyShort.obj, order: verifyShort.obj.order.id, merchant_order_id: verifyShort.obj.order.merchant_order_id,
      'source_data.pan': verifyShort.obj.source_data.pan, 'source_data.sub_type': verifyShort.obj.source_data.sub_type,
      'source_data.type': verifyShort.obj.source_data.type, hmac: verifyShort.hmac };
    delete flat.source_data;
    const v = await call('/api/paymob/verify', { method: 'POST', body: flat });
    record('verify reports a refused capture as not paid', v.status === 200 && v.json?.verified === true && v.json?.paid === false && v.json?.refused === 'amount_mismatch', JSON.stringify(v.json));

    // 8. wrong currency
    const C = `${run}-c`;
    await reserve(C, price);
    await webhook(callback(C, { currency: 'USD' }));
    record('a capture in another currency credits nothing', (await order(C))?.status === 'pending', `order=${(await order(C))?.status}`);

    // 9. forged signature
    const D = `${run}-d`;
    await reserve(D, price);
    const forged = callback(D); forged.hmac = 'f'.repeat(128);
    const wD = await webhook(forged);
    record('a forged signature credits nothing', wD.json?.reason === 'invalid_signature' && (await order(D))?.status === 'pending', `${wD.json?.reason}`);

    // 10. declined
    const E = `${run}-e`;
    await reserve(E, price);
    await webhook(callback(E, { success: false }));
    record('a declined card credits nothing', (await order(E))?.status === 'pending', `order=${(await order(E))?.status}`);

    // Anything this run queued for delivery.
    const [queued] = await db.query("SELECT channel, status, COUNT(*) n FROM message_outbox WHERE created_at >= ? GROUP BY channel, status", [started]);
    console.log(`\n  messages queued during the run: ${queued.length ? JSON.stringify(queued) : 'none'}`);
    record('nothing was actually sent', !queued.some(q => q.status === 'sent'), queued.length ? 'queued only' : '');
  } finally {
    await restore();
    const [[after]] = await db.query("SELECT COUNT(*) n FROM tenant_settings WHERE tenant_id=? AND section='sys_payment_gateway'", [TENANT]);
    console.log(`  gateway row present after restore: ${after.n ? 'yes' : 'no'} (was ${priorRow ? 'yes' : 'no'})`);
    await db.end();
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed — test orders are tagged ${run}-*`);
  process.exit(failed.length ? 1 : 0);
})().catch(err => { console.error('paymob smoke aborted: ' + err.message); process.exit(1); });
