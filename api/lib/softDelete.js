'use strict';
/**
 * Unified soft delete (Top20 #16). Convention: deleted_at TIMESTAMP NULL on a
 * table, NULL = live. Read paths append liveOnly(); deletes set deleted_at=NOW().
 */
const { pool } = require('./db');
const safeTable = (t) => '`' + String(t).replace(/[^a-zA-Z0-9_]/g, '') + '`';

// SQL fragment for "live rows only", optionally table-aliased.
const liveOnly = (alias = '') => `${alias ? alias + '.' : ''}deleted_at IS NULL`;

async function softDelete(table, idWhere, params = []) {
  const [r] = await pool.query(
    `UPDATE ${safeTable(table)} SET deleted_at=NOW() WHERE ${idWhere} AND deleted_at IS NULL`,
    params
  );
  return r.affectedRows;
}

async function restore(table, idWhere, params = []) {
  const [r] = await pool.query(
    `UPDATE ${safeTable(table)} SET deleted_at=NULL WHERE ${idWhere}`,
    params
  );
  return r.affectedRows;
}

module.exports = { liveOnly, softDelete, restore };
