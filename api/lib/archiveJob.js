const logger = require('./logger').child({ module: 'archive-job' });

// activity_logs_archive is created by migration 064 — runtime DDL is blocked
// by api/lib/db.js, so this job no longer tries to CREATE TABLE itself.
const archiveActivityLogs = async (db) => {
    try {
        // Move records older than 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        await db.query(`
            INSERT INTO activity_logs_archive 
            SELECT * FROM activity_logs 
            WHERE created_at < ?
        `, [thirtyDaysAgo]);

        // Delete the archived records from the main table
        await db.query(`
            DELETE FROM activity_logs 
            WHERE created_at < ?
        `, [thirtyDaysAgo]);
        
        logger.info('Activity logs older than 30 days archived successfully.');
    } catch (error) {
        logger.error('Error archiving activity logs:', error.message);
    }
};

module.exports = { archiveActivityLogs };
