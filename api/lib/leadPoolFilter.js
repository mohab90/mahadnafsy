'use strict';

// The CRM's pool tabs — «محلي جديد», «داتا سعودي», «محلي قديم» — filtered in
// the database.
//
// They used to download every lead and keep the ones that matched
// admin/pages/dashboard/tabs/leads/leadSourceGroups.ts. At 30k leads that is 20
// MB before the first row; past the 50,000-row fetch cap the tab silently showed
// a slice and called it the pool. These are the same predicates in SQL, checked
// case by case against the browser's own (leadPoolParity.integration.test.js),
// so the tab downloads its pool and nothing else.

const { ARCHIVE_SOURCE_PREFIXES } = require('./leadArchive');

// leadSourceGroups.ts — keep the lists identical.
const INTERNATIONAL_BRANCHES = ['ONLINE_ABROAD', 'ONLINE_SAUDI'];
const TERMINAL_LEAD_STATUSES = [
  'converted', 'lost', 'won', 'closed', 'not_interested', 'not_interested_hidden',
  'wrong_number', 'unqualified', 'disqualified', 'archived',
];
const VIEWS = ['localNew', 'dawli', 'archive'];

const escapeLike = value => String(value).replace(/[\\%_]/g, match => `\\${match}`);

// isArchiveSource(): the source, trimmed, starts with an archive prefix.
const ARCHIVE = {
  sql: `(${ARCHIVE_SOURCE_PREFIXES.map(() => "TRIM(COALESCE(l.source, '')) LIKE ?").join(' OR ')})`,
  params: ARCHIVE_SOURCE_PREFIXES.map(prefix => `${escapeLike(prefix)}%`),
};
// mapLeadRow's branch (the column, else crm_json.branch), as isInternationalLead
// reads it — or a source starting «دولي».
const BRANCH = `COALESCE(NULLIF(l.branch, ''),
  IF(JSON_VALID(l.crm_json) AND JSON_TYPE(JSON_EXTRACT(l.crm_json, '$.branch')) = 'STRING',
     JSON_UNQUOTE(JSON_EXTRACT(l.crm_json, '$.branch')), NULL))`;
const INTERNATIONAL = {
  sql: `(REGEXP_REPLACE(UPPER(TRIM(COALESCE(${BRANCH}, ''))), '[-[:space:]]+', '_') IN (?) OR TRIM(COALESCE(l.source, '')) LIKE ?)`,
  params: [INTERNATIONAL_BRANCHES, 'دولي%'],
};
// isUndistributedLead(): visible, nobody on it, not archive data, not closed.
const UNDISTRIBUTED = {
  sql: `(l.hidden = 0 AND COALESCE(l.assigned_sales_id, '') = '' AND COALESCE(l.assigned_cs_id, '') = ''
    AND NOT ${ARCHIVE.sql} AND TRIM(COALESCE(l.status, 'new')) NOT IN (?))`,
  params: [...ARCHIVE.params, TERMINAL_LEAD_STATUSES],
};

/**
 * The WHERE condition (starting ' AND ') for one pool tab.
 *   localNew  isLocalNewLead
 *   dawli     isDawliNewLead, or visible international archive data («داتا سعودي»)
 *   archive   visible archive data that is not international («محلي قديم»)
 */
function leadPoolFilter(view) {
  if (view === 'localNew') {
    return { sql: ` AND ${UNDISTRIBUTED.sql} AND NOT ${INTERNATIONAL.sql}`, params: [...UNDISTRIBUTED.params, ...INTERNATIONAL.params] };
  }
  if (view === 'dawli') {
    return {
      sql: ` AND ((${UNDISTRIBUTED.sql} AND ${INTERNATIONAL.sql}) OR (l.hidden = 0 AND ${ARCHIVE.sql} AND ${INTERNATIONAL.sql}))`,
      params: [...UNDISTRIBUTED.params, ...INTERNATIONAL.params, ...ARCHIVE.params, ...INTERNATIONAL.params],
    };
  }
  if (view === 'archive') {
    return { sql: ` AND l.hidden = 0 AND ${ARCHIVE.sql} AND NOT ${INTERNATIONAL.sql}`, params: [...ARCHIVE.params, ...INTERNATIONAL.params] };
  }
  return null;
}

/**
 * explainUnassigned(): where every visible lead with no owner is — the
 * «محلي جديد» banner that says why the tab holds fewer than «بدون مندوب».
 */
async function unassignedBreakdown(db, tenantId, scope) {
  const [rows] = await db.query(
    `SELECT CASE
              WHEN ${ARCHIVE.sql} THEN 'archiveSource'
              WHEN TRIM(COALESCE(l.status, 'new')) IN (?) THEN CONCAT('terminal:', LOWER(TRIM(l.status)))
              WHEN ${INTERNATIONAL.sql} THEN 'dawliNew'
              ELSE 'localNew' END AS bucket,
            COUNT(*) AS n
       FROM leads l
      WHERE l.tenant_id = ? AND l.hidden = 0 AND COALESCE(l.assigned_sales_id, '') = '' AND COALESCE(l.assigned_cs_id, '') = ''${scope.sql}
      GROUP BY bucket`,
    [...ARCHIVE.params, TERMINAL_LEAD_STATUSES, ...INTERNATIONAL.params, tenantId, ...scope.params]);
  const result = { withoutOwner: 0, localNew: 0, dawliNew: 0, archiveSource: 0, terminal: [] };
  for (const row of rows) {
    const n = Number(row.n);
    result.withoutOwner += n;
    if (row.bucket.startsWith('terminal:')) result.terminal.push({ status: row.bucket.slice(9), count: n });
    else result[row.bucket] += n;
  }
  result.terminal.sort((a, b) => b.count - a.count);
  return result;
}

module.exports = { leadPoolFilter, unassignedBreakdown, VIEWS, TERMINAL_LEAD_STATUSES };
