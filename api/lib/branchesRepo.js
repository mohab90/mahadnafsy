'use strict';
/**
 * Dynamic branches reader (Scalability #6). Reads the existing `branches` table
 * (branch_key, label, branch_type, timezone, currency, is_active), cached,
 * falling back to the static constant list if the table is empty/unreachable —
 * so the app works regardless. New branches are added as data, not code.
 */
const { pool, cached } = require('./db');
const { BRANCHES, BRANCH_LABELS_AR } = require('../constants/branches');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');

// Returns [{ branch_key, label, branch_type, timezone, currency }], cached 5 min.
async function listBranches(tenantId = DEFAULT_TENANT) {
  try {
    return await cached(`branches:${tenantId}`, 5 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        `SELECT branch_key, label, branch_type, timezone, currency
         FROM branches WHERE tenant_id=? AND is_active=1 ORDER BY label`,
        [tenantId]
      );
      if (!rows.length) throw new Error('empty');
      return rows;
    });
  } catch {
    return BRANCHES.map((k) => ({
      branch_key: k, label: BRANCH_LABELS_AR[k],
      branch_type: k.startsWith('ONLINE') ? 'online' : 'physical',
      timezone: 'Africa/Cairo', currency: 'EGP',
    }));
  }
}

async function branchKeys(tenantId = DEFAULT_TENANT) {
  return (await listBranches(tenantId)).map((b) => b.branch_key);
}

module.exports = { listBranches, branchKeys };
