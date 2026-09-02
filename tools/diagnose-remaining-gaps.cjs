// Read-only. The two remaining gaps both look like bookkeeping errors rather
// than missing money, and the fix differs depending on which. This asks the
// questions that separate them.
//
// A live payment whose customer is deleted is usually one of two things: the
// customer was a duplicate and was merged away (then the payment should point
// at the survivor), or the deletion was a mistake (then the customer should
// come back). Both are recoverable; deleting the payment is not the answer to
// either, because the money was really received.
//
// A payment whose course nobody is enrolled in is usually a wrong course_id on
// the payment rather than a missing enrolment -- the amount paid tends to match
// the course the customer is actually studying.
require('dotenv').config({ path: '/var/www/mahad-api/.env' });
const mysql = require('mysql2/promise');

const norm = value => String(value || '').replace(/[\s‏‎]/g, '').toLowerCase();
const tail = phone => String(phone || '').replace(/\D/g, '').slice(-9);

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  console.log('===== 1. live payments whose customer is deleted =====');
  const [orphans] = await db.query(`
    SELECT p.id AS payment_id, p.amount_egp, DATE(p.date) AS paid_on, p.course_id,
           p.status, s.id AS sub_id, s.name, s.email, s.phone, s.client_code,
           s.deleted_at, s.lead_id, s.created_at AS customer_created
      FROM payments p JOIN subscribers s ON s.id = p.subscriber_id
     WHERE p.deleted_at IS NULL AND p.status = 'paid' AND s.deleted_at IS NOT NULL
     ORDER BY p.date DESC`);

  for (const row of orphans) {
    console.log(`\n--- ${row.name} (${row.client_code}) ${row.amount_egp} EGP paid ${String(row.paid_on).slice(0, 10)}`);
    console.log(`    customer created ${String(row.customer_created).slice(0, 19)}, deleted ${String(row.deleted_at).slice(0, 19)}`);
    console.log(`    email=${row.email || '-'} phone=${row.phone || '-'} course=${row.course_id || '-'}`);

    const [twins] = await db.query(`
      SELECT id, client_code, name, email, phone, deleted_at, created_at
        FROM subscribers WHERE id <> ? AND deleted_at IS NULL`, [row.sub_id]);
    const matches = twins.filter(t =>
      (row.email && norm(t.email) === norm(row.email)) ||
      (tail(row.phone).length >= 8 && tail(t.phone) === tail(row.phone)) ||
      (norm(row.name).length > 5 && norm(t.name) === norm(row.name)));
    console.log(`    surviving customer with same email/phone/name: ${matches.length}`);
    for (const m of matches) {
      console.log(`      -> ${m.client_code} ${m.name} | ${m.email || '-'} | ${m.phone || '-'} | created ${String(m.created_at).slice(0, 10)}`);
    }

    const [others] = await db.query(`
      SELECT id, amount_egp, status, DATE(date) AS d, deleted_at
        FROM payments WHERE subscriber_id = ? AND id <> ?`, [row.sub_id, row.payment_id]);
    console.log(`    other payments on this customer: ${others.length} ${JSON.stringify(others)}`);
    const [enr] = await db.query('SELECT course_id, status FROM enrollments WHERE subscriber_id = ?', [row.sub_id]);
    console.log(`    enrolments: ${JSON.stringify(enr)}`);
  }

  console.log('\n\n===== 2. paid for a course nobody is enrolled in =====');
  const [gaps] = await db.query(`
    SELECT p.id AS payment_id, p.amount_egp, p.course_id AS paid_course, DATE(p.date) AS paid_on,
           s.id AS sub_id, s.name, s.client_code
      FROM payments p JOIN subscribers s ON s.id = p.subscriber_id
     WHERE p.deleted_at IS NULL AND p.status = 'paid' AND s.deleted_at IS NULL
       AND p.course_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM enrollments e
                        WHERE e.subscriber_id = p.subscriber_id AND e.course_id = p.course_id)
     ORDER BY p.date DESC`);

  const courseName = async id => {
    const [[c]] = await db.query(
      'SELECT id, title, price FROM courses WHERE id = ?', [id]).catch(() => [[null]]);
    return c ? `${c.title} (${c.price} EGP)` : '(course row not found)';
  };

  for (const row of gaps) {
    console.log(`\n--- ${row.name} (${row.client_code}) paid ${row.amount_egp} EGP on ${String(row.paid_on).slice(0, 10)}`);
    console.log(`    payment says course: ${row.paid_course} = ${await courseName(row.paid_course)}`);
    const [enr] = await db.query(
      'SELECT course_id, status, enrolled_at FROM enrollments WHERE subscriber_id = ?', [row.sub_id]);
    if (!enr.length) console.log('    enrolled in: NOTHING');
    for (const e of enr) {
      console.log(`    enrolled in: ${e.course_id} = ${await courseName(e.course_id)} [${e.status}] ${String(e.enrolled_at).slice(0, 10)}`);
    }
    const [allPays] = await db.query(
      'SELECT id, amount_egp, course_id, DATE(date) d FROM payments WHERE subscriber_id = ? AND deleted_at IS NULL', [row.sub_id]);
    console.log(`    all payments: ${JSON.stringify(allPays)}`);
  }

  await db.end();
})().catch(error => { console.error('ERR', error.message); process.exit(1); });
