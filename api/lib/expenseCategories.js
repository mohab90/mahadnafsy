'use strict';
/**
 * One place that decides what an expense category is.
 *
 * expenses.category is an ENUM of English codes (SALARIES, MARKETING, …).
 * budgets.category is a free-text column, and every screen that writes a budget
 * writes the Arabic label ('رواتب', 'تسويق', …). The budget screen then joined
 * the two by string equality, so spendMap['SALARIES'] was looked up as
 * spendMap['رواتب'] and «الفعلي» read 0 for every category, forever — the
 * over-budget alert could never fire and إجمالي الإنفاق always showed zero.
 *
 * The map lived inside routes/admin-operations.js, where the budget route could
 * not reach it. It lives here now so both sides translate the same way.
 */

const EXPENSE_CATEGORY_DB = Object.freeze({
  'رواتب': 'SALARIES',
  'تسويق': 'MARKETING',
  'إيجار': 'RENT',
  'برمجيات': 'SOFTWARE',
  'معدات': 'EQUIPMENT',
  'أخرى': 'OTHER',
});

const EXPENSE_CATEGORY_LABEL = Object.freeze(
  Object.fromEntries(Object.entries(EXPENSE_CATEGORY_DB).map(([label, code]) => [code, label]))
);

/** Accepts either spelling and returns the DB code, defaulting to OTHER. */
function expenseCategory(value) {
  const key = String(value || 'OTHER').trim();
  const code = EXPENSE_CATEGORY_DB[key] || key.toUpperCase();
  return EXPENSE_CATEGORY_LABEL[code] ? code : 'OTHER';
}

module.exports = { EXPENSE_CATEGORY_DB, EXPENSE_CATEGORY_LABEL, expenseCategory };
