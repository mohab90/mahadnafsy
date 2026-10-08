'use strict';

// «اقدر اسجل فيه تقييم العميل من 1 الي 10 في المحاضر وفي المادة العلميه وفي
// توصيل المعلومه وفي مسئولين الفرع» (8 Oct 2026). The four questions, in the
// order the desk asks them; client_ratings keeps one column for each.

const SCORES = Object.freeze([
  { key: 'instructor', column: 'instructor_score', label: 'المحاضر' },
  { key: 'material', column: 'material_score', label: 'المادة العلمية' },
  { key: 'delivery', column: 'delivery_score', label: 'توصيل المعلومة' },
  { key: 'branchStaff', column: 'branch_staff_score', label: 'مسئولين الفرع' },
]);

/** A whole number from 1 to 10, else null. */
function scoreOf(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

/** The four scores' mean, to one decimal, from a client_ratings row. */
function averageOf(row) {
  const total = SCORES.reduce((sum, { column }) => sum + Number(row?.[column] || 0), 0);
  return Math.round((total / SCORES.length) * 10) / 10;
}

module.exports = { SCORES, scoreOf, averageOf };
