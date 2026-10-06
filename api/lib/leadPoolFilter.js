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
const { CONVERTED_LIST, TERMINAL_LIST } = require('./leadStatuses');

// leadSourceGroups.ts — keep the lists identical.
const INTERNATIONAL_BRANCHES = ['ONLINE_ABROAD', 'ONLINE_SAUDI'];
const TERMINAL_LEAD_STATUSES = TERMINAL_LIST;
const VIEWS = ['localNew', 'dawli', 'archive'];
const REASONS = ['waiting', 'closed', 'archived', 'hidden'];

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
// poolReasonOf(): why a lead is in a pool tab, or NULL. Beyond the browser's
// copy, which only ever sees what this sends it: a merged or deleted lead is in
// none, and neither is a hidden lead whose number is a client's now.
const POOL_REASON = {
  sql: `(CASE
    WHEN l.merged_into_lead_id IS NOT NULL OR l.deleted_at IS NOT NULL THEN NULL
    WHEN LOWER(TRIM(COALESCE(l.status, ''))) IN (?) THEN NULL
    WHEN l.hidden = 1 THEN IF((TRIM(COALESCE(l.phone, '')) <> '' OR TRIM(COALESCE(l.email, '')) <> '')
        AND NOT EXISTS (SELECT 1 FROM subscribers ps WHERE ps.tenant_id = l.tenant_id AND ps.deleted_at IS NULL
                         AND ps.phone = l.phone AND TRIM(COALESCE(l.phone, '')) <> ''), 'hidden', NULL)
    WHEN ${ARCHIVE.sql} THEN NULL
    WHEN LOWER(TRIM(COALESCE(l.status, ''))) = 'archived' THEN 'archived'
    WHEN COALESCE(l.assigned_sales_id, '') <> '' OR COALESCE(l.assigned_cs_id, '') <> '' THEN NULL
    WHEN LOWER(TRIM(COALESCE(l.status, ''))) IN (?) THEN 'closed'
    ELSE 'waiting' END)`,
  params: [CONVERTED_LIST, ...ARCHIVE.params, TERMINAL_LEAD_STATUSES],
};

/**
 * The WHERE condition (starting ' AND ') for one pool tab.
 *   localNew  isLocalNewLead — every reason, or the one asked for
 *   dawli     isDawliNewLead, or visible international archive data («داتا سعودي»)
 *   archive   visible archive data that is not international («محلي قديم»)
 */
function leadPoolFilter(view, { reason = null } = {}) {
  const only = REASONS.includes(reason) ? reason : null;
  const inPool = only
    ? { sql: `${POOL_REASON.sql} = ?`, params: [...POOL_REASON.params, only] }
    : { sql: `${POOL_REASON.sql} IS NOT NULL`, params: POOL_REASON.params };
  if (view === 'localNew') {
    return { sql: ` AND ${inPool.sql} AND NOT ${INTERNATIONAL.sql}`, params: [...inPool.params, ...INTERNATIONAL.params] };
  }
  if (view === 'dawli') {
    return {
      sql: ` AND ((${inPool.sql} AND ${INTERNATIONAL.sql}) OR (l.hidden = 0 AND ${ARCHIVE.sql} AND ${INTERNATIONAL.sql}))`,
      params: [...inPool.params, ...INTERNATIONAL.params, ...ARCHIVE.params, ...INTERNATIONAL.params],
    };
  }
  if (view === 'archive') {
    return { sql: ` AND l.hidden = 0 AND ${ARCHIVE.sql} AND NOT ${INTERNATIONAL.sql}`, params: [...ARCHIVE.params, ...INTERNATIONAL.params] };
  }
  return null;
}

/** The reason column itself, for the rows a pool tab sends: «مستني توزيع», «مؤرشف»… */
const POOL_REASON_COLUMN = { sql: `${POOL_REASON.sql} AS pool_reason`, params: POOL_REASON.params };

/**
 * poolBreakdownOf(): how many of a pool tab's leads are there for each reason —
 * the chips above «محلي جديد», and the badge, which counts the waiting ones.
 */
async function poolBreakdown(db, tenantId, scope, view) {
  const filter = leadPoolFilter(view);
  const [rows] = await db.query(
    `SELECT ${POOL_REASON.sql} AS reason, COUNT(*) AS n
       FROM leads l
      WHERE l.tenant_id = ?${scope.sql}${filter.sql}
      GROUP BY reason`,
    [...POOL_REASON.params, tenantId, ...scope.params, ...filter.params]);
  const result = { waiting: 0, closed: 0, archived: 0, hidden: 0 };
  for (const row of rows) if (REASONS.includes(row.reason)) result[row.reason] += Number(row.n);
  return result;
}

module.exports = { leadPoolFilter, poolBreakdown, POOL_REASON_COLUMN, REASONS, VIEWS, TERMINAL_LEAD_STATUSES };
