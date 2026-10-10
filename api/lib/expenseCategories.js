'use strict';
/**
 * One place that decides what an expense category is.
 *
 * The categories are the institute's own list, kept in الإعدادات › فئات المصاريف
 * (tenant setting sys_expense_categories, defaults below). An expense stores the
 * category's key in capitals (RENT, SUPPLIES, …) and every screen shows its label.
 * The list used to be ignored: the screen offered six fixed names and the column
 * an ENUM of nine, so a category added in settings became «أخرى» (migration 264).
 *
 * budgets.category is free text holding the Arabic label, so the budget screen
 * looks a code's label up here too — keyed by the code alone, no budget row ever
 * found its spend.
 */

const DEFAULT_EXPENSE_CATEGORIES = Object.freeze([
  { key: 'rent',        label: 'إيجار',        is_active: true },
  { key: 'salaries',    label: 'رواتب',         is_active: true },
  { key: 'marketing',   label: 'تسويق',        is_active: true },
  { key: 'utilities',   label: 'فواتير',       is_active: true },
  { key: 'supplies',    label: 'مستلزمات',     is_active: true },
  { key: 'maintenance', label: 'صيانة',        is_active: true },
  { key: 'software',    label: 'برامج / تقنية', is_active: true },
  { key: 'travel',      label: 'مواصلات',      is_active: true },
  { key: 'other',       label: 'أخرى',         is_active: true },
]);

// The names the old fixed list wrote, read back the same way.
const EXPENSE_CATEGORY_DB = Object.freeze({
  'رواتب': 'SALARIES',
  'تسويق': 'MARKETING',
  'إيجار': 'RENT',
  'برمجيات': 'SOFTWARE',
  'معدات': 'EQUIPMENT',
  'فواتير': 'UTILITIES',
  'صيانة': 'MAINTENANCE',
  'مواصلات': 'TRAVEL',
  'مستلزمات': 'SUPPLIES',
  'أخرى': 'OTHER',
});

const EXPENSE_CATEGORY_LABEL = Object.freeze({
  SALARIES: 'رواتب', MARKETING: 'تسويق', RENT: 'إيجار', SOFTWARE: 'برمجيات', EQUIPMENT: 'معدات',
  UTILITIES: 'فواتير', MAINTENANCE: 'صيانة', TRAVEL: 'مواصلات', SUPPLIES: 'مستلزمات', OTHER: 'أخرى',
});

const codeOf = key => String(key || '').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').slice(0, 40);

/** The settings' list as [{ code, label, active }], OTHER always present. */
function normaliseCategories(list) {
  const rows = (Array.isArray(list) && list.length ? list : DEFAULT_EXPENSE_CATEGORIES)
    .map(item => ({ code: codeOf(item?.key), label: String(item?.label || '').trim(), active: item?.is_active !== false }))
    .filter(item => item.code && item.label);
  if (!rows.some(item => item.code === 'OTHER')) rows.push({ code: 'OTHER', label: 'أخرى', active: true });
  return rows;
}

async function loadExpenseCategories(tenantId) {
  const { getTenantSetting } = require('./tenantSettings');
  const saved = await getTenantSetting('sys_expense_categories', { tenantId, fallback: null }).catch(() => null);
  return normaliseCategories(saved);
}

/** A label or a key, in either spelling, to the code that is stored; OTHER when unknown. */
function expenseCategory(value, categories = null) {
  const raw = String(value || 'OTHER').trim();
  if (categories) {
    const byLabel = categories.find(item => item.label === raw);
    if (byLabel) return byLabel.code;
    const code = codeOf(raw);
    if (categories.some(item => item.code === code)) return code;
  }
  const code = EXPENSE_CATEGORY_DB[raw] || codeOf(raw);
  return EXPENSE_CATEGORY_LABEL[code] ? code : 'OTHER';
}

/** The label a stored code reads as — the settings' first, then the built-in names. */
function expenseCategoryLabel(code, categories = null) {
  const key = String(code || 'OTHER').toUpperCase();
  return categories?.find(item => item.code === key)?.label || EXPENSE_CATEGORY_LABEL[key] || 'أخرى';
}

module.exports = {
  DEFAULT_EXPENSE_CATEGORIES, EXPENSE_CATEGORY_DB, EXPENSE_CATEGORY_LABEL,
  normaliseCategories, loadExpenseCategories, expenseCategory, expenseCategoryLabel,
};
