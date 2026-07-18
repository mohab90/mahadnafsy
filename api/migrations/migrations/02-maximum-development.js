async function up({ context: pool }) {
  // 1. CRM Modifications
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS status ENUM('new', 'contacted', 'negotiating', 'won', 'lost') DEFAULT 'new'`).catch(() => {});
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_interactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lead_id VARCHAR(36) NOT NULL,
      type ENUM('call', 'whatsapp', 'email', 'meeting', 'other') NOT NULL,
      notes TEXT,
      created_by VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    )
  `);

  // 2. HR Modifications
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      staff_id VARCHAR(36) NOT NULL,
      type ENUM('annual', 'sick', 'unpaid', 'other') DEFAULT 'annual',
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      reason TEXT,
      status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
      admin_reply TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS performance_reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      staff_id VARCHAR(36) NOT NULL,
      reviewer_id VARCHAR(36),
      month INT NOT NULL,
      year INT NOT NULL,
      kpi_score INT DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll (
      id INT AUTO_INCREMENT PRIMARY KEY,
      staff_id VARCHAR(36) NOT NULL,
      month INT NOT NULL,
      year INT NOT NULL,
      base_salary DECIMAL(10,2) DEFAULT 0.00,
      commissions DECIMAL(10,2) DEFAULT 0.00,
      deductions DECIMAL(10,2) DEFAULT 0.00,
      net_salary DECIMAL(10,2) DEFAULT 0.00,
      is_paid BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    )
  `);

  // 3. Finance Modifications
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      amount DECIMAL(10,2) NOT NULL,
      category VARCHAR(100) NOT NULL,
      description TEXT,
      expense_date DATE NOT NULL,
      receipt_url VARCHAR(255),
      created_by VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function down({ context: pool }) {
  await pool.query(`DROP TABLE IF EXISTS expenses`);
  await pool.query(`DROP TABLE IF EXISTS payroll`);
  await pool.query(`DROP TABLE IF EXISTS performance_reviews`);
  await pool.query(`DROP TABLE IF EXISTS leave_requests`);
  await pool.query(`DROP TABLE IF EXISTS lead_interactions`);
  // await pool.query(`ALTER TABLE leads DROP COLUMN status`); // Not safe to drop without checking
}

module.exports = { up, down };
