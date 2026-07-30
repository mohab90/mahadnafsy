#!/usr/bin/env node
'use strict';

require('dotenv').config();
const crypto = require('node:crypto');
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');

const API = (process.env.API_BASE_URL || 'http://127.0.0.1:3101').replace(/\/$/, '');
const appSecret = process.env.WHATSAPP_APP_SECRET;
const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
const greenSecret = process.env.WHATSAPP_GREEN_WEBHOOK_SECRET;

async function post(path, body, headers = {}) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

(async () => {
  if (!appSecret || !verifyToken || !greenSecret) {
    throw new Error('WhatsApp webhook smoke secrets are required');
  }
  const metaMessageId = `wamid.uat-${uuidv4()}`;
  const greenMessageId = `green-uat-${uuidv4()}`;
  const rowIds = [uuidv4(), uuidv4()];
  try {
    await pool.query(
      `INSERT INTO message_outbox
         (id,tenant_id,channel,provider,provider_message_id,recipient,payload_json,status,sent_at,delivery_status,provider_status_at)
       VALUES
         (?,'tenant-default','whatsapp','meta',?,'201000000000','{}','sent',NOW(),'accepted',NOW()),
         (?,'tenant-default','whatsapp','green-api',?,'201000000001','{}','sent',NOW(),'accepted',NOW())`,
      [rowIds[0], metaMessageId, rowIds[1], greenMessageId]
    );

    const verification = await fetch(
      `${API}/api/webhooks/whatsapp/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=uat-challenge`
    );
    if (verification.status !== 200 || await verification.text() !== 'uat-challenge') {
      throw new Error(`Meta verification failed with ${verification.status}`);
    }

    const metaBody = JSON.stringify({
      entry: [{
        changes: [{
          value: {
            statuses: [{ id: metaMessageId, status: 'delivered', timestamp: Math.floor(Date.now() / 1000) }],
          },
        }],
      }],
    });
    const signature = `sha256=${crypto.createHmac('sha256', appSecret).update(metaBody).digest('hex')}`;
    const meta = await post('/api/webhooks/whatsapp/meta', metaBody, { 'X-Hub-Signature-256': signature });
    if (meta.updated !== 1) throw new Error(`Meta receipt updated ${meta.updated} rows`);

    const greenBody = JSON.stringify({
      typeWebhook: 'outgoingMessageStatus',
      timestamp: Math.floor(Date.now() / 1000),
      idMessage: greenMessageId,
      status: 'read',
    });
    const green = await post(
      `/api/webhooks/whatsapp/green-api?token=${encodeURIComponent(greenSecret)}`,
      greenBody
    );
    if (green.updated !== 1) throw new Error(`Green receipt updated ${green.updated} rows`);

    const [rows] = await pool.query(
      `SELECT provider,delivery_status,delivered_at,read_at
         FROM message_outbox WHERE id IN (?,?) ORDER BY provider`,
      rowIds
    );
    const metaRow = rows.find(row => row.provider === 'meta');
    const greenRow = rows.find(row => row.provider === 'green-api');
    const ok = metaRow?.delivery_status === 'delivered'
      && metaRow?.delivered_at
      && greenRow?.delivery_status === 'read'
      && greenRow?.delivered_at
      && greenRow?.read_at;
    console.log(JSON.stringify({ ok: Boolean(ok), meta: metaRow, green: greenRow }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    await pool.query('DELETE FROM message_outbox WHERE id IN (?,?)', rowIds).catch(() => {});
    await pool.end().catch(() => {});
  }
})().catch(async error => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  await pool.end().catch(() => {});
  process.exit(1);
});
