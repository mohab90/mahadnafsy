// Labels and colours for the HR screens.
//
// Lifted out of HRTab.tsx, which was 1,027 lines before the unbuilt
// staff-detail feature came out of it. Pure data with no behaviour, and every
// panel the file still needs splitting into reads some of it — extracting it
// first means those panels can move one at a time without each dragging a
// copy along.
//
// Arabic labels and Tailwind classes are kept in the same file on purpose: a
// status that gains a label almost always needs a colour in the same change,
// and separating them is how the two drift apart.

export const ROLE_LABELS: Record<string, string> = {
  instructor: 'مدرب', trainer: 'مدرب', expert: 'خبير', sales: 'مبيعات',
  manager: 'مدير', admin: 'مسؤول', support: 'دعم فني', reception_daqqi: 'استقبال دقي',
  daqqi_manager: 'مدير دقي', collection: 'تحصيل', accountant: 'محاسب',
  consultant: 'مستشار', other: 'أخرى',
  // staff.role has sixteen members; these three had no label, so the online
  // manager — a role the dashboard branches on all over — showed as an empty
  // pill on the performance table and as raw English in the directory.
  online_manager: 'مدير أونلاين', sales_collection_manager: 'مدير مبيعات وتحصيل', hr: 'موارد بشرية',
};
export const ROLE_COLORS: Record<string, string> = {
  manager: 'bg-purple-100 text-purple-700', admin: 'bg-gray-100 text-gray-700',
  sales: 'bg-blue-100 text-blue-700', support: 'bg-teal-100 text-teal-700',
  instructor: 'bg-indigo-100 text-indigo-700', trainer: 'bg-indigo-100 text-indigo-700',
  collection: 'bg-orange-100 text-orange-700', accountant: 'bg-amber-100 text-amber-700',
  reception_daqqi: 'bg-cyan-100 text-cyan-700', daqqi_manager: 'bg-cyan-100 text-cyan-700',
  consultant: 'bg-rose-100 text-rose-700', expert: 'bg-pink-100 text-pink-700',
  online_manager: 'bg-violet-100 text-violet-700',
  sales_collection_manager: 'bg-sky-100 text-sky-700', hr: 'bg-lime-100 text-lime-700',
  other: 'bg-gray-100 text-gray-700',
};
// The HR list and the employee's own page read these, so a request is called
// the same thing on both sides. LATE_PERMIT and EARLY_LEAVE had no label here:
// HR's inbox showed the raw enum for every permission an employee asked for.
export const LEAVE_TYPE_LABELS: Record<string, string> = {
  ANNUAL: 'إجازة سنوية', SICK: 'إجازة مرضية', UNPAID: 'إجازة بدون راتب',
  MATERNITY: 'إجازة أمومة', EMERGENCY: 'إجازة طارئة',
  PERMISSION: 'إذن نصف يوم', OTHER: 'أخرى',
  LATE_PERMIT: 'إذن صباحي (تأخير)', EARLY_LEAVE: 'إذن مسائي (انصراف مبكر)',
};
export const LEAVE_TYPE_COLORS: Record<string, string> = {
  ANNUAL: 'bg-blue-100 text-blue-700', SICK: 'bg-amber-100 text-amber-700',
  UNPAID: 'bg-gray-100 text-gray-600', MATERNITY: 'bg-pink-100 text-pink-700',
  EMERGENCY: 'bg-red-100 text-red-700', PERMISSION: 'bg-cyan-100 text-cyan-700',
  OTHER: 'bg-gray-100 text-gray-600',
  LATE_PERMIT: 'bg-sky-100 text-sky-700', EARLY_LEAVE: 'bg-violet-100 text-violet-700',
};
/** The two permissions asked for in hours, not days. */
export const HOUR_PERMIT_TYPES = ['LATE_PERMIT', 'EARLY_LEAVE'];
export const LEAVE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'معلق', APPROVED: 'موافق عليه', REJECTED: 'مرفوض', CANCELLED: 'ملغي',
};
export const ADVANCE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'بانتظار الموارد البشرية', APPROVED: 'معتمدة — بانتظار الصرف', DISBURSED: 'اتصرفت — بتتخصم',
  DEDUCTED: 'اتخصمت', REJECTED: 'مرفوضة',
};
export const ADVANCE_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700', APPROVED: 'bg-sky-100 text-sky-700', DISBURSED: 'bg-indigo-100 text-indigo-700',
  DEDUCTED: 'bg-emerald-100 text-emerald-700', REJECTED: 'bg-red-100 text-red-700',
};
export const LEAVE_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700', APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700', CANCELLED: 'bg-gray-100 text-gray-500',
};
export const PAYROLL_STATUS_LABELS: Record<string, string> = {
  CALCULATED: 'محسوب', APPROVED: 'معتمد', PAID: 'مدفوع', CANCELLED: 'ملغي',
};
export const PAYROLL_STATUS_COLORS: Record<string, string> = {
  CALCULATED: 'bg-blue-100 text-blue-700', APPROVED: 'bg-emerald-100 text-emerald-700',
  PAID: 'bg-green-100 text-green-800', CANCELLED: 'bg-gray-100 text-gray-500',
};
