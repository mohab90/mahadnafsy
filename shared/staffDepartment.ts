// The department an employee sits in, for the screens (the same table as api/lib/staffDepartment.js, which the month sheet's server side reads). 3 Nov 2026:
// «اظهرهم طبقا للقسم بتاعهم: المبيعات مع بعض وبعدها التحصيل وبعدهم الدقي وبعدهم الأقسام الإدارية وخدمة العملاء وغيرها» — the directory and the month sheet list
// the departments in this order, and the lecturers (paid by the lecture, not by the month) are kept out of the staff directory.

const BY_ROLE: Record<string, string> = {
  daqqi_manager: 'الدقي', reception_daqqi: 'الدقي',
  tagamoa_manager: 'التجمع', reception_tagamoa: 'التجمع',
  sales: 'المبيعات', sales_collection_manager: 'المبيعات',
  collection: 'التحصيل أونلاين', online_manager: 'التحصيل أونلاين',
  support: 'خدمة العملاء', hr: 'الموارد البشرية', accountant: 'الحسابات',
  admin: 'الإدارة', manager: 'الإدارة',
  consultant: 'المستشارون والمحاضرون', expert: 'المستشارون والمحاضرون', trainer: 'المستشارون والمحاضرون', instructor: 'المستشارون والمحاضرون',
};

/** Sales, collection, the branches, the administrative departments, customer service; anything else follows by name. */
export const DEPARTMENT_ORDER = ['المبيعات', 'التحصيل أونلاين', 'الدقي', 'التجمع', 'الإدارة', 'الموارد البشرية', 'الحسابات', 'خدمة العملاء'];

/** Roles whose pay is by the lecture, hour or consultation: they have their own tab and are not in the staff directory. */
const LECTURER_ROLES = new Set(['instructor', 'trainer', 'expert', 'consultant']);
export const isLecturerRole = (role?: string | null) => LECTURER_ROLES.has(String(role || '').toLowerCase());

export const departmentOfRole = (role?: string | null) => BY_ROLE[String(role || '').toLowerCase()] || 'أخرى';

/** Where a department sits in the list: its place in DEPARTMENT_ORDER, then the unlisted ones. */
export const departmentRank = (name: string) => {
  const at = DEPARTMENT_ORDER.indexOf(name);
  return at === -1 ? DEPARTMENT_ORDER.length : at;
};
