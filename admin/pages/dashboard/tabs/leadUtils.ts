import type { LeadItem, LeadStatus } from '../../../types';

export function getRottenLevel(lead: LeadItem): 0 | 1 | 2 | 3 {
  if (['converted', 'lost', 'not_interested', 'not_interested_hidden', 'wrong_number'].includes(lead.status)) return 0;
  const comms = lead.communications || [];
  const lastComm = comms.length
    ? [...comms].sort((a, b) => b.date.localeCompare(a.date))[0]
    : null;
  const refDate = lastComm ? lastComm.date.slice(0, 10) : (lead.createdAt ? lead.createdAt.slice(0, 10) : null);
  if (!refDate) return 0;
  const days = Math.floor((Date.now() - new Date(refDate).getTime()) / 86_400_000);
  if (days >= 14) return 3;
  if (days >= 7) return 2;
  if (days >= 3) return 1;
  return 0;
}

export const ROTTEN_CFG: { label: string; bar: string; badge: string; row: string }[] = [
  { label: '', bar: '', badge: '', row: '' },
  { label: '3+ أيام', bar: 'bg-yellow-400', badge: 'bg-yellow-100 text-yellow-800 border-yellow-300', row: 'border-r-[3px] border-r-yellow-400' },
  { label: 'أسبوع+', bar: 'bg-orange-500', badge: 'bg-orange-100 text-orange-800 border-orange-300', row: 'border-r-[3px] border-r-orange-500' },
  { label: 'فاسد', bar: 'bg-red-500', badge: 'bg-red-100 text-red-800 border-red-300', row: 'border-r-[3px] border-r-red-500' },
];

