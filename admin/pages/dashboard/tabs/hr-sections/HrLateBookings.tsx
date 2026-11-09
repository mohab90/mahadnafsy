// «الحجز اتأخر رفعه» (9 Nov 2026): a booking whose first payment was recorded in the month after (or before) can count in THIS month for a sales rep — and, there,
// not in its own month. Only the month the bonus counts it in moves: the payment, its date and every money record stay as they are. A reason is required; the change
// shows in the month's list of changes and is taken back from there.
import { useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { mysqlAdmin, type LateBooking } from '../../../../lib/mysqlapi';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
const n = (value: number) => Number(value).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 });

export default function HrLateBookings({ month, notify, onChanged }: { month: string; notify: Notify; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ bookings: LateBooking[]; reps: { id: string; name: string }[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pick, setPick] = useState<{ paymentId: string; repId: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await mysqlAdmin.getLateBookings(month)); } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر تحميل الحجوزات'); } finally { setLoading(false); }
  }, [month, notify]);
  const toggle = () => { const next = !open; setOpen(next); if (next) void load(); };

  const submit = async () => {
    if (!pick) return;
    if (!pick.repId) { notify('error', 'اختار السيلز اللي الحجز يتحسب له'); return; }
    if (pick.reason.trim().length < 3) { notify('error', 'اكتب سبب التعديل'); return; }
    setBusy(true);
    try {
      await mysqlAdmin.addBonusAdjustment({ month, kind: 'COUNT_IN_MONTH', staffId: pick.repId, paymentId: pick.paymentId, reason: pick.reason.trim() });
      notify('success', 'الحجز اتحسب في الشهر ده — الدفعة نفسها ما اتغيرتش');
      setPick(null);
      await load();
      onChanged();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر التعديل'); } finally { setBusy(false); }
  };

  return (
    <div className="mt-4 rounded-xl border border-gray-200 p-3" dir="rtl">
      <button type="button" onClick={toggle} className="text-xs font-extrabold text-indigo-700">{open ? '▲' : '▼'} حجز اتأخر رفعه — احسبه في شهر {month}</button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-gray-500">أول دفعة لعميل اتسجلت في الشهر اللي قبل أو اللي بعد: تقدر تحسبها في الشهر ده لسيلز معين، وساعتها مش بتتحسب في شهرها. التاريخ والمبلغ وكل سجلات الفلوس زي ما هي.</p>
          {loading && <Loader2 size={14} className="animate-spin text-gray-400" />}
          {data && data.bookings.length === 0 && <p className="text-xs text-gray-500">مفيش حجوزات في الشهر اللي قبل أو بعد.</p>}
          {data && data.bookings.length > 0 && (
            <div className="max-h-72 overflow-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 text-gray-500"><tr><th className="p-1.5 text-right">اتدفع</th><th className="p-1.5 text-right">العميل</th><th className="p-1.5 text-right">الكورس / المسار</th><th className="p-1.5 text-right">يتحسب حجز</th><th className="p-1.5 text-right">السيلز</th><th className="p-1.5" /></tr></thead>
                <tbody>
                  {data.bookings.map(booking => (
                    <tr key={booking.paymentId} className="border-t border-gray-100 align-top">
                      <td className="p-1.5" dir="ltr">{booking.day}</td>
                      <td className="p-1.5">{booking.client} {booking.clientCode && <span className="text-gray-400">({booking.clientCode})</span>}</td>
                      <td className="p-1.5">{booking.title}</td>
                      <td className="p-1.5 font-bold">{n(booking.weight)}</td>
                      <td className="p-1.5">{booking.repName || <span className="text-gray-400">مش لسيلز</span>}</td>
                      <td className="p-1.5">
                        {booking.countedIn === month ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-700">محسوب في الشهر ده</span>
                          : booking.countedIn ? <span className="rounded bg-amber-50 px-1.5 py-0.5 font-bold text-amber-700">محسوب في {booking.countedIn}</span> : null}
                        {booking.countedIn !== month && (
                          <button type="button" className="mr-1 font-bold text-indigo-600" onClick={() => setPick({ paymentId: booking.paymentId, repId: booking.repId || '', reason: '' })}>احسبه هنا</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pick && data && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs">
              <select aria-label="السيلز" value={pick.repId} onChange={e => setPick({ ...pick, repId: e.target.value })} className="rounded-lg border border-gray-200 bg-white px-2 py-1">
                <option value="">اختار السيلز اللي الحجز يتحسب له</option>
                {data.reps.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
              </select>
              <input aria-label="السبب" value={pick.reason} onChange={e => setPick({ ...pick, reason: e.target.value })} placeholder="السبب (مطلوب)" maxLength={500} className="min-w-[14rem] flex-1 rounded-lg border border-gray-200 px-2 py-1" />
              <button type="button" disabled={busy} onClick={() => void submit()} className="rounded-lg bg-amber-600 px-3 py-1 font-bold text-white disabled:opacity-40">نفّذ</button>
              <button type="button" onClick={() => setPick(null)} className="rounded-lg border border-gray-200 bg-white px-3 py-1 font-bold">إلغاء</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
