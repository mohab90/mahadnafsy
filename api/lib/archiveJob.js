const logger = require('./logger').child({ module: 'archive-job' });

// activity_logs_archive is created by migration 064 — runtime DDL is blocked
// by api/lib/db.js, so this job no longer tries to CREATE TABLE itself.
const archiveActivityLogs = async (db) => {
    const conn = await db.getConnection();
    try {
        // Move records older than 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        await conn.beginTransaction();
        await conn.query(`
            INSERT IGNORE INTO activity_logs_archive
            SELECT * FROM activity_logs
            WHERE at < ?
        `, [thirtyDaysAgo]);

        // Delete the archived records from the main table
        await conn.query(`
            DELETE FROM activity_logs
            WHERE at < ?
        `, [thirtyDaysAgo]);
        await conn.commit();
        logger.info('Activity logs older than 30 days archived successfully.');
    } catch (error) {
        await conn.rollback().catch(() => {});
        logger.error('Error archiving activity logs:', error.message);
        throw error;
    } finally {
        conn.release();
    }
};

module.exports = { archiveActivityLogs };
