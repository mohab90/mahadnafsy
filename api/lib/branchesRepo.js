'use strict';
/**
 * Dynamic branches reader (Scalability #6). Reads the branches table (cached),
 * falling back to the static constant list so the app works before migration 018
 * runs and on any DB hiccup. Lets new branches be added as data, not code.
 */
const { pool, cached } = require('./db');
const { BRANCHES, BRANCH_LABELS_AR } = require('../constants/branches');

// Returns [{ branch_key, label_ar, kind, is_active, sort_order }], cached 5 min.
async function listBranches(tenantId = 'mahad') {
  try {
    return await cached(`branches:${tenantId}`, 5 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        'SELECT branch_key, label_ar, label_en, kind, is_active, sort_order FROM branches WHERE tenant_id=? AND is_active=1 ORDER BY sort_order',
        [tenantId]
      );
      if (!rows.length) throw new Error('empty'); // fall through to fallback
      return rows;
    });
  } catch {
    return BRANCHES.map((k, i) => ({ branch_key: k, label_ar: BRANCH_LABELS_AR[k], kind: k.startsWith('ONLINE') ? 'online' : 'physical', is_active: 1, sort_order: i + 1 }));
  }
}

async function branchKeys(tenantId = 'mahad') {
  return (await listBranches(tenantId)).map((b) => b.branch_key);
}

module.exports = { listBranches, branchKeys };
