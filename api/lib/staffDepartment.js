'use strict';

// «القسم فاضي ليه؟ … أقسام الدقي لوحدهم والمبيعات لوحدهم والتحصيل أونلاين لوحدهم» (3 Nov 2026): nobody had filled hr_departments in, so the month sheet's department
// column was empty. A department HR named wins; with none, the employee's job says where they sit.

const BY_ROLE = Object.freeze({
  daqqi_manager: 'الدقي', reception_daqqi: 'الدقي',
  tagamoa_manager: 'التجمع', reception_tagamoa: 'التجمع',
  sales: 'المبيعات', sales_collection_manager: 'المبيعات',
  collection: 'التحصيل أونلاين', online_manager: 'التحصيل أونلاين',
  support: 'الدعم الفني', hr: 'الموارد البشرية', accountant: 'الحسابات',
  admin: 'الإدارة', manager: 'الإدارة',
  consultant: 'المستشارون والمحاضرون', expert: 'المستشارون والمحاضرون', trainer: 'المستشارون والمحاضرون', instructor: 'المستشارون والمحاضرون',
});

/** The order the month sheet lists its departments in; the rest follow alphabetically. */
const DEPARTMENT_ORDER = Object.freeze(['الدقي', 'التجمع', 'المبيعات', 'التحصيل أونلاين', 'الدعم الفني', 'الموارد البشرية', 'الحسابات', 'الإدارة']);

/** The department an employee sits in: the one HR named, else the one their job says, else «أخرى». */
function departmentOf({ departmentName = null, role = null } = {}) {
  const named = String(departmentName || '').trim();
  if (named) return named;
  return BY_ROLE[String(role || '').toLowerCase()] || 'أخرى';
}

module.exports = { BY_ROLE, DEPARTMENT_ORDER, departmentOf };
