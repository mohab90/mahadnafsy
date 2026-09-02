// Read-only. Answers the three questions left open on the live books:
// payments whose course nobody is enrolled in, payments whose customer was
// deleted underneath them, and payments carrying no audit trail.
require('dotenv').config({ path: '/var/www/mahad-api/.env' });
const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const section = title => console.log(`\n===== ${title} =====`);

  section('paid for a course they are not enrolled in');
  const [gaps] = await db.query(`
    SELECT p.id AS payment_id, p.amount_egp, p.course_expected, p.course_id AS paid_course,
           DATE(p.date) AS paid_on, s.id AS subscriber_id, s.name, s.client_code,
           (SELECT GROUP_CONCAT(e.course_id SEPARATOR ' | ')
              FROM enrollments e WHERE e.subscriber_id = s.id) AS enrolled_in
      FROM payments p
      JOIN subscribers s ON s.id = p.subscriber_id
     WHERE p.deleted_at IS NULL AND p.status = 'paid' AND s.deleted_at IS NULL
       AND p.course_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM enrollments e
                        WHERE e.subscriber_id = p.subscriber_id AND e.course_id = p.course_id)
     ORDER BY p.date DESC`);
  console.log(JSON.stringify(gaps, null, 1));
  console.log('count:', gaps.length);
  const enrolledElsewhere = gaps.filter(g => g.enrolled_in);
  console.log(`of these, already enrolled in some other course: ${enrolledElsewhere.length}`);
  console.log(`of these, enrolled in nothing at all          : ${gaps.length - enrolledElsewhere.length}`);

  section('live payments whose subscriber is soft-deleted');
  const [orphans] = await db.query(`
    SELECT p.id AS payment_id, p.amount_egp, DATE(p.date) AS paid_on, p.payment_method,
           s.id AS subscriber_id, s.name, s.client_code, s.deleted_at AS customer_deleted_at
      FROM payments p
      JOIN subscribers s ON s.id = p.subscriber_id
     WHERE p.deleted_at IS NULL AND p.status = 'paid' AND s.deleted_at IS NOT NULL
     ORDER BY p.date DESC`);
  console.log(JSON.stringify(orphans, null, 1));
  console.log('count:', orphans.length,
    '| total EGP:', orphans.reduce((sum, row) => sum + Number(row.amount_egp), 0));

  section('live payments with no audit row');
  const [[audit]] = await db.query(`
    SELECT COUNT(*) AS missing, COALESCE(SUM(p.amount_egp), 0) AS total
      FROM payments p
     WHERE p.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM payment_audit_log a WHERE a.payment_id = p.id)`);
  const [[audited]] = await db.query(`
    SELECT COUNT(*) AS n FROM payments p
     WHERE p.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM payment_audit_log a WHERE a.payment_id = p.id)`);
  console.log(`without audit: ${audit.missing} (${audit.total} EGP)`);
  console.log(`with audit   : ${audited.n}`);
  const [span] = await db.query(`
    SELECT MIN(DATE(p.created_at)) AS earliest, MAX(DATE(p.created_at)) AS latest
      FROM payments p
     WHERE p.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM payment_audit_log a WHERE a.payment_id = p.id)`);
  console.log('unaudited payments span:', JSON.stringify(span[0]));

  await db.end();
})().catch(error => { console.error('ERR', error.message); process.exit(1); });
