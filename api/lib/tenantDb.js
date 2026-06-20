'use strict';
/**
 * Tenant-aware DB wrapper (Top20 #1). Every query is scoped to a tenant_id so
 * future multi-tenant data can never leak across institutes. In single-tenant
 * mode the tenant is DEFAULT_TENANT ('mahad') and behaviour is unchanged.
 *
 * Usage:
 *   const { tenantDb } = require('../lib/tenantDb');
 *   const db = tenantDb(pool, req.tenantId);
 *   const leads = await db.select('leads', 'status = ?', ['new']);
 *   await db.insert('leads', { id, name });           // tenant_id auto-set
 *   db.assertOwned(row);                              // 403 on cross-tenant row
 */
const { DEFAULT_TENANT } = require('../middleware/tenantContext');

function tenantDb(pool, tenantId) {
  const tid = tenantId || DEFAULT_TENANT;
  const tbl = (t) => '`' + String(t).replace(/[^a-zA-Z0-9_]/g, '') + '`';
  return {
    tenantId: tid,

    // SELECT * FROM <table> WHERE tenant_id=? [AND (<extraWhere>)]
    async select(table, extraWhere, params = []) {
      const where = extraWhere ? `tenant_id = ? AND (${extraWhere})` : 'tenant_id = ?';
      const [rows] = await pool.query(`SELECT * FROM ${tbl(table)} WHERE ${where}`, [tid, ...params]);
      return rows;
    },

    // INSERT with tenant_id forced onto the row.
    async insert(table, data) {
      const row = { ...data, tenant_id: tid };
      const cols = Object.keys(row);
      const placeholders = cols.map(() => '?').join(',');
      const colSql = cols.map((c) => tbl(c)).join(',');
      const [r] = await pool.query(
        `INSERT INTO ${tbl(table)} (${colSql}) VALUES (${placeholders})`,
        cols.map((c) => row[c])
      );
      return r;
    },

    // UPDATE always scoped by tenant_id so one tenant can't mutate another's rows.
    async update(table, data, idWhere, idParams = []) {
      const sets = Object.keys(data).map((c) => `${tbl(c)}=?`).join(',');
      const [r] = await pool.query(
        `UPDATE ${tbl(table)} SET ${sets} WHERE tenant_id = ? AND (${idWhere})`,
        [...Object.values(data), tid, ...idParams]
      );
      return r;
    },

    // Guard for read-by-id paths: throw 403 if a row belongs to another tenant.
    assertOwned(row) {
      if (row && row.tenant_id != null && String(row.tenant_id) !== String(tid)) {
        const e = new Error('cross-tenant access denied');
        e.status = 403;
        throw e;
      }
      return row;
    },
  };
}

module.exports = { tenantDb };
