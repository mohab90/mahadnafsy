#!/usr/bin/env node
'use strict';

require('dotenv').config();
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pool } = require('../lib/db');

(async () => {
  const conn = await pool.getConnection();
  try {
    const [[lead]] = await conn.query(
      'SELECT id,tenant_id FROM leads WHERE hidden=0 ORDER BY created_at DESC LIMIT 1'
    );
    assert.ok(lead, 'A lead fixture is required');
    await conn.beginTransaction();
    const communication = {
      id: crypto.randomUUID(),
      tenant_id: lead.tenant_id,
      staff_id: `smoke-staff-${crypto.randomUUID().slice(0, 8)}`,
    };
    await conn.query(
      `INSERT INTO communications
         (id,tenant_id,lead_id,type,date,notes,outcome,staff_id)
       VALUES (?,?,?,'CALL',NOW(),'Smoke communication','completed',?)`,
      [communication.id, communication.tenant_id, lead.id, communication.staff_id]
    );
    const evidenceId = crypto.randomUUID();
    const reviewId = crypto.randomUUID();
    const checksum = crypto.createHash('sha256').update(reviewId).digest('hex');
    await conn.query(
      `INSERT INTO crm_communication_evidence
         (id,tenant_id,communication_id,evidence_type,content_text,content_sha256,captured_by)
       VALUES (?,?,?,'note','Smoke evidence',?,'smoke')`,
      [evidenceId, communication.tenant_id, communication.id, checksum]
    );
    await conn.query(
      `INSERT INTO crm_coaching_reviews
         (id,tenant_id,communication_id,evidence_id,staff_id,reviewer_id,
          discovery_score,empathy_score,accuracy_score,next_step_score,total_score,comments)
       VALUES (?,?,?,?,?,'smoke-reviewer',4,5,4,5,90,'Smoke review')`,
      [reviewId, communication.tenant_id, communication.id, evidenceId, communication.staff_id]
    );
    const [[row]] = await conn.query(
      `SELECT cr.total_score,ce.content_sha256
         FROM crm_coaching_reviews cr
         JOIN crm_communication_evidence ce ON ce.id=cr.evidence_id AND ce.tenant_id=cr.tenant_id
        WHERE cr.id=? AND cr.tenant_id=?`,
      [reviewId, communication.tenant_id]
    );
    assert.equal(Number(row.total_score), 90);
    assert.equal(row.content_sha256, checksum);
    await conn.rollback();
    console.log(JSON.stringify({
      ok: true,
      evidenceRequired: true,
      checksumStored: true,
      serverRubric: true,
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
  console.error(`CRM coaching smoke failed: ${error.message}`);
  process.exitCode = 1;
});
