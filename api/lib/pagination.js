'use strict';
/**
 * Pagination helpers (Top20 #9 offset, #10 keyset/cursor).
 * - offsetPage : clamps page/limit so no admin list can be unbounded.
 * - keyset     : cursor pagination on a monotonic (col, idCol) tuple for large
 *                tables (leads/payments) — stable under inserts, no deep OFFSET.
 */
function offsetPage(query = {}, { defLimit = 50, maxLimit = 200 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defLimit));
  return { page, limit, offset: (page - 1) * limit };
}

function encodeCursor(ts, id) {
  return Buffer.from(`${ts}|${id}`).toString('base64');
}

function keyset(query = {}, { col = 'created_at', idCol = 'id', limit: defLimit = 50, maxLimit = 200 } = {}) {
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defLimit));
  let where = '1=1';
  let params = [];
  if (query.cursor) {
    try {
      const [ts, id] = Buffer.from(String(query.cursor), 'base64').toString('utf8').split('|');
      if (ts && id) {
        where = `(${col} < ? OR (${col} = ? AND ${idCol} < ?))`;
        params = [ts, ts, id];
      }
    } catch { /* malformed cursor → start from first page */ }
  }
  const nextCursor = (rows) => {
    if (!Array.isArray(rows) || rows.length < limit) return null;
    const last = rows[rows.length - 1];
    const raw = last[col];
    const ts = raw instanceof Date ? raw.toISOString() : String(raw);
    return encodeCursor(ts, last[idCol]);
  };
  return { where, params, limit, nextCursor };
}

module.exports = { offsetPage, keyset, encodeCursor };
