/**
 * Pure constants + helpers extracted from UnifiedClientPage.tsx.
 * No component state — safe to share/test in isolation.
 */
import React from 'react';
import { CourseAccessSetting, ExtraCertificateType } from '../types';

export const branchLabels: Record<string, string> = {
  DAQQI: 'فرع الدقي',
  TAGAMOA: 'فرع التجمع',
  ONLINE_EGYPT: 'أونلاين محلي (مصر)',
  ONLINE_SAUDI: 'أونلاين سعودي',
  ONLINE_ABROAD: 'أونلاين دولي',
  OTHER: 'أخرى',
};

export const normBranchKey = (v?: string | null) => (v || '').toUpperCase().replace(/[-\s]/g, '_');

export const commTypeMeta: Record<string, { label: string; color: string; icon: string }> = {
  call:             { label: 'اتصال هاتفي',   color: 'bg-blue-100 text-blue-700',       icon: '📞' },
  whatsapp:         { label: 'واتس أب',         color: 'bg-green-100 text-green-700',     icon: '💬' },
  email:            { label: 'بريد إلكتروني',  color: 'bg-purple-100 text-purple-700',   icon: '📧' },
  meeting:          { label: 'لقاء شخصي',      color: 'bg-orange-100 text-orange-700',   icon: '🤝' },
  note:             { label: 'ملاحظة',          color: 'bg-gray-100 text-gray-700',       icon: '📝' },
  payment_followup: { label: 'متابعة أقساط',   color: 'bg-emerald-100 text-emerald-700', icon: '💰' },
  new_course_sale:  { label: 'بيع كورس جديد',  color: 'bg-indigo-100 text-indigo-700',   icon: '🎓' },
  certificate:      { label: 'شهادة',           color: 'bg-amber-100 text-amber-700',     icon: '🏆' },
};

export const ptLabels: Record<string, string> = {
  course: 'كورس', certificate: 'شهادة', consultation: 'استشارة',
  book: 'كتاب', carneh: 'كارنيه', other: 'أخرى',
};

export const statusColors: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-amber-100 text-amber-700',
  interested: 'bg-green-100 text-green-700',
  not_interested: 'bg-red-100 text-red-600',
  no_answer: 'bg-gray-100 text-gray-500',
  closed: 'bg-gray-200 text-gray-700',
  converted: 'bg-emerald-100 text-emerald-700',
};

export const statusLabels: Record<string, string> = {
  new: 'جديد', contacted: 'تم التواصل', interested: 'مهتم',
  not_interested: 'غير مهتم', no_answer: 'لا يرد',
  closed: 'مغلق', converted: 'تحول لمشترك',
};

export const EXTRA_TYPE_LABELS: Record<ExtraCertificateType, string> = {
  social_solidarity: 'شهادة التضامن الاجتماعي',
  ain_shams: 'شهادة جامعة عين شمس',
  experience_external: 'شهادة الخبرة بتوثيق الخارجية',
  practice_external: 'شهادة التطبيقين بالخارجية',
  national_council: 'شهادة المجلس الوطني',
  american_board: 'شهادة البورد الأمريكي',
  institute: 'شهادة المعهد',
  other: 'شهادة أخرى',
};

export const normalizeAccess = (entry?: CourseAccessSetting | 'preview' | 'full'): CourseAccessSetting => {
  if (entry === 'full') return { mode: 'full' };
  if (entry === 'preview') return { mode: 'preview' };
  if (!entry) return { mode: 'preview' };
  if ((entry as CourseAccessSetting).mode === 'limited') {
    const lim = Number((entry as CourseAccessSetting).lectureLimit || 1);
    return { mode: 'limited', lectureLimit: Number.isFinite(lim) && lim > 0 ? Math.floor(lim) : 1 };
  }
  return { mode: (entry as CourseAccessSetting).mode };
};

export const generatePromoCode = (name: string): string => {
  const prefix = name.trim().split(' ')[0].slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/gi, '') || 'VIP';
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}${suffix}`;
};

export const SideRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
    <span className="text-gray-400 text-xs">{label}</span>
    <span className="font-medium text-gray-800 text-xs text-left">{value}</span>
  </div>
);
