// «بدل رصيد الإجازات» (11 Nov 2026): the leave balance does not carry over, so at the year's end the days each employee has left are paid at his salary. The list shows
// entitlement, used, remaining, the day's pay and the amount with the total; confirming writes one bonus per employee awaiting a second person's approval.
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../../../../../shared/ui/Modal';
import { Banknote } from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';
import { cairoMonthStart } from '../../../../../shared/cairoDate';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type Row = { staffId: string; name: string; entitlement: number; used: number; remaining: number; dayRate: number | null; amount: number; noSalary: boolean; saved: { status: string; amount: number } | null };
type Listing = { rows: Row[]; total: number };
type Saved = { written: unknown[]; updated: unknown[]; kept: unknown[]; skipped: { name: string }[] };

const num = (value: number) => Number(value || 0).toLocaleString('ar-EG-u-nu-latn');
const STATUS_AR: Record<string, string> = { PENDING: 'مستنية الاعتماد', APPROVED: 'معتمدة', REJECTED: 'مرفوضة' };

export default function HrLeaveEncashmentModal({ notify, onClose }: { notify: Notify; onClose: () => void }) {
  const [year, setYear] = useState(() => Number(cairoMonthStart(0).slice(0, 4)));
  const [month, setMonth] = useState(12);
  const [listing, setListing] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setListing(null);
    try {
      const response = await fetch(`/api/admin/hr/leave-encashment?year=${year}&month=${month}`, { credentials: 'include', headers: adminAuthHeaders() });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'تعذر تحميل رصيد الإجازات');
      setListing(payload as Listing);
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر تحميل رصيد الإجازات'); }
  }, [year, month, notify]);
  useEffect(() => { void load(); }, [load]);

  const confirm = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/hr/leave-encashment', { method: 'POST', credentials: 'include', headers: adminAuthHeaders(true), body: JSON.stringify({ year, month }) });
      const payload = await response.json().catch(() => ({})) as Saved & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'تعذر حفظ بدل الإجازات');
      notify('success', `اتحفظ بدل الإجازات لـ ${payload.written.length + payload.updated.length} موظف للاعتماد${payload.kept.length ? ` — ${payload.kept.length} معتمدين قبل كده فاتسابوا` : ''}`);
      if (payload.skipped.length) notify('info', `${payload.skipped.map(s => s.name).join('، ')}: مينفعش تحفظ بدل إجازتك بنفسك — حد تاني يعمله`);
      await load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر حفظ بدل الإجازات'); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="بدل رصيد الإجازات" icon={<Banknote size={16} />} size="lg">
      <div className="space-y-3">
        <p className="text-xs text-gray-600">رصيد الإجازات مبيترحلش للسنة الجاية: الأيام الباقية بتتحول لفلوس = الأيام الباقية × (المرتب ÷ 30). الحفظ بيعمل مكافأة معلقة لكل موظف يعتمدها شخص تاني.</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label>السنة <input type="number" min={2020} max={2100} value={year} onChange={e => setYear(Number(e.target.value))} className="w-24 rounded-lg border border-gray-200 px-2 py-1" /></label>
          <label>شهر الصرف <select value={month} onChange={e => setMonth(Number(e.target.value))} className="rounded-lg border border-gray-200 px-2 py-1">
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
          </select></label>
        </div>
        {!listing ? <p className="py-6 text-center text-sm text-gray-400">جاري التحميل...</p> : (
          <div className="max-h-96 overflow-auto rounded-xl border border-gray-100">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 bg-gray-50"><tr><th className="px-2 py-2">الموظف</th><th className="px-2">الاستحقاق</th><th className="px-2">المستخدم</th><th className="px-2">الباقي</th><th className="px-2">سعر اليوم</th><th className="px-2">المبلغ</th><th className="px-2">الحالة</th></tr></thead>
              <tbody>
                {listing.rows.map(row => (
                  <tr key={row.staffId} className="border-t border-gray-100">
                    <td className="px-2 py-1.5 font-bold">{row.name}</td><td className="px-2">{num(row.entitlement)}</td><td className="px-2">{num(row.used)}</td><td className="px-2">{num(row.remaining)}</td>
                    <td className="px-2">{row.dayRate == null ? 'مفيش راتب' : num(row.dayRate)}</td><td className="px-2 font-bold">{num(row.amount)}</td>
                    <td className="px-2 text-gray-500">{row.saved ? `${STATUS_AR[row.saved.status] || row.saved.status} (${num(row.saved.amount)})` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm font-extrabold">الإجمالي: {num(listing?.total ?? 0)} ج.م</span>
          <button disabled={busy || !listing || listing.total <= 0} onClick={() => void confirm()} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">حفظ للاعتماد</button>
        </div>
      </div>
    </Modal>
  );
}
