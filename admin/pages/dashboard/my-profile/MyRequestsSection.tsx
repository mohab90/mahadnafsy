import { useMemo, useState } from 'react';
import { Banknote, CalendarDays, Clock3, Hourglass, Sunrise, Sunset, XCircle } from 'lucide-react';
import { Modal } from '../../../../shared/ui/Modal';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';
import { cairoDateOnly, cairoDay } from '../../../../shared/cairoDate';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import {
  ADVANCE_STATUS_COLORS, ADVANCE_STATUS_LABELS, HOUR_PERMIT_TYPES,
  LEAVE_STATUS_COLORS, LEAVE_STATUS_LABELS, LEAVE_TYPE_LABELS,
} from '../tabs/hr-sections/hrLabels';
import type { MyAdvance, MyHrSnapshot, MyLeave } from './useMyHr';

type Notify = (kind: 'success' | 'error' | 'warning' | 'info', message: string) => void;
type Kind = 'leave' | 'LATE_PERMIT' | 'EARLY_LEAVE' | 'advance';

// What each card asks for. A morning permission is arriving late, an evening
// one is leaving early — «اذن تاخير صباحي او مسائي».
const KINDS: { key: Kind; title: string; hint: string; icon: typeof Sunrise; tone: string }[] = [
  { key: 'leave', title: 'طلب إجازة', hint: 'سنوية، مرضية، طارئة…', icon: CalendarDays, tone: 'from-blue-500 to-indigo-600' },
  { key: 'LATE_PERMIT', title: 'إذن صباحي', hint: 'هتوصل متأخر', icon: Sunrise, tone: 'from-amber-400 to-orange-500' },
  { key: 'EARLY_LEAVE', title: 'إذن مسائي', hint: 'هتمشي بدري', icon: Sunset, tone: 'from-violet-500 to-fuchsia-600' },
  { key: 'advance', title: 'طلب سلفة', hint: 'تتخصم من المرتب', icon: Banknote, tone: 'from-emerald-500 to-teal-600' },
];
const LEAVE_KINDS = ['ANNUAL', 'SICK', 'EMERGENCY', 'UNPAID', 'PERMISSION', 'MATERNITY', 'OTHER'];

type Draft = { type: string; startDate: string; endDate: string; startTime: string; endTime: string; amount: string; reason: string };
const emptyDraft = (kind: Kind): Draft => {
  const today = cairoDateOnly();
  return {
    type: kind === 'leave' ? 'ANNUAL' : kind, startDate: today, endDate: today,
    startTime: kind === 'EARLY_LEAVE' ? '15:00' : '09:00', endTime: kind === 'EARLY_LEAVE' ? '17:00' : '11:00',
    amount: '', reason: '',
  };
};

type Row = {
  id: string; kind: 'leave' | 'advance'; title: string; when: string; status: string;
  statusLabel: string; statusTone: string; reason: string | null; answer: string | null; createdAt: string;
};

const money = (value: number, currency: string) => `${Number(value || 0).toLocaleString('ar-EG-u-nu-latn')} ${currency === 'EGP' ? 'ج.م' : currency}`;

/**
 * طلباتي — leave, the two permissions and an advance, from one place, and
 * everything asked for so far with where it stands.
 *
 * All four go to the HR inbox (الموارد البشرية ← طلبات الموظفين), which the
 * administration sees too. The leave form used to live twice — once in the
 * profile panel with six of the nine types, once in ملفي الوظيفي with all nine
 * — and neither could say what time a permission was for.
 */
