async function up({ context: pool }) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS affiliates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      subscriber_id VARCHAR(36) NOT NULL,
      referral_code VARCHAR(50),
      commission_balance DECIMAL(10,2) DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mv_dashboard_stats (
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      total_revenue DECIMAL(15,2) DEFAULT 0.00,
      active_students INT DEFAULT 0
    )
  `);
}

async function down({ context: pool }) {
  await pool.query(`DROP TABLE IF EXISTS mv_dashboard_stats`);
  await pool.query(`DROP TABLE IF EXISTS affiliates`);
}

module.exports = { up, down };
