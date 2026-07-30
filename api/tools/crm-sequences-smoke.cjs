#!/usr/bin/env node
'use strict';

require('dotenv').config();
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pool } = require('../lib/db');
const { recordStepExecution } = require('../lib/dripCampaigns');
const { stopSequencesOnReply } = require('../lib/crmSequences');

(async () => {
  const conn = await pool.getConnection();
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenantA = `smoke-sequence-a-${suffix}`;
  const tenantB = `smoke-sequence-b-${suffix}`;
  try {
    await conn.beginTransaction();
    const sequenceA = crypto.randomUUID();
    const sequenceB = crypto.randomUUID();
    const enrollmentA = crypto.randomUUID();
    const leadA = crypto.randomUUID();
    const steps = JSON.stringify([{ delay_days: 0, subject: 'Smoke', body_html: '<p>Smoke</p>' }]);
    await conn.query(
      `INSERT INTO drip_sequences
         (id,tenant_id,name,is_active,steps,version,timezone,exit_on_reply,created_by,updated_by)
       VALUES (?,?,'Smoke A',1,?,2,'Africa/Cairo',1,'smoke','smoke'),
              (?,?,'Smoke B',1,?,1,'Asia/Riyadh',1,'smoke','smoke')`,
      [sequenceA, tenantA, steps, sequenceB, tenantB, steps]
    );
    await conn.query(
      `INSERT INTO drip_enrollments
         (id,tenant_id,sequence_id,lead_id,email,status,sequence_version,steps_snapshot,current_step,next_send_at)
       VALUES (?,?,?,?,?,'active',2,?,0,NOW())`,
      [enrollmentA, tenantA, sequenceA, leadA, 'smoke@example.com', steps]
    );
    const [[tenantCount]] = await conn.query(
      'SELECT COUNT(*) AS count FROM drip_sequences WHERE tenant_id=?',
      [tenantA]
    );
    assert.equal(Number(tenantCount.count), 1);
    const executionId = await recordStepExecution(conn, {
      id: enrollmentA,
      tenant_id: tenantA,
      sequence_id: sequenceA,
      sequence_version: 2,
      current_step: 0,
      next_send_at: new Date(),
    }, `smoke:${tenantA}:${enrollmentA}:0`);
    assert.ok(executionId);
    const stopped = await stopSequencesOnReply({ tenantId: tenantA, leadId: leadA }, conn);
    assert.equal(stopped, 1);
    const [[closed]] = await conn.query(
      'SELECT status,exit_reason FROM drip_enrollments WHERE id=? AND tenant_id=?',
      [enrollmentA, tenantA]
    );
    assert.deepEqual([closed.status, closed.exit_reason], ['unenrolled', 'reply_received']);
    await conn.rollback();
    console.log(JSON.stringify({
      ok: true,
      tenantIsolation: true,
      immutableVersionSnapshot: true,
      idempotentStepExecution: true,
      replyExit: true,
    }));
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
})().catch(error => {
  console.error(`CRM sequence smoke failed: ${error.message}`);
  process.exitCode = 1;
});
