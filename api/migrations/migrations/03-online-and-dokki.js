async function up({ context: pool }) {
  // ---------------------------------------------
  // ONLINE MODULE
  // ---------------------------------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assignments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      course_id VARCHAR(36) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      due_date DATETIME,
      created_by VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS assignment_submissions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      assignment_id INT NOT NULL,
      subscriber_id VARCHAR(36) NOT NULL,
      file_url VARCHAR(255) NOT NULL,
      grade INT DEFAULT NULL,
      feedback TEXT,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
      FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS live_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      course_id VARCHAR(36) NOT NULL,
      topic VARCHAR(255) NOT NULL,
      zoom_link VARCHAR(255) NOT NULL,
      start_time DATETIME NOT NULL,
      duration_minutes INT DEFAULT 60,
      created_by VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    )
  `);

  // ---------------------------------------------
  // DOKKI MODULE
  // ---------------------------------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS classrooms (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      capacity INT DEFAULT 30,
      has_projector BOOLEAN DEFAULT TRUE,
      branch VARCHAR(50) DEFAULT 'DAQQI'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS classroom_bookings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      classroom_id INT NOT NULL,
      course_id VARCHAR(36),
      staff_id VARCHAR(36),
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      purpose VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
      FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      sku VARCHAR(100) UNIQUE,
      stock_quantity INT DEFAULT 0,
      price DECIMAL(10,2) DEFAULT 0.00,
      branch VARCHAR(50) DEFAULT 'DAQQI',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      item_id INT NOT NULL,
      type ENUM('IN', 'OUT') NOT NULL,
      quantity INT NOT NULL,
      reason VARCHAR(255),
      performed_by VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
    )
  `);

}

async function down({ context: pool }) {
  await pool.query(`DROP TABLE IF EXISTS inventory_transactions`);
  await pool.query(`DROP TABLE IF EXISTS inventory_items`);
  await pool.query(`DROP TABLE IF EXISTS classroom_bookings`);
  await pool.query(`DROP TABLE IF EXISTS classrooms`);
  await pool.query(`DROP TABLE IF EXISTS live_sessions`);
  await pool.query(`DROP TABLE IF EXISTS assignment_submissions`);
  await pool.query(`DROP TABLE IF EXISTS assignments`);
}

module.exports = { up, down };