// IMPORTANT: Keep this in sync with calcLeadScoreServer() in api/server.js.
export function calcLeadScore(lead: LeadItem): number {
  let score = 0;
  const statusScore: Partial<Record<LeadStatus, number>> = {
    new: 5, contacted: 15, interested: 35, interested_booking: 35, interested_followup: 35,
    postpone_month: 10, no_answer: 8, no_answer_wa: 8, no_answer_nowa: 8,
    wrong_number: 0, with_colleague: 10,
    not_interested: 0, not_interested_hidden: 0,
    closed: 50, converted: 100, lost: 0, other: 2,
  };
  score += statusScore[lead.status] ?? 0;
  if (lead.interestLevel === 'high') score += 30;
  else if (lead.interestLevel === 'medium') score += 15;
  else score += 5;
  score += Math.min((lead.communications?.length || 0) * 5, 25);
  if (lead.nextFollowUpDate) score += 5;
  if ((lead.interestedCourseIds?.length || 0) > 0) score += 10;

  const terminalStatuses: LeadStatus[] = ['converted', 'lost', 'not_interested', 'not_interested_hidden', 'wrong_number'];
  if (!terminalStatuses.includes(lead.status)) {
    const now = Date.now();
    const comms = lead.communications ?? [];
    const lastContactMs = comms.length
      ? Math.max(...comms.map(c => new Date(c.date?.slice(0, 10) ?? '').getTime()).filter(n => !isNaN(n)))
      : NaN;
    if (!isNaN(lastContactMs)) {
      const daysSinceContact = Math.floor((now - lastContactMs) / 86400000);
      if (daysSinceContact > 7) score -= Math.min((daysSinceContact - 7) * 2, 30);
    } else if (lead.createdAt) {
      const daysSinceCreated = Math.floor((now - new Date(lead.createdAt.replace(/\//g, '-').replace(' ', 'T')).getTime()) / 86400000);
      if (daysSinceCreated > 14) score -= Math.min((daysSinceCreated - 14) * 1, 20);
    }
  }

  return Math.min(Math.max(score, 0), 100);
}

export const STATUS_CFG: Record<LeadStatus, { label: string; color: string; colColor: string }> = {
  new: { label: 'جديد', color: 'bg-blue-100 text-blue-800 border-blue-200', colColor: 'border-t-blue-500' },
  contacted: { label: 'تم التواصل', color: 'bg-yellow-100 text-yellow-800 border-yellow-200', colColor: 'border-t-yellow-500' },
  interested: { label: 'مهتم', color: 'bg-emerald-100 text-emerald-800 border-emerald-200', colColor: 'border-t-emerald-500' },
  interested_booking: { label: 'مهتم بالحجز', color: 'bg-teal-100 text-teal-800 border-teal-200', colColor: 'border-t-teal-500' },
  interested_followup: { label: 'مهتم ومتابعة', color: 'bg-cyan-100 text-cyan-800 border-cyan-200', colColor: 'border-t-cyan-500' },
  postpone_month: { label: 'هيأجل أكثر من شهر', color: 'bg-orange-100 text-orange-800 border-orange-200', colColor: 'border-t-orange-500' },
  no_answer: { label: 'لا يرد', color: 'bg-gray-100 text-gray-700 border-gray-200', colColor: 'border-t-gray-400' },
  no_answer_wa: { label: 'لا يرد / واتس أرسل', color: 'bg-slate-100 text-slate-700 border-slate-200', colColor: 'border-t-slate-400' },
  no_answer_nowa: { label: 'لا يرد / مفيش واتس', color: 'bg-slate-200 text-slate-700 border-slate-300', colColor: 'border-t-slate-500' },
  wrong_number: { label: 'الرقم غلط / مقفول', color: 'bg-zinc-100 text-zinc-700 border-zinc-200', colColor: 'border-t-zinc-400' },
  with_colleague: { label: 'مع زميل آخر', color: 'bg-indigo-100 text-indigo-700 border-indigo-200', colColor: 'border-t-indigo-400' },
  not_interested: { label: 'غير مهتم', color: 'bg-red-100 text-red-700 border-red-200', colColor: 'border-t-red-400' },
  not_interested_hidden: { label: 'غير مهتم / مخفي', color: 'bg-rose-100 text-rose-700 border-rose-200', colColor: 'border-t-rose-400' },
  closed: { label: 'مغلق', color: 'bg-violet-100 text-violet-700 border-violet-200', colColor: 'border-t-violet-500' },
  converted: { label: 'تحول لمشترك', color: 'bg-green-100 text-green-800 border-green-200', colColor: 'border-t-green-500' },
  lost: { label: 'مفقود', color: 'bg-red-50 text-red-400 border-red-100', colColor: 'border-t-red-300' },
  other: { label: 'أخرى', color: 'bg-gray-50 text-gray-500 border-gray-100', colColor: 'border-t-gray-300' },
};

export const PIPELINE_COLS: LeadStatus[] = [
  'new',
  'interested_booking',
  'interested_followup',
  'no_answer_wa',
  'no_answer_nowa',
  'not_interested',
];

export const IL_LABEL: Record<string, string> = {
  high: 'عالي',
  medium: 'متوسط',
  low: 'منخفض',
};

export const BRANCH_ENUM_LABELS: Record<string, string> = {
  DAQQI: 'الدقي',
  TAGAMOA: 'التجمع',
  ONLINE_EGYPT: 'أونلاين - مصر',
  ONLINE_SAUDI: 'أونلاين - السعودية',
  ONLINE_ABROAD: 'أونلاين - خارج مصر',
  OTHER: 'أخرى',
};

export const PIE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316'];

export const PRESET_TAGS = ['VIP', 'اهتمام قوي', 'مرجأ', 'متابعة عاجلة', 'دفع جزئي', 'ضعيف الاهتمام', 'طالب', 'خارج مصر'];

export function getScoreBreakdown(lead: LeadItem) {
  const statusScore: Partial<Record<LeadStatus, number>> = {
    new: 5, contacted: 15, interested: 35, no_answer: 8, not_interested: 0, closed: 50, converted: 100, lost: 0,
  };
  const ilScore = lead.interestLevel === 'high' ? 30 : lead.interestLevel === 'medium' ? 15 : 5;
  const commScore = Math.min((lead.communications?.length || 0) * 5, 25);
  return [
    { label: 'حالة الليد', pts: statusScore[lead.status] ?? 0, max: 50 },
    { label: 'مستوى الاهتمام', pts: ilScore, max: 30, tip: lead.interestLevel !== 'high' ? `ارفعه لعالي +${30 - ilScore}` : '' },
    { label: 'تواصلات', pts: commScore, max: 25, tip: commScore < 25 ? `سجل تواصل إضافي +${25 - commScore}` : '' },
    { label: 'موعد متابعة', pts: lead.nextFollowUpDate ? 5 : 0, max: 5, tip: !lead.nextFollowUpDate ? 'أضف موعد +5' : '' },
    { label: 'كورسات مهتم بها', pts: (lead.interestedCourseIds?.length || 0) > 0 ? 10 : 0, max: 10, tip: !(lead.interestedCourseIds?.length) ? 'أضف كورس +10' : '' },
  ];
}

export const COMM_ICON: Record<string, string> = {
  call: 'هاتف',
  whatsapp: 'واتساب',
  email: 'إيميل',
  meeting: 'اجتماع',
  note: 'ملاحظة',
  payment_followup: 'متابعة دفع',
  new_course_sale: 'بيع كورس',
  certificate: 'شهادة',
};

export const COMM_LABEL: Record<string, string> = {
  call: 'مكالمة',
  whatsapp: 'واتساب',
  email: 'إيميل',
  meeting: 'اجتماع',
  note: 'ملاحظة',
  payment_followup: 'متابعة دفع',
  new_course_sale: 'بيع كورس',
  certificate: 'شهادة',
};

export function getLeadBranchRaw(lead: LeadItem): string {
  if (lead.branch) return lead.branch;
  if (lead.rawBranch) return lead.rawBranch;
  if (lead.notes) {
    const m = /الفرع:\s*([^|]+)/.exec(lead.notes);
    if (m) return m[1].trim();
  }
  return '';
}
