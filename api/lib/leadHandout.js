'use strict';

// Handing a large pool of unassigned leads to reps, in bounded steps.
//
// «توزيع الليدز» and the bulk-assign route used to take every eligible lead in ONE transaction: SELECT … FOR UPDATE over the whole
// pool (tens of thousands of rows locked at once, so every rep saving a lead and every public form waited behind it), one timeline
// INSERT per lead, and — for distribute — no timeline event and no notice at all. Now a request works through at most HANDOUT_CAP
// leads, HANDOUT_CHUNK at a time, each chunk its own short transaction; it answers how many are still waiting and where to carry on
// (`skip`), so the screen can call again until nothing remains.

const { uuidv4 } = require('./id');
const { createNotification } = require('./notification');

const HANDOUT_CAP = 2000;
const HANDOUT_CHUNK = 250;

/** One UPDATE and one multi-row timeline INSERT for a chunk's placements — the chunk's whole write is two statements. */
async function writePlacements(conn, tenantId, placements, { label, actor }) {
  if (!placements.length) return;
  const ids = placements.map(p => p.id);
  const whenSql = placements.map(() => 'WHEN id = ? THEN ?').join(' ');
  await conn.query(
    `UPDATE leads SET assigned_sales_id = CASE ${whenSql} END, assigned_sales_name = CASE ${whenSql} END, assigned_at = NOW(), updated_at = NOW()
      WHERE tenant_id=? AND id IN (${ids.map(() => '?').join(',')})`,
    [...placements.flatMap(p => [p.id, p.salesId]), ...placements.flatMap(p => [p.id, p.salesName]), tenantId, ...ids]
  );
  await conn.query(
    `INSERT INTO lead_timeline (id, tenant_id, lead_id, event_type, description, meta_json, at)
     VALUES ${placements.map(() => "(?, ?, ?, 'assigned', ?, ?, NOW())").join(', ')}`,
    placements.flatMap(p => [uuidv4(), tenantId, p.id, `${label}: ${p.salesName || p.salesId}`,
      JSON.stringify({ fromSalesId: null, salesId: p.salesId, salesName: p.salesName, actor })])
  );
}

/**
 * @param {import('mysql2/promise').PoolConnection} conn  a connection with no transaction open (the caller may hold a GET_LOCK on it)
 * @param {object} input
 * @param {string} input.tenantId
 * @param {string} input.label   the timeline's description prefix («تعيين جماعي لـ»)
 * @param {string} input.actor   who pressed the button
 * @param {number} [input.skip]  leads at the front of the pool that no rep takes, from the previous answer
 * @param {boolean} [input.placedLeaveThePool=true]  false when a placed lead still matches the read (the «all» mode)
 * @param {(conn, offset: number, limit: number) => Promise<object[]>} input.readChunk  locks and returns the next rows, in a stable order
 * @param {(rows: object[]) => Promise<{placements: {id, salesId, salesName}[], stop?: boolean}>} input.place  pure placement, no writes
 * @param {(conn) => Promise<void>} [input.afterChunk]  persist rotation state inside the chunk's transaction
 * @returns {Promise<{assigned: number, scanned: number, skip: number, exhausted: boolean, perRep: Map<string, {name: string, count: number}>}>}
 */
async function handOutInChunks({ conn, tenantId, label, actor, skip = 0, placedLeaveThePool = true, cap = HANDOUT_CAP, chunk = HANDOUT_CHUNK, readChunk, place, afterChunk }) {
  const perRep = new Map();
  let assigned = 0;
  let scanned = 0;
  let offset = Math.max(0, Number(skip) || 0);
  let exhausted = false;
  while (scanned < cap) {
    await conn.beginTransaction();
    try {
      const rows = await readChunk(conn, offset, Math.min(chunk, cap - scanned));
      if (!rows.length) { await conn.commit(); exhausted = true; break; }
      const { placements, stop } = await place(rows);
      await writePlacements(conn, tenantId, placements, { label, actor });
      if (afterChunk) await afterChunk(conn);
      await conn.commit();
      for (const p of placements) {
        const entry = perRep.get(p.salesId) || { name: p.salesName, count: 0 };
        entry.count += 1;
        perRep.set(p.salesId, entry);
      }
      assigned += placements.length;
      scanned += rows.length;
      offset += placedLeaveThePool ? rows.length - placements.length : rows.length;
      if (stop) { exhausted = true; break; }
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    }
  }
  return { assigned, scanned, skip: offset, exhausted, perRep };
}

/** One notice per rep for the whole request — «اتعين ليك 40 ليد» — not one per lead. */
async function notifyReps(tenantId, perRep) {
  await Promise.all([...perRep].map(([repId, { count }]) => createNotification(
    'lead', '👤 ليدز اتعينت ليك', `اتعين ليك ${count} ليد جديد`, { count, bulk: true }, tenantId, repId)));
}

module.exports = { HANDOUT_CAP, HANDOUT_CHUNK, handOutInChunks, notifyReps };
