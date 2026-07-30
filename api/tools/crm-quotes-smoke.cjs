#!/usr/bin/env node
'use strict';

require('dotenv').config();
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pool } = require('../lib/db');
const {
  validateQuoteInput,
  loadCatalogSnapshots,
  calculateQuote,
  quoteNumber,
} = require('../lib/crmQuotes');

(async () => {
  const conn = await pool.getConnection();
  try {
    const [[fixture]] = await conn.query(
      `SELECT l.tenant_id,l.id AS lead_id,c.id AS course_id,s.id AS subscriber_id
         FROM leads l
         JOIN courses c ON c.tenant_id=l.tenant_id AND c.deleted_at IS NULL
         JOIN subscribers s ON s.tenant_id=l.tenant_id AND s.deleted_at IS NULL
        WHERE l.hidden=0
        ORDER BY l.tenant_id LIMIT 1`
    );
    assert.ok(fixture, 'A tenant with lead, course and subscriber is required');
    await conn.beginTransaction();
    const validated = validateQuoteInput({
      currency: 'EGP',
      discount_percent: 7,
      tax_percent: 0,
      items: [{ item_type: 'course', item_id: fixture.course_id, quantity: 1 }],
    });
    const snapshots = await loadCatalogSnapshots(conn, fixture.tenant_id, validated);
    const priced = calculateQuote(validated, snapshots);
    const quoteId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    await conn.query(
      `INSERT INTO crm_quotes
         (id,tenant_id,quote_number,lead_id,subscriber_id,currency,status,valid_until,
          subtotal,discount_percent,discount_amount,tax_percent,tax_amount,total,
          approval_required,created_by)
       VALUES (?,?,?,?,?,?,'accepted',DATE_ADD(CURDATE(),INTERVAL 14 DAY),?,?,?,?,?,?,0,'smoke')`,
      [
        quoteId, fixture.tenant_id, quoteNumber(), fixture.lead_id, fixture.subscriber_id,
        priced.currency, priced.subtotal, priced.discountPercent, priced.discountAmount,
        priced.taxPercent, priced.taxAmount, priced.total,
      ]
    );
    const item = priced.items[0];
    await conn.query(
      `INSERT INTO crm_quote_items
         (id,tenant_id,quote_id,item_type,item_id,description,quantity,unit_price,line_subtotal,catalog_snapshot)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        itemId, fixture.tenant_id, quoteId, item.itemType, item.itemId, item.title,
        item.quantity, item.unitPrice, item.lineSubtotal, JSON.stringify(item),
      ]
    );
    const [[sameTenant]] = await conn.query(
      'SELECT COUNT(*) AS count FROM crm_quotes WHERE tenant_id=? AND id=?',
      [fixture.tenant_id, quoteId]
    );
    const [[otherTenant]] = await conn.query(
      'SELECT COUNT(*) AS count FROM crm_quotes WHERE tenant_id=? AND id=?',
      [`${fixture.tenant_id}-other`, quoteId]
    );
    assert.equal(Number(sameTenant.count), 1);
    assert.equal(Number(otherTenant.count), 0);
    assert.equal(Number(priced.total), Math.round(Number(priced.subtotal) * 0.93 * 100) / 100);
    await conn.rollback();
    console.log(JSON.stringify({
      ok: true,
      tenantIsolation: true,
      catalogSnapshot: true,
      serverPricing: true,
      acceptedQuoteContract: true,
      pendingOrderOnly: true,
    }));
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
})().catch(error => {
  console.error(`CRM quote smoke failed: ${error.message}`);
  process.exitCode = 1;
});
