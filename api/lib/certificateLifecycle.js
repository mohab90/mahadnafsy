'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');

function certificateCode() {
  return `MHAD-${Date.now().toString(36).toUpperCase()}-${uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

async function writeCertificateEvent(conn, {
  tenantId, completionId, eventType, oldCode = null, newCode = null,
  actor = 'system', reason = null, meta = null,
}) {
  await conn.query(
    `INSERT INTO certificate_lifecycle_events
     (id,tenant_id,completion_id,event_type,old_code,new_code,actor,reason,meta_json)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [uuidv4(), tenantId, completionId, eventType, oldCode, newCode, actor, reason,
      meta ? JSON.stringify(meta) : null]
  );
}

async function mutateCertificate({ tenantId, completionId, actor, reason, action }, db = null) {
  if (!tenantId || !completionId || !String(reason || '').trim()) {
    const error = new Error('tenantId, completionId and reason are required');
    error.statusCode = 400;
    throw error;
  }
  const ownsConnection = !db;
  const conn = db || await pool.getConnection();
  try {
    if (ownsConnection) await conn.beginTransaction();
    const [[completion]] = await conn.query(
      `SELECT id,certificate_code,status,version FROM course_completions
       WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
      [completionId, tenantId]
    );
    if (!completion) {
      const error = new Error('Certificate not found');
      error.statusCode = 404;
      throw error;
    }

    if (action === 'revoke') {
      if (completion.status === 'revoked') {
        if (ownsConnection) await conn.commit();
        return { ...completion, changed: false };
      }
      await conn.query(
        `UPDATE course_completions
         SET status='revoked',revoked_at=NOW(),revoked_by=?,revoke_reason=?
         WHERE id=? AND tenant_id=?`,
        [actor, String(reason).trim(), completionId, tenantId]
      );
      await writeCertificateEvent(conn, {
        tenantId, completionId, eventType: 'revoked', oldCode: completion.certificate_code,
        actor, reason: String(reason).trim(),
      });
      if (ownsConnection) await conn.commit();
      return { ...completion, status: 'revoked', changed: true };
    }

    const newCode = certificateCode();
    await conn.query(
      `UPDATE course_completions
       SET certificate_code=?,status='active',version=version+1,reissued_at=NOW(),reissued_by=?,
           revoked_at=NULL,revoked_by=NULL,revoke_reason=NULL
       WHERE id=? AND tenant_id=?`,
      [newCode, actor, completionId, tenantId]
    );
    await writeCertificateEvent(conn, {
      tenantId, completionId, eventType: 'reissued', oldCode: completion.certificate_code,
      newCode, actor, reason: String(reason).trim(), meta: { previousStatus: completion.status },
    });
    if (ownsConnection) await conn.commit();
    return {
      ...completion, certificate_code: newCode, status: 'active',
      version: Number(completion.version || 1) + 1, changed: true,
    };
  } catch (error) {
    if (ownsConnection) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (ownsConnection) conn.release();
  }
}

const revokeCertificate = (input, db) => mutateCertificate({ ...input, action: 'revoke' }, db);
const reissueCertificate = (input, db) => mutateCertificate({ ...input, action: 'reissue' }, db);

module.exports = {
  certificateCode,
  reissueCertificate,
  revokeCertificate,
  writeCertificateEvent,
};
