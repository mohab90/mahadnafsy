// Read-only. Two questions the orphan payments raised.
//
// First: the three deleted customers all still hold *active* enrolments. If
// deleting a customer does not revoke their access, then a deleted customer
// may still be able to open the courses they were deleted from. That is worth
// counting across the whole table, not just those three.
//
// Second: the payments in the paid-without-enrolment set name courses with
// legacy `c-<timestamp>` ids, while the courses table now keys on slugs. If
// those ids resolve to nothing even including soft-deleted rows, the mismatch
// is an artefact of the id migration rather than a customer missing access --
// with the exception of anyone enrolled in nothing at all, who really did pay
// for something they cannot open.
require('dotenv').config({ path: '/var/www/mahad-api/.env' });
const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  console.log('===== deleted customers still holding active access =====');
  const [[wide]] = await db.query(`
    SELECT COUNT(DISTINCT s.id) AS customers, COUNT(*) AS enrolments
      FROM subscribers s JOIN enrollments e ON e.subscriber_id = s.id
     WHERE s.deleted_at IS NOT NULL
       AND (e.status IS NULL OR e.status <> 'revoked')
       AND e.revoked_at IS NULL`);
  console.log(`customers: ${wide.customers}, still-active enrolments: ${wide.enrolments}`);

  const [[total]] = await db.query(
    'SELECT COUNT(*) AS n FROM subscribers WHERE deleted_at IS NOT NULL');
  console.log(`(out of ${total.n} deleted customers in total)`);

  const [worst] = await db.query(`
    SELECT s.client_code, s.name, s.deleted_at, COUNT(*) AS courses
      FROM subscribers s JOIN enrollments e ON e.subscriber_id = s.id
     WHERE s.deleted_at IS NOT NULL
       AND (e.status IS NULL OR e.status <> 'revoked') AND e.revoked_at IS NULL
     GROUP BY s.id ORDER BY s.deleted_at DESC LIMIT 12`);
  console.table(worst);

  console.log('\n===== can a deleted customer still sign in? =====');
  const [[login]] = await db.query(`
    SELECT COUNT(*) AS n FROM subscribers
     WHERE deleted_at IS NOT NULL AND firebase_uid IS NOT NULL AND firebase_uid <> ''`);
  console.log(`deleted customers that still have a firebase_uid: ${login.n}`);

  console.log('\n===== do the legacy c- course ids resolve at all? =====');
  const legacy = ['c-1774348349367', 'c-1774366834345', 'c-1774349731797',
    'c-1774364493300', 'c-1774275814202', 'c-1774272074422', 'c-1774277747256'];
  const [found] = await db.query(
    'SELECT id, title, deleted_at, is_published FROM courses WHERE id IN (?)', [legacy]);
  console.log(`resolved ${found.length} of ${legacy.length} (including soft-deleted)`);
  console.table(found);

  const [[enrShape]] = await db.query(`
    SELECT SUM(e.course_id LIKE 'c-%') AS legacy_ids, COUNT(*) AS total FROM enrollments e`);
  console.log(`enrolments still on legacy ids: ${enrShape.legacy_ids} of ${enrShape.total}`);
  const [[payShape]] = await db.query(`
    SELECT SUM(p.course_id LIKE 'c-%') AS legacy_ids,
           SUM(p.course_id IS NOT NULL) AS with_course, COUNT(*) AS total
      FROM payments p WHERE p.deleted_at IS NULL`);
  console.log(`payments on legacy ids: ${payShape.legacy_ids} of ${payShape.with_course} that name a course (${payShape.total} total)`);

  await db.end();
})().catch(error => { console.error('ERR', error.message); process.exit(1); });
