'use strict';

// calcLeadScoreServer(), expressed in SQL.
//
// lib/helpers.js holds the JavaScript original and remains the version the write
// path uses; this is the same formula arranged so a rep's mean score can be a
// GROUP BY instead of 26,888 rows crossing the network to be averaged in a
// browser. The two are checked against each other on real data — every lead,
// both ways — and they agree exactly.
//
// Expects a joined subquery aliased `lc` carrying comm_count and last_comm.
//
// Three fields read crm_json when their own column is empty, because the row
// mapper does the same and the JS formula is fed the mapped value. Without those
// arms two leads out of 26,888 scored differently — old rows whose course list
// and interest level only ever made it into the JSON blob. JSON_VALID guards
// each one: crm_json is free-form text on old rows and MariaDB will not extract
// from something that is not JSON.
//
// The two day-counts deliberately differ in shape, matching the original: the
// contact decay measures from the calendar day of the last communication (the JS
// slices the date before parsing it), while the no-contact decay measures from
// the full created_at timestamp. FLOOR(TIMESTAMPDIFF(SECOND …)/86400) rather than
// DATEDIFF because DATEDIFF rounds both operands to dates and would count a day
// too many on the second one.
const LEAD_SCORE_SQL = `
  LEAST(100, GREATEST(0,
    -- No LOWER() on the subject: the column collates utf8mb4_unicode_ci, so
    -- 'NEW' matches the 'new' arm on its own. Wrapping it changed nothing but
    -- the query plan.
    CASE l.status
      WHEN 'new' THEN 5 WHEN 'contacted' THEN 15
      WHEN 'interested' THEN 35 WHEN 'interested_booking' THEN 35
      WHEN 'interested_followup' THEN 35
      WHEN 'postpone_month' THEN 10
      WHEN 'no_answer' THEN 8 WHEN 'no_answer_wa' THEN 8 WHEN 'no_answer_nowa' THEN 8
      WHEN 'wrong_number' THEN 0 WHEN 'with_colleague' THEN 10
      WHEN 'not_interested' THEN 0 WHEN 'not_interested_hidden' THEN 0
      WHEN 'closed' THEN 50 WHEN 'converted' THEN 100 WHEN 'lost' THEN 0
      WHEN 'other' THEN 2 ELSE 0
    END
    + CASE LOWER(COALESCE(
        NULLIF(l.interest_level, ''),
        NULLIF(IF(JSON_VALID(l.crm_json)
                  AND JSON_TYPE(JSON_EXTRACT(l.crm_json, '$.interestLevel')) NOT IN ('NULL'),
                  JSON_UNQUOTE(JSON_EXTRACT(l.crm_json, '$.interestLevel')), NULL), ''),
        ''))
        WHEN 'high' THEN 30 WHEN 'medium' THEN 15 ELSE 5
      END
    + LEAST(COALESCE(lc.comm_count, 0) * 5, 25)
    + IF(l.next_follow_up_date IS NOT NULL
         OR COALESCE(NULLIF(IF(JSON_VALID(l.crm_json)
                               AND JSON_TYPE(JSON_EXTRACT(l.crm_json, '$.nextFollowUpDate')) NOT IN ('NULL'),
                               JSON_UNQUOTE(JSON_EXTRACT(l.crm_json, '$.nextFollowUpDate')), NULL), ''),
                     '') <> '', 5, 0)
    + IF(COALESCE(
           JSON_LENGTH(l.interested_course_ids_json),
           IF(JSON_VALID(l.crm_json)
              AND JSON_TYPE(JSON_EXTRACT(l.crm_json, '$.interestedCourseIds')) = 'ARRAY',
              JSON_LENGTH(JSON_EXTRACT(l.crm_json, '$.interestedCourseIds')), NULL),
           0) > 0, 10, 0)
    - IF(l.status IN ('converted','lost','not_interested','not_interested_hidden','wrong_number'),
         0,
         IF(lc.last_comm IS NOT NULL,
            GREATEST(0, LEAST((FLOOR(TIMESTAMPDIFF(SECOND, DATE(lc.last_comm), NOW()) / 86400) - 7) * 2, 30)),
            GREATEST(0, LEAST((FLOOR(TIMESTAMPDIFF(SECOND, l.created_at, NOW()) / 86400) - 14) * 1, 20))
         )
      )
  ))`;

module.exports = { LEAD_SCORE_SQL };
