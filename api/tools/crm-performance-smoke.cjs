#!/usr/bin/env node
'use strict';

require('dotenv').config();
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { pool } = require('../lib/db');
const { buildWorkQueue } = require('../lib/crmWorkQueue');

const LEAD_COUNT = Math.min(Math.max(Number(process.env.CRM_PERF_LEADS) || 10000, 1000), 25000);
const P95_TARGET_MS = Math.max(Number(process.env.CRM_WORK_QUEUE_P95_TARGET_MS) || 400, 50);
const percentile = (values, ratio) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * ratio) - 1];

(async () => {
  const conn = await pool.getConnection();
  const tenantId = `crm-perf-${crypto.randomUUID()}`;
  try {
    await conn.beginTransaction();
    for (let offset = 0; offset < LEAD_COUNT; offset += 500) {
      const size = Math.min(500, LEAD_COUNT - offset);
      const values = [];
      const placeholders = [];
      for (let index = 0; index < size; index += 1) {
        const number = offset + index;
        placeholders.push('(?,?,?,?,?,?,?,?,?,?,DATE_SUB(NOW(),INTERVAL ? HOUR),DATE_SUB(NOW(),INTERVAL ? DAY),?)');
        values.push(
          crypto.randomUUID(), `Performance ${number}`, `perf-${number}@example.invalid`,
          `010${String(number).padStart(8, '0')}`, 'performance-smoke',
          number % 4 === 0 ? 'interested' : 'new',
          number % 3 === 0 ? 'HIGH' : 'MEDIUM',
          number % 101, 1000 + number,
          number % 5 === 0 ? 'commit' : 'pipeline',
          number % 72, number % 20, tenantId,
        );
      }
      await conn.query(
        `INSERT INTO leads
           (id,name,email,phone,source,status,interest_level,score,deal_value,forecast_category,
            next_follow_up_date,created_at,tenant_id)
         VALUES ${placeholders.join(',')}`,
        values
      );
    }
    const sql = `SELECT l.id,l.name,l.phone,l.email,l.status,l.source,l.branch,l.interest_level,
                        l.score,l.deal_value,l.forecast_category,l.expected_close_date,
                        l.next_follow_up_date,l.created_at,l.assigned_sales_id,l.assigned_sales_name,
                        comm.communication_count,comm.last_communication_at,seq.active_sequence_id
                   FROM leads l
                   LEFT JOIN (
                     SELECT tenant_id,lead_id,COUNT(*) AS communication_count,MAX(date) AS last_communication_at
                       FROM communications WHERE tenant_id=? GROUP BY tenant_id,lead_id
                   ) comm ON comm.tenant_id=l.tenant_id AND comm.lead_id=l.id
                   LEFT JOIN (
                     SELECT tenant_id,lead_id,MIN(sequence_id) AS active_sequence_id
                       FROM drip_enrollments WHERE tenant_id=? AND status IN ('active','paused')
                        AND lead_id IS NOT NULL GROUP BY tenant_id,lead_id
                   ) seq ON seq.tenant_id=l.tenant_id AND seq.lead_id=l.id
                  WHERE l.tenant_id=? AND l.hidden=0 AND l.deleted_at IS NULL
                  ORDER BY l.score DESC,l.created_at ASC LIMIT 1000`;
    const timings = [];
    let lastRows = [];
    for (let run = 0; run < 20; run += 1) {
      const started = performance.now();
      [lastRows] = await conn.query(sql, [tenantId, tenantId, tenantId]);
      buildWorkQueue(lastRows, { limit: 250 });
      timings.push(performance.now() - started);
    }
    const p95 = percentile(timings.slice(2), 0.95);
    const [[tenantCount]] = await conn.query('SELECT COUNT(*) AS count FROM leads WHERE tenant_id=?', [tenantId]);
    assert.equal(Number(tenantCount.count), LEAD_COUNT);
    assert.equal(lastRows.length, 1000);
    assert.ok(p95 < P95_TARGET_MS, `CRM work queue p95 ${p95.toFixed(1)}ms exceeded ${P95_TARGET_MS}ms`);
    await conn.rollback();
    console.log(JSON.stringify({
      ok: true,
      leads: LEAD_COUNT,
      queryRows: lastRows.length,
      runs: timings.length,
      warmP95Ms: Number(p95.toFixed(2)),
      targetMs: P95_TARGET_MS,
      tenantIsolation: true,
    }));
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
})().catch(error => {
  console.error(`CRM performance smoke failed: ${error.message}`);
  process.exitCode = 1;
});
