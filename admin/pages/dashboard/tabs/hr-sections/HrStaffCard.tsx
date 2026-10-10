// «طور كارت الموظف خليه يظهر اي تفاصيل عنه اقوى من كدا»: the directory card
// carries what HR looks a person up for — how to reach them, where and since
// when they work, their fingerprint number and pay, this month's attendance —
// before opening the full file.
import { CalendarDays, ChevronLeft, Fingerprint, Mail, MapPin, Pencil, Phone, Wallet } from 'lucide-react';
import type { StaffMember } from '../../../../types';
import { BRANCH_LABELS_AR, normalizeBranch } from '../../../../constants/branches';
import { ROLE_LABELS, ROLE_COLORS } from './hrLabels';
import { fmtMoney } from './hrFormat';

export type StaffBasics = { id: string; branchId?: string | null; baseSalary?: number | null; biometricNo?: string };
export type StaffMonth = {
  id: string; department_name?: string | null; present_days?: number; absent_days?: number;
  late_days?: number; leave_days?: number; deduction_days?: number | string;
};
type Performance = { revenue?: number; leads_count?: number; target_pct?: number };

const n = (value: unknown) => (Number(value) || 0).toLocaleString('ar-EG-u-nu-latn');
const branchLabel = (branchId?: string | null) => {
  const key = normalizeBranch(String(branchId || '').replace(/^branch-/, ''));
  return key ? BRANCH_LABELS_AR[key] : null;
};
const digits = (phone: string) => phone.replace(/\D/g, '');
const whatsappOf = (phone: string) => {
  const d = digits(phone);
  return d.startsWith('0') && d.length === 11 ? `20${d.slice(1)}` : d;
};

