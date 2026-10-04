'use strict';

// The CRM's main lead table, filtered in the database.
//
// The table used to download every lead and filter the array in the browser
// (admin/pages/dashboard/tabs/leads/useLeadFilteringData.ts). At 30k leads that
// was 20 MB before the first row drew; at 500k it cannot work at all — the
// browser fetch stops at 50,000 rows, so the table quietly showed the newest
// tenth and called it the whole. This is the same predicate, in SQL, so the
// table can ask for one page and the true total.
//
// Each clause below names the browser rule it reproduces. Where the browser read
// a field out of crm_json because its column was empty, so does this.

const { ARCHIVE_SOURCE_PREFIXES } = require('./leadArchive');
const { addDaysToDateOnly, cairoDayStartUtc } = require('./dates');

// admin/pages/dashboard/tabs/crmConstants.ts ONLINE_EXCLUDED_SOURCES
const ONLINE_EXCLUDED_SOURCES = ['أونلاين 2025', 'تحويل من عملاء الأونلاين'];
// leadUtils.ts getRottenLevel: these statuses are never stale.
const NEVER_STALE = ['converted', 'lost', 'not_interested', 'not_interested_hidden', 'wrong_number'];
const FOLLOWUP_WINDOWS = new Set(['no_followup', 'today', 'overdue', 'past3d', 'past7d', 'past30d', 'next3d', 'next7d']);

const crmText = path => `IF(JSON_VALID(l.crm_json) AND JSON_TYPE(JSON_EXTRACT(l.crm_json, '${path}')) NOT IN ('NULL'),
  JSON_UNQUOTE(JSON_EXTRACT(l.crm_json, '${path}')), NULL)`;
// normBranchId(): trim, upper-case, runs of spaces/dashes to one underscore.
const normBranch = expr => `REGEXP_REPLACE(UPPER(TRIM(${expr})), '[-[:space:]]+', '_')`;
const normBranchJs = value => String(value || '').trim().toUpperCase().replace(/[-\s]+/g, '_');
// getLeadBranchRaw(): the branch, else the raw imported branch, else "الفرع: …" in the notes.
const RAW_BRANCH = `COALESCE(
  NULLIF(TRIM(l.branch), ''),
  NULLIF(TRIM(${crmText('$.branch')}), ''),
  NULLIF(TRIM(${crmText('$.rawBranch')}), ''),
  NULLIF(TRIM(REGEXP_REPLACE(REGEXP_SUBSTR(l.notes, 'الفرع:[[:space:]]*[^|]+'), '^الفرع:[[:space:]]*', '')), ''))`;
// tryJson(interested_course_ids_json, crm.interestedCourseIds)
const COURSE_IDS = `COALESCE(
  IF(JSON_VALID(l.interested_course_ids_json), l.interested_course_ids_json, NULL),
  IF(JSON_VALID(l.crm_json) AND JSON_TYPE(JSON_EXTRACT(l.crm_json, '$.interestedCourseIds')) = 'ARRAY',
     JSON_EXTRACT(l.crm_json, '$.interestedCourseIds'), NULL))`;
// mapLeadRow: ymd(next_follow_up_date) || crm.nextFollowUpDate
const NEXT_FOLLOWUP = `COALESCE(DATE_FORMAT(l.next_follow_up_date, '%Y-%m-%d'), NULLIF(LEFT(${crmText('$.nextFollowUpDate')}, 10), ''))`;

const list = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);
const escapeLike = value => String(value).replace(/[\\%_]/g, match => `\\${match}`);

/**
 * WHERE conditions (each starting ' AND ') for the lead table, after the tenant,
 * hidden-flag and access-scope conditions the route writes itself.
 *
 * @param {object} query   the request's query string
 * @param {object} ctx     { today: 'YYYY-MM-DD' in Cairo, salesOnly: boolean }
 */
