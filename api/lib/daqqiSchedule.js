'use strict';
/**
 * The one translation between the two ways this system talks about a room.
 *
 * daqqi_rounds books a hall by free-text name plus a recurring Arabic weekday
 * and a coarse time_slot. classroom_bookings books the same physical hall by
 * foreign key to physical_classrooms plus absolute start_time/end_time. Asking
 * whether the two collide needs exactly this map, and both directions of the
 * check need it, so it lives here rather than inside either route.
 *
 * Both spellings of Monday are listed because both appear in Arabic UIs and
 * neither is wrong.
 */

// Arabic weekday name → MySQL DAYOFWEEK (1 = Sunday … 7 = Saturday).
const ARABIC_WEEKDAY_TO_MYSQL = Object.freeze({
  'الأحد': 1,
  'الإثنين': 2,
  'الاثنين': 2,
  'الثلاثاء': 3,
  'الأربعاء': 4,
  'الخميس': 5,
  'الجمعة': 6,
  'السبت': 7,
});

/** MySQL DAYOFWEEK → every Arabic spelling a round may have been saved with. */
const MYSQL_WEEKDAY_TO_ARABIC = Object.freeze(
  Object.entries(ARABIC_WEEKDAY_TO_MYSQL).reduce((acc, [name, number]) => {
    (acc[number] = acc[number] || []).push(name);
    return acc;
  }, {})
);

/** The weekday number a round's Arabic day names, or undefined if unrecognised. */
function mysqlWeekdayFromArabic(dayName) {
  return ARABIC_WEEKDAY_TO_MYSQL[String(dayName || '').trim()];
}

/**
 * Every spelling a round could carry for the weekday of this JS Date. Returns
 * [] when the date is unusable, so a caller building a WHERE ... IN () clause
 * can skip the check rather than match everything.
 */
function arabicWeekdaysForDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return [];
  // getUTCDay is 0 = Sunday; MySQL DAYOFWEEK is 1 = Sunday.
  return MYSQL_WEEKDAY_TO_ARABIC[date.getUTCDay() + 1] || [];
}

module.exports = {
  ARABIC_WEEKDAY_TO_MYSQL,
  MYSQL_WEEKDAY_TO_ARABIC,
  mysqlWeekdayFromArabic,
  arabicWeekdaysForDate,
};
