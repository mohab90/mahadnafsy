const logger = require('./logger').child({ module: 'archive-job' });

// activity_logs_archive is created by migration 064 — runtime DDL is blocked
// by api/lib/db.js, so this job no longer tries to CREATE TABLE itself.
//
// Named columns, not SELECT *: the archive was made before activity_logs
// gained actor_name, department and details, and the column count mismatch
// failed every run (migration 315 adds them there). Batched, one short
// transaction per batch, so a month of rows never sits in one undo log.
const COLUMNS = 'id, tenant_id, action, entity, entity_id, label, actor, at, actor_name, department, details';
const BATCH = 2000;

const archiveActivityLogs = async (db, { days = 30, batch = BATCH, maxBatches = 500, now = Date.now(), tenantId = null } = {}) => {
    const cutoff = new Date(now - days * 86_400_000);
    let moved = 0;
    for (let i = 0; i < maxBatches; i += 1) {
        // tenantId narrows it to one tenant, for the tests that share a database.
        const [rows] = await db.query(
            `SELECT id FROM activity_logs WHERE at < ?${tenantId ? ' AND tenant_id = ?' : ''} ORDER BY at LIMIT ?`,
            tenantId ? [cutoff, tenantId, batch] : [cutoff, batch]);
        if (!rows.length) break;
        const ids = rows.map(row => row.id);
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query(`INSERT IGNORE INTO activity_logs_archive (${COLUMNS}) SELECT ${COLUMNS} FROM activity_logs WHERE id IN (?)`, [ids]);
            await conn.query('DELETE FROM activity_logs WHERE id IN (?)', [ids]);
            await conn.commit();
        } catch (error) {
            await conn.rollback().catch(() => {});
            logger.error('Error archiving activity logs:', error.message);
            throw error;
        } finally {
            conn.release();
        }
        moved += ids.length;
        if (ids.length < batch) break;
    }
    if (moved) logger.info(`Activity logs older than ${days} days archived: ${moved}.`);
    return { moved };
};

module.exports = { archiveActivityLogs };
