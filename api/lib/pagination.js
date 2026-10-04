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

// DATETIME values arrive from mysql2 as Dates in the server's local time and
// are compared back the same way, so the cursor carries the local wall-clock
// text. toISOString() wrote UTC instead, and on a server not running in UTC the
// next page started hours away from where the last one ended.
const pad = (n, w = 2) => String(n).padStart(w, '0');
function sqlDateTime(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
// A cursor written by the old encoder is ISO UTC; read it as the instant it is.
function cursorTs(ts) {
  if (/T.*(Z|[+-]\d{2}:?\d{2})$/.test(ts)) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return sqlDateTime(d);
  }
  return ts;
}
// 'l.created_at' is the column in SQL, but the row key mysql2 returns is
// 'created_at'. Reading last['l.created_at'] gave undefined, so every cursor
// was "undefined|undefined" and the second page never came.
const rowKey = col => String(col).split('.').pop();

function keyset(query = {}, { col = 'created_at', idCol = 'id', limit: defLimit = 50, maxLimit = 200 } = {}) {
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defLimit));
  let where = '1=1';
  let params = [];
  if (query.cursor) {
    try {
      const [ts, id] = Buffer.from(String(query.cursor), 'base64').toString('utf8').split('|');
      if (ts && id && ts !== 'undefined' && id !== 'undefined') {
        const at = cursorTs(ts);
        where = `(${col} < ? OR (${col} = ? AND ${idCol} < ?))`;
        params = [at, at, id];
      }
    } catch { /* malformed cursor → start from first page */ }
  }
  const nextCursor = (rows) => {
    if (!Array.isArray(rows) || rows.length < limit) return null;
    const last = rows[rows.length - 1];
    const raw = last[rowKey(col)];
    const id = last[rowKey(idCol)];
    if (raw == null || id == null) return null;
    const ts = raw instanceof Date ? sqlDateTime(raw) : String(raw);
    return encodeCursor(ts, id);
  };
  return { where, params, limit, nextCursor };
}

module.exports = { offsetPage, keyset, encodeCursor };
