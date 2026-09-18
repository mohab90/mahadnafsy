'use strict';

/**
 * Who recorded a payment, as a name a person can read.
 *
 * «منفذ العملية» was read straight off payments.staff_name, and measured on
 * production that column cannot carry the question on its own:
 *
 *   • 207 of 352 payments name nobody — no staff_id and no staff_name;
 *   • the same person appears as «Admin Mohab» on 103 rows and as
 *     «mr.mohab1@gmail.com» on 19, because two code paths wrote two things;
 *   • 9 rows store a name that disagrees with the staff row their own
 *     staff_id points at.
 *
 * Everything needed to answer properly is already in the database: staff_id
 * links to a person; a stored email belongs to an account with a name; and
 * payment_audit_log records who created the row for 71 of the payments whose
 * own columns are blank.
 *
 * The order is the strength of the link:
 *   1. staff_id → that staff member's name. An id cannot be a typo.
 *   2. staff_name as stored — an email is resolved to the account behind it
 *      (a staff row first, then the login), so one person reads as one name.
 *   3. the actor on the payment's 'create' audit entry, resolved the same way.
 *   4. nothing — and the screen says so, rather than guessing.
 */

const isEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const lower = value => String(value || '').trim().toLowerCase();

/**
 * @param {import('mysql2/promise').Pool} db
 * @param {string} tenantId
 * @param {{ id: string, staff_id?: string|null, staff_name?: string|null }[]} rows
 * @returns {Promise<Map<string, string|null>>} payment id → executor name
 */
async function resolvePaymentExecutors(db, tenantId, rows) {
  const executors = new Map();
  if (!rows || !rows.length) return executors;

  const staffIds = [...new Set(rows.map(row => row.staff_id).filter(Boolean).map(String))];
  const blank = rows
    .filter(row => !row.staff_id && !String(row.staff_name || '').trim())
    .map(row => String(row.id));

  const placeholders = list => list.map(() => '?').join(',');
  const [staffById, auditActors] = await Promise.all([
    staffIds.length
      ? db.query(`SELECT id, name FROM staff WHERE tenant_id=? AND id IN (${placeholders(staffIds)})`, [tenantId, ...staffIds])
          .then(([result]) => result)
      : [],
    blank.length
      ? db.query(
        `SELECT payment_id, MIN(actor) actor FROM payment_audit_log
          WHERE tenant_id=? AND action='create' AND payment_id IN (${placeholders(blank)})
            AND actor IS NOT NULL AND actor<>''
          GROUP BY payment_id`, [tenantId, ...blank]).then(([result]) => result)
      : [],
  ]);

  const nameOfStaff = new Map(staffById.map(row => [String(row.id), String(row.name || '').trim()]));
  const actorOf = new Map(auditActors.map(row => [String(row.payment_id), String(row.actor || '').trim()]));

  // Every email any rule might need, resolved in one pass: staff first, because
  // a staff row is the person's name inside the institute; the login second.
  const emails = [...new Set([
    ...rows.map(row => row.staff_name).filter(isEmail).map(lower),
    ...[...actorOf.values()].filter(isEmail).map(lower),
  ])];
  const nameOfEmail = new Map();
  if (emails.length) {
    const [[staffByEmail], [usersByEmail]] = await Promise.all([
      db.query(`SELECT LOWER(TRIM(email)) email, name FROM staff
                 WHERE tenant_id=? AND deleted_at IS NULL AND LOWER(TRIM(email)) IN (${placeholders(emails)})`, [tenantId, ...emails]),
      db.query(`SELECT LOWER(TRIM(email)) email, name FROM users
                 WHERE tenant_id=? AND LOWER(TRIM(email)) IN (${placeholders(emails)})`, [tenantId, ...emails]),
    ]);
    for (const row of usersByEmail) if (String(row.name || '').trim()) nameOfEmail.set(row.email, String(row.name).trim());
    for (const row of staffByEmail) if (String(row.name || '').trim()) nameOfEmail.set(row.email, String(row.name).trim());
  }
  const readable = value => {
    const text = String(value || '').trim();
    if (!text) return null;
    return isEmail(text) ? (nameOfEmail.get(lower(text)) || text) : text;
  };

  for (const row of rows) {
    const id = String(row.id);
    const byId = row.staff_id ? nameOfStaff.get(String(row.staff_id)) : null;
    executors.set(id, byId || readable(row.staff_name) || readable(actorOf.get(id)) || null);
  }
  return executors;
}

module.exports = { resolvePaymentExecutors };
