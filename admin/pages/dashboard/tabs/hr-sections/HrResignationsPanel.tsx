import { useCallback, useEffect, useState } from 'react';
import { DoorOpen, Check, X } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

// Staff can file a resignation and the API stores and lists it — but nothing
// in the admin app ever read /admin/hr/resignations, so a submitted request sat
// in the table forever with no one able to accept or decline it. The decision
// endpoint only acts on rows still 'pending', which is why decided rows below
// render as history rather than as actionable cards.

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

type Resignation = {
  id: string;
  staff_id: string;
  staff_name?: string;
  role?: string;
  last_working_day?: string;
  reason_note?: string;
  status: string;
  hr_note?: string;
  created_at?: string;
  decided_at?: string;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'بانتظار القرار', cls: 'bg-amber-100 text-amber-700' },
  accepted: { label: 'مقبولة', cls: 'bg-emerald-100 text-emerald-700' },
  declined: { label: 'مرفوضة', cls: 'bg-red-100 text-red-700' },
  withdrawn: { label: 'مسحوبة', cls: 'bg-gray-100 text-gray-600' },
};

export default function HrResignationsPanel({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<Resignation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mysqlAdmin.adminGet<Resignation[]>('/admin/hr/resignations');
      setRows(Array.isArray(data) ? data : []);
    } catch {
      notify('error', 'تعذر تحميل طلبات الاستقالة');
    } finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const decide = async (row: Resignation, status: 'accepted' | 'declined') => {
    const hrNote = window.prompt(
      status === 'accepted'
        ? `قبول استقالة ${row.staff_name || ''} — ملاحظة للسجل (اختياري):`
        : `رفض استقالة ${row.staff_name || ''} — اذكر السبب:`
    );
    if (hrNote === null) return;
    if (status === 'declined' && !hrNote.trim()) { notify('error', 'سبب الرفض مطلوب'); return; }
    setBusy(row.id);
    try {
      await mysqlAdmin.adminPut(`/admin/hr/resignations/${row.id}`, { status, hrNote });
      await load();
      notify('success', status === 'accepted' ? 'تم قبول الاستقالة' : 'تم رفض الاستقالة');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تنفيذ القرار');
    } finally { setBusy(''); }
  };

  const pending = rows.filter(r => r.status === 'pending');

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm" dir="rtl">
      <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-3">
        <DoorOpen size={17} className="text-slate-600" />
        طلبات الاستقالة
        {pending.length > 0 && <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">{pending.length} بانتظار القرار</span>}
      </h3>

      {loading ? (
        <div className="py-10 text-center text-gray-400">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-slate-600" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-xs text-emerald-700">لا توجد طلبات استقالة.</div>
      ) : (
        <div className="space-y-2">
          {rows.map(row => {
            const badge = STATUS[row.status] || STATUS.pending;
            return (
              <div key={row.id} className="rounded-xl border border-gray-100 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-sm text-gray-800">{row.staff_name || '—'}</span>
                  {row.role && <span className="text-xs text-gray-500">{row.role}</span>}
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${badge.cls}`}>{badge.label}</span>
                  {row.last_working_day && (
                    <span className="text-xs text-gray-500">آخر يوم عمل: {String(row.last_working_day).slice(0, 10)}</span>
                  )}
                  <span className="flex-1" />
                  {row.status === 'pending' && (
                    <>
                      <button disabled={busy === row.id} onClick={() => decide(row, 'declined')}
                        className="flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-50">
                        <X size={12} /> رفض
                      </button>
                      <button disabled={busy === row.id} onClick={() => decide(row, 'accepted')}
                        className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                        <Check size={12} /> قبول
                      </button>
                    </>
                  )}
                </div>
                {row.reason_note && <p className="mt-1 text-xs text-gray-600">السبب: {row.reason_note}</p>}
                {row.hr_note && <p className="mt-0.5 text-xs text-slate-500">ملاحظة الموارد البشرية: {row.hr_note}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
