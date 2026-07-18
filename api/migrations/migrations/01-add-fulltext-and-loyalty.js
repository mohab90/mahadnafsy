const fs = require('fs');
const path = require('path');

async function up({ context: pool }) {
  // Read SQL files created by subagents
  const fulltextSqlPath = path.join(__dirname, 'fulltext_courses.sql');
  const loyaltySqlPath = path.join(__dirname, 'loyalty_points.sql');

  if (fs.existsSync(fulltextSqlPath)) {
    const fulltextSql = fs.readFileSync(fulltextSqlPath, 'utf8');
    await pool.query(fulltextSql).catch(err => {
      if (!err.message.includes('Duplicate key name')) {
         throw err;
      }
    });
  }

  if (fs.existsSync(loyaltySqlPath)) {
    const loyaltySql = fs.readFileSync(loyaltySqlPath, 'utf8');
    await pool.query(loyaltySql).catch(err => {
      if (!err.message.includes('Duplicate column name')) {
         throw err;
      }
    });
  }
}

async function down({ context: pool }) {
  await pool.query('ALTER TABLE courses DROP INDEX ft_courses_title_desc');
  await pool.query('ALTER TABLE subscribers DROP COLUMN points');
}

module.exports = { up, down };