export function MyRequestsSection({ hr, leaves, advances, reload, notify }: {
  hr: MyHrSnapshot | null;
  leaves: MyLeave[];
  advances: MyAdvance[];
  reload: () => Promise<void>;
  notify: Notify;
}) {
  const [open, setOpen] = useState<Kind | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft('leave'));
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'PENDING'>('all');

  const start = (kind: Kind) => { setDraft(emptyDraft(kind)); setOpen(kind); };
  const isPermit = HOUR_PERMIT_TYPES.includes(draft.type);

  const submit = async () => {
    if (!open) return;
    setSaving(true);
    try {
      const response = open === 'advance'
        ? await fetch('/api/staff/me/advances', {
          method: 'POST', credentials: 'include', headers: adminAuthHeaders(true),
          body: JSON.stringify({ amount: Number(draft.amount), currency: 'EGP', reason: draft.reason }),
        })
        : await fetch('/api/staff/me/leaves', {
          method: 'POST', credentials: 'include', headers: adminAuthHeaders(true),
          body: JSON.stringify({
            type: draft.type,
            start_date: draft.startDate,
            // A permission is part of one day; the form only asks for the one.
            end_date: isPermit || draft.type === 'PERMISSION' ? draft.startDate : draft.endDate,
            start_time: isPermit ? draft.startTime : undefined,
            end_time: isPermit ? draft.endTime : undefined,
            reason: draft.reason,
          }),
        });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'تعذر إرسال الطلب');
      notify('success', 'اتبعت طلبك للموارد البشرية ✅');
      setOpen(null);
      await reload();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر إرسال الطلب');
    } finally { setSaving(false); }
  };

  const cancel = async (leave: MyLeave) => {
    if (!await confirmDialog('تسحب الطلب ده؟ هيتشال من صندوق الموارد البشرية.')) return;
    const response = await fetch(`/api/staff/me/leaves/${encodeURIComponent(leave.id)}/cancel`, {
      method: 'PUT', credentials: 'include', headers: adminAuthHeaders(true),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { notify('error', payload.error || 'تعذر سحب الطلب'); return; }
    notify('success', 'اتسحب الطلب');
    await reload();
  };

  const rows = useMemo<Row[]>(() => [
    ...leaves.map(leave => ({
      id: leave.id, kind: 'leave' as const,
      title: LEAVE_TYPE_LABELS[leave.type] || leave.type,
      when: leave.start_time
        ? `${cairoDay(leave.start_date)} · من ${leave.start_time} لـ ${leave.end_time}`
        : cairoDay(leave.start_date) === cairoDay(leave.end_date)
          ? `${cairoDay(leave.start_date)}${leave.total_days ? ` · ${leave.total_days} يوم` : ''}`
          : `${cairoDay(leave.start_date)} ← ${cairoDay(leave.end_date)} · ${leave.total_days} يوم`,
      status: leave.status,
      statusLabel: LEAVE_STATUS_LABELS[leave.status] || leave.status,
      statusTone: LEAVE_STATUS_COLORS[leave.status] || 'bg-gray-100 text-gray-600',
      reason: leave.reason,
      answer: leave.status !== 'PENDING' && (leave.approved_by_name || leave.admin_note)
        ? [leave.approved_by_name, leave.admin_note].filter(Boolean).join(' — ') : null,
      createdAt: leave.created_at,
    })),
    ...advances.map(advance => ({
      id: advance.id, kind: 'advance' as const,
      title: `سلفة ${money(advance.amount, advance.currency)}`,
      when: advance.deduct_month ? `تتخصم من مرتب ${advance.deduct_month}/${advance.deduct_year}` : cairoDay(advance.created_at),
      status: advance.status,
      statusLabel: ADVANCE_STATUS_LABELS[advance.status] || advance.status,
      statusTone: ADVANCE_STATUS_COLORS[advance.status] || 'bg-gray-100 text-gray-600',
      reason: advance.reason,
      answer: advance.status !== 'PENDING' && advance.approved_by_name ? advance.approved_by_name : null,
      createdAt: advance.created_at,
    })),
  ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), [leaves, advances]);
  const shown = filter === 'PENDING' ? rows.filter(row => row.status === 'PENDING') : rows;
  const pending = rows.filter(row => row.status === 'PENDING').length;

  const canSubmit = open === 'advance'
    ? Number(draft.amount) > 0
    : !!draft.startDate && (isPermit ? draft.endTime > draft.startTime : (draft.type === 'PERMISSION' || draft.endDate >= draft.startDate));

  return (
    <div className="space-y-5">
      {/* One card per request. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KINDS.map(({ key, title, hint, icon: Icon, tone }) => (
          <button key={key} type="button" onClick={() => start(key)}
            className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 text-right shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <span className={`mb-3 grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${tone} text-white shadow-sm`}>
              <Icon size={20} />
            </span>
            <span className="block text-sm font-extrabold text-gray-900">{title}</span>
            <span className="block text-[11px] text-gray-500">{hint}</span>
          </button>
        ))}
      </div>

      {hr && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-blue-900">
          <CalendarDays size={15} className="text-blue-500" />
          رصيد إجازاتك السنوية: <strong className="text-sm">{hr.leaveBalance.remaining}</strong> يوم متبقي
          من {hr.leaveBalance.annualEntitlement} — استخدمت {hr.leaveBalance.usedDays}.
          <span className="text-blue-700/70">الإذن الصباحي والمسائي مبيتخصموش من الرصيد.</span>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
          <h3 className="flex items-center gap-2 font-extrabold text-gray-900">
            <Hourglass size={16} className="text-indigo-500" /> طلباتي
            {pending > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">{pending} مستني رد</span>}
          </h3>
          <div className="flex gap-1 rounded-xl bg-gray-100 p-1 text-xs font-bold">
            {([['all', 'الكل'], ['PENDING', 'المعلقة']] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setFilter(key)}
                className={`rounded-lg px-3 py-1 transition ${filter === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{label}</button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-gray-400">
            <Clock3 size={30} className="mx-auto mb-2 text-gray-300" />
            {filter === 'PENDING' ? 'مفيش طلبات مستنية رد' : 'لسه مطلبتش حاجة — اختار نوع الطلب من فوق'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {shown.map(row => (
              <li key={`${row.kind}-${row.id}`} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold text-gray-900">{row.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${row.statusTone}`}>{row.statusLabel}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">{row.when}</p>
                  {row.reason && <p className="mt-1 text-xs text-gray-600">«{row.reason}»</p>}
                  {row.answer && <p className="mt-1 text-[11px] font-semibold text-gray-500">الرد: {row.answer}</p>}
                </div>
                <span className="text-[10px] text-gray-400">{cairoDay(row.createdAt)}</span>
                {row.kind === 'leave' && row.status === 'PENDING' && (
                  <button type="button" onClick={() => { const leave = leaves.find(l => l.id === row.id); if (leave) void cancel(leave); }}
                    className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-bold text-gray-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600">
                    <XCircle size={12} /> سحب
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {open && (
        <Modal open onClose={() => setOpen(null)} size="sm"
          title={KINDS.find(kind => kind.key === open)?.title || 'طلب'}
          icon={(() => { const Icon = KINDS.find(kind => kind.key === open)?.icon || CalendarDays; return <Icon size={16} />; })()}>
          <div className="space-y-3 text-sm">
            {open === 'leave' && (
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-gray-600">نوع الإجازة</span>
                <select value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2">
                  {LEAVE_KINDS.map(type => <option key={type} value={type}>{LEAVE_TYPE_LABELS[type]}</option>)}
                </select>
              </label>
            )}
            {open === 'advance' ? (
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-gray-600">المبلغ (ج.م)</span>
                <input type="number" min="1" dir="ltr" value={draft.amount} onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2" placeholder="مثال: 1500" />
              </label>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className={`block ${isPermit || draft.type === 'PERMISSION' ? 'col-span-2' : ''}`}>
                  <span className="mb-1 block text-xs font-bold text-gray-600">{isPermit || draft.type === 'PERMISSION' ? 'اليوم' : 'من يوم'}</span>
                  <input type="date" value={draft.startDate} onChange={e => setDraft(d => ({ ...d, startDate: e.target.value, endDate: d.endDate < e.target.value ? e.target.value : d.endDate }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2" />
                </label>
                {!isPermit && draft.type !== 'PERMISSION' && (
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-gray-600">لحد يوم</span>
                    <input type="date" min={draft.startDate} value={draft.endDate} onChange={e => setDraft(d => ({ ...d, endDate: e.target.value }))}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2" />
                  </label>
                )}
                {isPermit && (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-xs font-bold text-gray-600">من الساعة</span>
                      <input type="time" value={draft.startTime} onChange={e => setDraft(d => ({ ...d, startTime: e.target.value }))}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-bold text-gray-600">لحد الساعة</span>
                      <input type="time" value={draft.endTime} onChange={e => setDraft(d => ({ ...d, endTime: e.target.value }))}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2" />
                    </label>
                    <p className="col-span-2 text-[11px] text-gray-500">
                      {draft.type === 'LATE_PERMIT' ? 'الوقت اللي هتتأخر فيه عن ميعاد الحضور.' : 'الوقت اللي هتمشي فيه قبل ميعاد الانصراف.'}
                      {' '}لو اتوافق عليه، التأخير في اليوم ده مش هيتخصم.
                    </p>
                  </>
                )}
              </div>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-gray-600">السبب {open === 'advance' ? '' : '(اختياري)'}</span>
              <textarea rows={3} value={draft.reason} onChange={e => setDraft(d => ({ ...d, reason: e.target.value }))}
                className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2" />
            </label>
            <div className="flex gap-2 pt-1">
              <button type="button" disabled={saving || !canSubmit} onClick={() => void submit()}
                className="flex-1 rounded-xl bg-indigo-600 py-2.5 font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'جارٍ الإرسال…' : 'إرسال للموارد البشرية'}
              </button>
              <button type="button" onClick={() => setOpen(null)} className="rounded-xl bg-gray-100 px-4 py-2.5 font-bold text-gray-600 hover:bg-gray-200">إلغاء</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
