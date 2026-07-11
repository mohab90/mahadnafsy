import type { StaffMember } from '../../../../types';

export type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

export type LeavesFilter = 'all' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface PerfRow {
  member: StaffMember;
  revenue: number;
  commission: number;
  converted: number;
  leadsCount: number;
  convRate: number;
  targetPct: number;
  targetHit: boolean;
  bonus: number;
}

export interface ManualEntry {
  staff_id: string;
  date: string;
  check_in: string;
  check_out: string;
  status: string;
  notes: string;
}

export interface LeaveForm {
  staff_id: string;
  type: string;
  start_date: string;
  end_date: string;
  reason: string;
}

export interface AttReport {
  workDays: number;
  staff: any[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export const ROLE_LABELS: Record<string, string> = {
  instructor: 'مدرب', trainer: 'مدرب', expert: 'خبير', sales: 'مبيعات',
  manager: 'مدير', admin: 'مسؤول', support: 'دعم فني', reception_daqqi: 'استقبال دقي',
  daqqi_manager: 'مدير دقي', collection: 'تحصيل', accountant: 'محاسب',
  consultant: 'مستشار', other: 'أخرى',
};
export const ROLE_COLORS: Record<string, string> = {
  manager: 'bg-purple-100 text-purple-700', admin: 'bg-gray-100 text-gray-700',
  sales: 'bg-blue-100 text-blue-700', support: 'bg-teal-100 text-teal-700',
  instructor: 'bg-indigo-100 text-indigo-700', trainer: 'bg-indigo-100 text-indigo-700',
  collection: 'bg-orange-100 text-orange-700', accountant: 'bg-amber-100 text-amber-700',
  reception_daqqi: 'bg-cyan-100 text-cyan-700', daqqi_manager: 'bg-cyan-100 text-cyan-700',
  consultant: 'bg-rose-100 text-rose-700', expert: 'bg-pink-100 text-pink-700',
  other: 'bg-gray-100 text-gray-700',
};
export const ABSENCE_LABELS: Record<string, string> = {
  absence: 'غياب', leave: 'إجازة', sick: 'مرضي', late: 'تأخير'
};
export const ABSENCE_COLORS: Record<string, string> = {
  absence: 'bg-red-100 text-red-700', leave: 'bg-blue-100 text-blue-700',
  sick: 'bg-amber-100 text-amber-700', late: 'bg-orange-100 text-orange-700'
};

export const LEAVE_TYPE_LABELS: Record<string, string> = {
  ANNUAL: 'إجازة سنوية', SICK: 'إجازة مرضية', UNPAID: 'إجازة بدون راتب',
  MATERNITY: 'إجازة أمومة', EMERGENCY: 'إجازة طارئة',
  PERMISSION: 'إذن', OTHER: 'أخرى',
};
export const LEAVE_TYPE_COLORS: Record<string, string> = {
  ANNUAL: 'bg-blue-100 text-blue-700', SICK: 'bg-amber-100 text-amber-700',
  UNPAID: 'bg-gray-100 text-gray-600', MATERNITY: 'bg-pink-100 text-pink-700',
  EMERGENCY: 'bg-red-100 text-red-700', PERMISSION: 'bg-cyan-100 text-cyan-700',
  OTHER: 'bg-gray-100 text-gray-600',
};
export const LEAVE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'معلق', APPROVED: 'موافق عليه', REJECTED: 'مرفوض', CANCELLED: 'ملغي',
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

export function getMonthsOfService(joinedAt: string) {
  const ms = Date.now() - new Date(joinedAt).getTime();
  const months = ms / (30.4 * 86400000);
  if (months < 1) return `${Math.round(ms / 86400000)} يوم`;
  if (months < 12) return `${Math.round(months)} شهر`;
  const y = Math.floor(months / 12); const m = Math.round(months % 12);
  return m > 0 ? `${y} سنة ${m} شهر` : `${y} سنة`;
}
export const fmt = (n: number) => n.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 0 });
export const fmtMoney = (n: number) => `${fmt(n)} ج.م`;
