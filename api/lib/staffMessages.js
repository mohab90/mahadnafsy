'use strict';

// A message to one employee, in the same inbox the administration writes to them in (staff_messages — the «الرسائل» bell
// and the employee's own page; routes/hr/staffprofile.js). Not a notification: it stays in the thread until read.

const { uuidv4 } = require('./id');

/**
 * @param {object} db   a mysql2 pool or connection
 * @returns {Promise<string>} the message id
 */
async function sendStaffMessage(db, { tenantId, staffId, authorId = null, authorName = '', body }) {
  const text = String(body || '').trim().slice(0, 4000);
  if (!tenantId || !staffId || !text) throw new Error('A staff message needs a tenant, a recipient and a text');
  const id = uuidv4();
  await db.query(
    `INSERT INTO staff_messages (id, tenant_id, staff_id, author_staff_id, author_name, direction, body)
     VALUES (?,?,?,?,?, 'to_staff', ?)`,
    [id, tenantId, staffId, authorId || null, String(authorName || '').slice(0, 255), text]);
  return id;
}

module.exports = { sendStaffMessage };
