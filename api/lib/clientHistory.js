'use strict';

// «اي مسح لكورس او اي تحويل او اي حاجه بتحصل لازم تتسجل في هيستوري العميل
// ومين اللى نفذ المهمه». One row per act on a client's courses and money, in
// activity_logs under the client, read back by «رحلة العميل الموحّدة»
// (lib/customerTimeline.js) with the name of whoever did it.
//
// The lead timeline was the only other place, and a client imported from a
// sheet has no lead — 1,920 Dokki clients among them — so it could not be it.

const { uuidv4 } = require('./id');

const ENTITY = 'subscriber';

/** Inside the caller's transaction, so the act and its record commit together. */
async function logClientEvent(db, { tenantId, subscriberId, action, label, actor }) {
  await db.query(
    'INSERT INTO activity_logs (id, tenant_id, action, entity, entity_id, label, actor) VALUES (?,?,?,?,?,?,?)',
    [uuidv4(), tenantId, String(action).slice(0, 50), ENTITY, subscriberId,
      String(label).slice(0, 2000), actor ? String(actor).slice(0, 255) : null],
  );
}

/** The name to write: the staff member's, else the account's email. */
const actorName = req => req.staffRecord?.name || req.user?.name || req.user?.email || 'admin';

module.exports = { ENTITY, actorName, logClientEvent };