function serviceLength(joinedAt: string) {
  const ms = Date.now() - new Date(joinedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const months = ms / (30.4 * 86400000);
  if (months < 1) return `${Math.round(ms / 86400000)} يوم`;
  if (months < 12) return `${Math.round(months)} شهر`;
  const y = Math.floor(months / 12); const m = Math.round(months % 12);
  return m > 0 ? `${y} سنة و${m} شهر` : `${y} سنة`;
}

export default function HrStaffCard({ member, basics, month, performance, showPay, onOpen, onEdit }: {
  member: StaffMember;
  basics?: StaffBasics;
  month?: StaffMonth;
  performance?: Performance;
  showPay: boolean;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const active = member.status === 'active';
  const branch = branchLabel(basics?.branchId);
  const service = member.joinedAt ? serviceLength(member.joinedAt) : null;
  const target = member.monthlyTarget || 0;
  const targetType = member.monthlyTargetType || 'egp';
  const targetPct = performance?.target_pct || 0;
  const revenue = performance?.revenue || 0;
  const salary = basics?.baseSalary ?? member.salary ?? null;

  return (
    <article className={`flex flex-col overflow-hidden rounded-2xl border bg-white transition-shadow hover:shadow-lg hover:shadow-slate-200/60 ${active ? 'border-gray-200' : 'border-amber-200'}`}>
      <header className="flex items-start gap-3 p-4 pb-3">
        {member.image ? (
          <img src={member.image} alt="" className={`h-12 w-12 shrink-0 rounded-full object-cover ring-2 ${active ? 'ring-emerald-200' : 'ring-gray-200 grayscale'}`} />
        ) : (
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-black text-white ring-2 ${active ? 'bg-slate-600 ring-emerald-200' : 'bg-gray-400 ring-gray-200'}`}>{member.name.charAt(0)}</span>
        )}
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="block w-full truncate text-right font-extrabold text-gray-900 hover:text-indigo-700">{member.name}</button>
          <p className="truncate text-xs text-gray-500">{[member.specialization, member.department || month?.department_name].filter(Boolean).join(' · ') || ' '}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ROLE_COLORS[member.role] || 'bg-gray-100 text-gray-600'}`}>{ROLE_LABELS[member.role] || member.role}</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-amber-500'}`} />{active ? 'نشط' : 'غير نشط'}
            </span>
          </div>
        </div>
        <button type="button" onClick={onEdit} title="تعديل بيانات الموظف" aria-label={`تعديل بيانات ${member.name}`}
          className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-slate-100 hover:text-slate-700"><Pencil size={14} /></button>
      </header>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-gray-100 px-4 py-3 text-xs">
        <div className="col-span-2 flex min-w-0 items-center gap-1.5 text-gray-700">
          <Phone size={12} className="shrink-0 text-gray-400" />
          {member.phone ? (
            <>
              <span dir="ltr" className="select-all tabular-nums">{member.phone}</span>
              <a href={`https://wa.me/${whatsappOf(member.phone)}`} target="_blank" rel="noreferrer" className="mr-auto rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100">واتساب</a>
            </>
          ) : <span className="text-gray-400">بدون موبايل</span>}
        </div>
        <div className="col-span-2 flex min-w-0 items-center gap-1.5 text-gray-700">
          <Mail size={12} className="shrink-0 text-gray-400" />
          <span dir="ltr" className="truncate">{member.email || '—'}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-gray-700"><MapPin size={12} className="shrink-0 text-gray-400" /><span className="truncate">{branch || 'بدون فرع'}</span></div>
        <div className="flex min-w-0 items-center gap-1.5 text-gray-700">
          <Fingerprint size={12} className="shrink-0 text-gray-400" />
          {basics?.biometricNo ? <span className="tabular-nums">بصمة #{basics.biometricNo}</span> : <span className="text-amber-600">بدون رقم بصمة</span>}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-gray-700">
          <CalendarDays size={12} className="shrink-0 text-gray-400" />
          {member.joinedAt ? <span className="truncate" title={member.joinedAt.slice(0, 10)}>من {member.joinedAt.slice(0, 10)}{service ? ` · ${service}` : ''}</span> : <span className="text-amber-600">بدون تاريخ تعيين</span>}
        </div>
        {showPay && (
          <div className="flex min-w-0 items-center gap-1.5 text-gray-700">
            <Wallet size={12} className="shrink-0 text-gray-400" />
            {salary ? <span className="tabular-nums">{fmtMoney(salary)}</span> : <span className="text-amber-600">بدون مرتب أساسي</span>}
          </div>
        )}
      </dl>

      {month && (
        <div className="grid grid-cols-4 gap-1 px-4 pb-3 text-center">
          {[
            ['حضور', month.present_days, 'text-emerald-700 bg-emerald-50'],
            ['غياب', month.absent_days, Number(month.absent_days) ? 'text-red-700 bg-red-50' : 'text-gray-400 bg-gray-50'],
            ['تأخير', month.late_days, Number(month.late_days) ? 'text-amber-700 bg-amber-50' : 'text-gray-400 bg-gray-50'],
            ['إجازة', month.leave_days, 'text-sky-700 bg-sky-50'],
          ].map(([label, value, tone]) => (
            <div key={label as string} className={`rounded-lg px-1 py-1.5 ${tone}`}>
              <div className="text-sm font-black tabular-nums">{n(value)}</div>
              <div className="text-[10px]">{label as string}</div>
            </div>
          ))}
        </div>
      )}

      {target > 0 && (
        <div className="px-4 pb-3">
          <div className="mb-1 flex items-baseline justify-between text-[10px]">
            <span className="text-gray-400">تارجت الشهر</span>
            <span className="font-bold tabular-nums text-gray-600">
              {targetType === 'clients' ? `${target} عميل` : targetType === 'bookings' ? `${target} حجز` : fmtMoney(target)}
              <span className={`mr-1 ${targetPct >= 100 ? 'text-emerald-600' : 'text-gray-400'}`}>· {Math.round(targetPct)}%</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div className={`h-full rounded-full ${targetPct >= 100 ? 'bg-emerald-500' : 'bg-slate-500'}`} style={{ width: `${Math.min(targetPct, 100)}%` }} />
          </div>
        </div>
      )}

      <footer className="mt-auto flex items-center justify-between gap-2 border-t border-gray-100 bg-gray-50/70 px-4 py-2 text-[11px] text-gray-500">
        <span>ليدات الشهر <b className="tabular-nums text-gray-700">{n(performance?.leads_count)}</b></span>
        <span>مبيعات <b className={`tabular-nums ${revenue > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>{revenue > 0 ? fmtMoney(revenue) : '—'}</b></span>
        <button type="button" onClick={onOpen} className="flex items-center gap-0.5 font-bold text-indigo-600 hover:text-indigo-800">الملف <ChevronLeft size={12} /></button>
      </footer>
    </article>
  );
}
