#!/usr/bin/env node
'use strict';
/**
 * Is Paymob switched on, wired, and crediting? Read-only; prints no secret.
 *
 *   node tools/paymob-check.cjs [--days 30] [--tenant tenant-default]
 *
 * Checks:
 *   1. the gateway: active provider, enabled, and which credentials are set
 *      (names only), PAYMOB_REVIEW_PENDING
 *   2. the last N days of online orders: paid / pending / failed, and the
 *      newest paid one — no paid order since you know people paid means the
 *      callback is not reaching the server
 *   3. every PAID order has its payment row («paymob-<order>» or the same
 *      transaction id) — one without it was charged but never credited
 *   4. Paymob payments that are missing their ledger entry
 *
 * In Paymob's dashboard the «Transaction processed callback» must be
 *   https://<your domain>/api/webhooks/paymob
 * and the HMAC secret there must equal the one saved in the settings.
 */
require('dotenv').config();
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const days = Number(arg('days', 30));
const tenantId = arg('tenant', process.env.DEFAULT_TENANT_ID || 'tenant-default');

(async () => {
  const { pool } = require('../lib/db');
  const { getPaymentGatewaySettings, isPaymobActive } = require('../lib/saasSettings');
  const config = await getPaymentGatewaySettings(tenantId);
  const paymob = config?.paymob || {};
  const has = key => Boolean(String(paymob[key] || '').trim()) || (key === 'hmac_secret' && Boolean(process.env.PAYMOB_HMAC_SECRET));
  const ok = (good, text) => console.log(`${good ? '✓' : '✗'} ${text}`);
  console.log(`Paymob — tenant ${tenantId}, last ${days} days\n`);
  ok(isPaymobActive(config), `active: provider=${config?.active_provider || '—'} enabled=${Boolean(paymob.enabled)}${process.env.PAYMOB_REVIEW_PENDING === 'true' ? ' (PAYMOB_REVIEW_PENDING=true switches it off)' : ''}`);
  for (const key of ['api_key', 'secret_key', 'hmac_secret', 'integration_id_card', 'integration_id_wallet', 'iframe_id']) ok(has(key), `${key} ${has(key) ? 'set' : 'missing'}`);

  const [[orders]] = await pool.query(
    `SELECT SUM(status='PAID') AS paid, SUM(status='PENDING') AS pending, SUM(status='FAILED') AS failed,
            MAX(CASE WHEN status='PAID' THEN paid_at END) AS last_paid, MAX(created_at) AS last_created
       FROM orders WHERE tenant_id=? AND created_at >= NOW() - INTERVAL ? DAY`, [tenantId, days]);
  console.log(`\norders: paid ${Number(orders.paid || 0)} · pending ${Number(orders.pending || 0)} · failed ${Number(orders.failed || 0)}`);
  console.log(`newest paid: ${orders.last_paid || '—'} · newest order: ${orders.last_created || '—'}`);
  // Pending orders: a customer who opened the payment page. Paid ones should
  // turn PAID within a minute through the callback; old pending ones are either
  // abandoned (nothing in Paymob's dashboard for that order) or a callback that
  // never reached the server (a successful transaction in Paymob's dashboard).
  const [pending] = await pool.query(
    `SELECT id, created_at, amount, currency, customer_name, item_title FROM orders
      WHERE tenant_id=? AND status='PENDING' AND created_at >= NOW() - INTERVAL ? DAY ORDER BY created_at DESC LIMIT 20`,
    [tenantId, days]).catch(() => [[]]);
  pending.forEach(o => console.log(`    pending ${o.id} · ${o.created_at} · ${o.amount} ${o.currency} · ${o.customer_name || ''} · ${o.item_title || ''}`));
  const [uncredited] = await pool.query(
    `SELECT o.id, o.amount, o.currency, o.paid_at, o.transaction_id FROM orders o
      WHERE o.tenant_id=? AND o.status='PAID' AND o.paid_at >= NOW() - INTERVAL ? DAY
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.tenant_id=o.tenant_id AND p.deleted_at IS NULL
                         AND (p.id = CONCAT('paymob-', o.id)
                              OR (o.transaction_id IS NOT NULL AND o.transaction_id<>'' AND p.transaction_id=o.transaction_id)))
      ORDER BY o.paid_at DESC LIMIT 20`, [tenantId, days]);
  ok(uncredited.length === 0, `paid orders with no payment row: ${uncredited.length}`);
  uncredited.forEach(o => console.log(`    - order ${o.id} · ${o.amount} ${o.currency} · ${o.paid_at}`));
  const [[unjournaled]] = await pool.query(
    `SELECT COUNT(*) AS n FROM payments p
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND p.status='paid' AND p.date >= NOW() - INTERVAL ? DAY
        AND (p.source='paymob' OR p.payment_method LIKE '%paymob%')
        AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.tenant_id=p.tenant_id AND je.ref_type='payment' AND je.ref_id=p.id)`,
    [tenantId, days]).catch(() => [[{ n: null }]]);
  if (unjournaled.n !== null) ok(Number(unjournaled.n) === 0, `Paymob payments without a ledger entry: ${unjournaled.n}`);
  await pool.end();
})().catch(error => { console.error(error.message); process.exit(1); });
