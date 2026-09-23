'use strict';

/**
 * Leads whose source marks them as imported archive data ("محلي قديم",
 * "دولي قديم", "استيراد …"). The admin app keeps them in their own tabs and out
 * of the live pool — see admin/pages/dashboard/tabs/leads/leadSourceGroups.ts,
 * which must list the same prefixes.
 *
 * The server did not know this rule, so "توزيع تلقائي" and the other automatic
 * distributors picked up the whole archive along with the handful of new
 * leads the button was pressed for, and pushed thousands of archive rows onto
 * the sales team.
 */
const ARCHIVE_SOURCE_PREFIXES = ['محلي قديم', 'دولي قديم', 'استيراد'];
const DEFAULT_ARCHIVE_SOURCE = 'محلي قديم';

function isArchiveSource(source) {
  const value = String(source || '').trim();
  return ARCHIVE_SOURCE_PREFIXES.some(prefix => value.startsWith(prefix));
}

/** `AND NOT (<col> is an archive source)` for a WHERE clause. */
function excludeArchiveSourcesSql(column = 'source') {
  return {
    sql: ` AND NOT (${ARCHIVE_SOURCE_PREFIXES.map(() => `TRIM(COALESCE(${column},'')) LIKE ?`).join(' OR ')})`,
    params: ARCHIVE_SOURCE_PREFIXES.map(prefix => `${prefix}%`),
  };
}

module.exports = {
  ARCHIVE_SOURCE_PREFIXES,
  DEFAULT_ARCHIVE_SOURCE,
  excludeArchiveSourcesSql,
  isArchiveSource,
};
