import React from 'react';
import { Briefcase, GraduationCap, Star, Stethoscope } from 'lucide-react';
import type { JoinUsApplication } from '../../../../types';

// What a join application is, said the same way on every screen that shows one.
//
// «في طلبات الانضمام في الموارد البشرية لازم تبقي عارف ان في طلبات انضمام موظف وفي
// محاضر لازم تفرق بيينهم بشكل كبير» (12 Oct 2026). A grey «محاضر» chip beside the
// status was the only difference between the two; now each kind has its own
// colour, used for the badge, the card's edge and the tab it lives under.

export type Status = 'new' | 'reviewed' | 'contacted' | 'accepted' | 'rejected';
export type Kind = 'instructor' | 'consultant' | 'staff';
export type Group = 'teaching' | 'staff';

export const STATUS: Record<Status, { label: string; className: string }> = {
  new: { label: 'جديد', className: 'bg-sky-600 text-white' },
  reviewed: { label: 'قيد المراجعة', className: 'bg-amber-100 text-amber-800' },
  contacted: { label: 'تم التواصل', className: 'bg-cyan-100 text-cyan-800' },
  accepted: { label: 'مقبول', className: 'bg-emerald-100 text-emerald-800' },
  rejected: { label: 'مرفوض', className: 'bg-rose-100 text-rose-700' },
};

export const STAGE_LABEL: Record<string, string> = {
  applied: 'لسه متقدّم', screening: 'فرز أولي', interview: 'في الانترفيو',
  offer: 'مقبول للتدريب', hired: 'اتعيّن', rejected: 'مرفوض في المسار',
};

export const KIND: Record<Kind, { label: string; badge: string; accent: string; soft: string; Icon: typeof Briefcase }> = {
  instructor: { label: 'محاضر', badge: 'bg-violet-600 text-white', accent: 'border-r-violet-500', soft: 'bg-violet-50 text-violet-800', Icon: GraduationCap },
  consultant: { label: 'استشاري', badge: 'bg-fuchsia-600 text-white', accent: 'border-r-fuchsia-500', soft: 'bg-fuchsia-50 text-fuchsia-800', Icon: Stethoscope },
  staff: { label: 'موظف', badge: 'bg-emerald-600 text-white', accent: 'border-r-emerald-500', soft: 'bg-emerald-50 text-emerald-800', Icon: Briefcase },
};

/** The quick tags on «تقييم أول مكالمة» — the API accepts these and no others. */
export const FIRST_CALL_TAGS = [
  'الصوت والأسلوب', 'الخبرة', 'الالتزام بالمواعيد', 'الحماس', 'المعرفة العلمية', 'التوقعات المادية مناسبة',
] as const;

export function statusOf(value?: string): Status {
  const status = String(value || '').toLowerCase();
  if (status === 'accepted' || status === 'rejected' || status === 'reviewed' || status === 'contacted') return status;
  if (['pending', 'in_progress', 'read'].includes(status)) return 'reviewed';
  if (['approved', 'done'].includes(status)) return 'accepted';
  return 'new';
}

/** From an applicant's type, with the form it came through deciding staff vs teaching. */
export function kindOfApplicant(type?: string | null, sourceForm?: string | null): Kind {
  if (sourceForm === 'staff') return 'staff';
  const kind = String(type || '').toLowerCase();
  if (['consultant', 'consultation', 'therapist', 'advisor'].includes(kind)) return 'consultant';
  if (sourceForm === 'teaching') return 'instructor';
  if (['staff', 'employee', 'hr', 'admin', 'ops', 'support'].includes(kind)) return 'staff';
  return 'instructor';
}

export const kindOf = (app: JoinUsApplication): Kind => kindOfApplicant(app.type, app.sourceForm);
export const groupOf = (app: JoinUsApplication): Group => (kindOf(app) === 'staff' ? 'staff' : 'teaching');

export const KindBadge: React.FC<{ kind: Kind; size?: 'sm' | 'md' }> = ({ kind, size = 'sm' }) => {
  const { label, badge, Icon } = KIND[kind];
  return (
    <span className={`inline-flex items-center gap-1 rounded-lg font-black ${badge} ${size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]'}`}>
      <Icon size={size === 'md' ? 13 : 11} /> {label}
    </span>
  );
};

/** A yes/no answer from the lecturer form; nothing when it was never asked. */
export const YesNoBadge: React.FC<{ label: string; value: boolean | number | null | undefined }> = ({ label, value }) => {
  if (value === null || value === undefined) return null;
  const yes = value === true || Number(value) === 1;
  return (
    <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${
      yes ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
      {label}: <span className="font-black">{yes ? 'آه' : 'لأ'}</span>
    </span>
  );
};

export const RatingStars: React.FC<{ value: number; size?: number }> = ({ value, size = 13 }) => (
  <span className="inline-flex items-center gap-0.5" aria-label={`${value} من 5`} dir="ltr">
    {[1, 2, 3, 4, 5].map(n => (
      <Star key={n} size={size} className={n <= value ? 'fill-amber-400 text-amber-400' : 'text-gray-300'} />
    ))}
  </span>
);