function leadTableFilter(query, { today, salesOnly }) {
  let sql = '';
  const params = [];
  const add = (clause, ...values) => { sql += ` AND ${clause}`; params.push(...values); };

  // useLeadEffectiveRecords: imported archives live in their own tab.
  add(`NOT (${ARCHIVE_SOURCE_PREFIXES.map(() => "TRIM(COALESCE(l.source, '')) LIKE ?").join(' OR ')})`,
    ...ARCHIVE_SOURCE_PREFIXES.map(prefix => `${escapeLike(prefix)}%`));
  // visibleLeads: the desk table holds distributed, non-online leads; a rep's is theirs.
  if (!salesOnly) {
    add(`COALESCE(l.source, '') NOT IN (${ONLINE_EXCLUDED_SOURCES.map(() => '?').join(',')})`, ...ONLINE_EXCLUDED_SOURCES);
    add("l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''");
  }
  add("l.status NOT IN ('converted', 'lost')");
  add("(TRIM(COALESCE(l.name, '')) <> '' OR TRIM(COALESCE(l.phone, '')) <> '')");

  // matchesFilters — source and assignment are desk filters, ignored for a rep.
  const sources = list(query.sources);
  if (!salesOnly && sources.length) add(`COALESCE(l.source, '') IN (?)`, sources);
  const assigned = list(query.assigned);
  if (!salesOnly && assigned.length) {
    if (assigned.includes('__none__')) add("(l.assigned_sales_id IS NULL OR l.assigned_sales_id = '')");
    else add('l.assigned_sales_id IN (?)', assigned);
  }
  if (query.tag) {
    add("JSON_VALID(l.crm_json) AND JSON_CONTAINS(JSON_EXTRACT(l.crm_json, '$.tags'), JSON_QUOTE(?))", String(query.tag));
  }
  if (query.course === '__none__') add(`COALESCE(JSON_LENGTH(${COURSE_IDS}), 0) = 0`);
  else if (query.course) add(`JSON_CONTAINS(${COURSE_IDS}, JSON_QUOTE(?))`, String(query.course));
  if (query.branch === '__none__') add(`${RAW_BRANCH} IS NULL`);
  else if (query.branch) {
    // The browser accepted the branch id or its label, either spelled loosely.
    const wanted = [...new Set([query.branch, query.branchLabel].filter(Boolean).map(normBranchJs))];
    add(`${normBranch(RAW_BRANCH)} IN (?)`, wanted);
  }
  if (query.status) add('l.status = ?', String(query.status));
  if (query.salesSource === '__none__') add("TRIM(COALESCE(l.source, '')) = ''");
  else if (query.salesSource) add('l.source = ?', String(query.salesSource));

  // getRottenLevel(lead) >= 1: no contact (or, never contacted, no arrival) for
  // at least the first stale threshold, on a lead that can still go stale.
  const staleDays = Math.floor(Number(query.staleDays));
  if (query.rotten === '1' && staleDays > 0) {
    // Stale = last touched on or before the Cairo day staleDays ago. Times are
    // stored in UTC, so the boundary is the UTC instant that Cairo day ends —
    // not the bare date, which moved it by Cairo's two or three hours.
    const boundary = cairoDayStartUtc(addDaysToDateOnly(today, -staleDays + 1));
    add(`l.status NOT IN (?)
      AND NOT EXISTS (SELECT 1 FROM communications sc WHERE sc.tenant_id = l.tenant_id AND sc.lead_id = l.id AND sc.date >= ?)
      AND (EXISTS (SELECT 1 FROM communications sc WHERE sc.tenant_id = l.tenant_id AND sc.lead_id = l.id) OR l.created_at < ?)`,
    NEVER_STALE, boundary, boundary);
  }

  const window = String(query.followup || '');
  if (FOLLOWUP_WINDOWS.has(window)) {
    if (window === 'no_followup') add(`${NEXT_FOLLOWUP} IS NULL`);
    else {
      const day = n => addDaysToDateOnly(today, n);
      const ranges = {
        today: ['= ?', [today]],
        overdue: ['< ?', [today]],
        past3d: ['BETWEEN ? AND ?', [day(-3), day(-1)]],
        past7d: ['BETWEEN ? AND ?', [day(-7), day(-1)]],
        past30d: ['BETWEEN ? AND ?', [day(-30), day(-1)]],
        next3d: ['BETWEEN ? AND ?', [day(1), day(3)]],
        next7d: ['BETWEEN ? AND ?', [day(1), day(7)]],
      };
      const [op, values] = ranges[window];
      add(`${NEXT_FOLLOWUP} ${op}`, ...values);
    }
  }
  return { sql, params };
}

/**
 * The free-text box: name, email or notes contain the text, or the phone's
 * digits contain the typed digits (four or more) — matchesFilters' search.
 */
function leadTableSearch(q) {
  const text = String(q || '').trim();
  if (!text) return null;
  const like = `%${escapeLike(text.toLowerCase())}%`;
  const digits = text.replace(/\D/g, '');
  const phone = digits.length >= 4
    ? { sql: "REGEXP_REPLACE(COALESCE(l.phone, ''), '[^0-9]', '') LIKE ?", value: `%${digits}%` }
    : { sql: "COALESCE(l.phone, '') LIKE ?", value: `%${escapeLike(text)}%` };
  return {
    sql: `(l.name LIKE ? OR ${phone.sql} OR l.email LIKE ? OR l.notes LIKE ?)`,
    params: [like, phone.value, like, like],
  };
}

module.exports = { leadTableFilter, leadTableSearch, ONLINE_EXCLUDED_SOURCES };
