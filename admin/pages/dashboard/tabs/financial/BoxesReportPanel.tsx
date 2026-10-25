import { useEffect, useState } from 'react';
import { History, Loader2, Pencil, RefreshCw, RotateCcw, Vault } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { cairoDateTime } from '../../../../../shared/cairoDate';
import { confirmDialog } from '../../../../../shared/ui/confirmDialog';
import { promptDialog } from '../../../../../shared/ui/promptDialog';

type Window = 1 | 7 | 15 | 30;
type Box = {
  method: string; currency: string; totals: Record<Window, number>; counts: Record<Window, number>;
  yesterday: { total: number; count: number }; balance?: number;
};
type Balances = { canManage: boolean; totals: Record<string, number>; general: Record<string, number> };
type BoxesReport = { branch: string | null; today: string; yesterday: string; windows: Record<Window, string>; boxes: Box[]; balances: Balances | null };
type BoxEvent = { id: string; method: string; currency: string; kind: string; before: number; after: number; note: string; actor: string; at: string };

const WINDOWS: Array<[Window, string]> = [[1, 'اليوم'], [7, 'آخر 7 أيام'], [15, 'آخر 15 يوم'], [30, 'آخر 30 يوم']];
const KIND: Record<string, string> = { reset: 'تصفير خزنة', set_balance: 'تعديل رصيد خزنة', set_total: 'تعديل الرصيد العام', reset_all: 'تصفير كل الخزائن' };
const num = (value: number) => value.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 });
const unit = (currency: string) => (currency === 'EGP' ? 'ج.م' : currency);

/**
 * «الخزائن — كل وسيلة دفع وفيها كام»: each box's CURRENT BALANCE beside what came in today, yesterday and over 7, 15 and 30
 * days (GET /api/admin/finance/boxes). The institute's books can reset a box to zero, correct a box to the amount counted and
 * correct the overall balance — each one written to a history with the balance before and after (lib/boxBalances.js). A branch
 * sees its own clients' money only, with no balances.
 */
export function BoxesReportPanel({ branch }: { branch?: string }) {
  const [report, setReport] = useState<BoxesReport | null>(null);
  const [events, setEvents] = useState<BoxEvent[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    mysqlAdmin.adminGet<BoxesReport>(`/admin/finance/boxes${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`)
      .then(result => {
        setReport(result);
        if (result.balances) mysqlAdmin.adminGet<BoxEvent[]>('/admin/finance/boxes/history').then(setEvents).catch(() => setEvents([]));
      })
      .catch(err => setError(err instanceof Error ? err.message : 'تعذر تحميل الخزائن'))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [branch]);

  const balances = report?.balances || null;
  const canManage = Boolean(balances?.canManage);

  const send = async (key: string, path: string, body: Record<string, unknown>) => {
    setBusy(key);
    try { await mysqlAdmin.adminPost(`/admin/finance/boxes/${path}`, body); setError(''); load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر الحفظ'); } finally { setBusy(''); }
  };

  const askAmount = async (title: string, message: string, current: number) => {
    const answer = await promptDialog({ title, message, defaultValue: String(current), confirmLabel: 'متابعة' });
    if (answer === null) return null;
    const value = Number(String(answer).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[,،\s]/g, ''));
    if (!Number.isFinite(value)) { setError('اكتب رقم صحيح'); return null; }
    return value;
  };
  const askNote = async () => {
    const note = await promptDialog({ title: 'السبب', message: 'اكتب سبب التعديل (يتسجل في السجل)', placeholder: 'مثلاً: جرد آخر اليوم', confirmLabel: 'حفظ' });
    return note === null ? null : note.trim();
  };

  const editBox = async (box: Box) => {
    const amount = await askAmount('تعديل رصيد الخزنة', `${box.method} — اكتب الرصيد الصح اللي في الخزنة دلوقتي`, box.balance ?? 0);
    if (amount === null) return;
    const note = await askNote();
    if (note === null) return;
    await send(`e:${box.method}:${box.currency}`, 'balance', { method: box.method, currency: box.currency, amount, note });
  };
  const resetBox = async (box: Box) => {
    if (!await confirmDialog(`تصفير خزنة «${box.method}»؟ الرصيد (${num(box.balance ?? 0)} ${unit(box.currency)}) هيرجع صفر ويبدأ العد من دلوقتي. الدفعات نفسها مش بتتمسح.`)) return;
    const note = await askNote();
    if (note === null) return;
    await send(`r:${box.method}:${box.currency}`, 'reset', { method: box.method, currency: box.currency, note });
  };
  const editTotal = async (currency: string) => {
    const amount = await askAmount('تعديل الرصيد العام', `الرصيد العام بالـ${unit(currency)} — اكتب الرقم الصح. الخزائن نفسها مش هتتغير، بتتضاف تسوية عامة بالفرق.`, balances?.totals[currency] ?? 0);
    if (amount === null) return;
    const note = await askNote();
    if (note === null) return;
    await send(`t:${currency}`, 'total', { currency, amount, note });
  };
  const resetAll = async (currency: string) => {
    if (!await confirmDialog(`تصفير كل خزائن ${unit(currency)}؟ الرصيد العام (${num(balances?.totals[currency] ?? 0)}) هيرجع صفر ويبدأ العد من دلوقتي.`)) return;
    const note = await askNote();
    if (note === null) return;
    await send(`a:${currency}`, 'reset-all', { currency, note });
  };

  const currencies = [...new Set((report?.boxes || []).map(box => box.currency))];
  const iconButton = 'rounded-lg border p-1.5 transition disabled:opacity-50';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-gray-800">
          <Vault size={16} className="text-emerald-600" />
          الخزائن — كل وسيلة دفع وفيها كام
          {report?.today && <span className="text-[11px] font-semibold text-gray-400">لحد {report.today}</span>}
        </h3>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} تحديث
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {balances && Object.keys(balances.totals).length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(balances.totals).map(([currency, total]) => (
            <div key={currency} className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
              <p className="text-xs font-bold text-emerald-800">الرصيد العام الحالي ({unit(currency)})</p>
              <p className="mt-1 text-2xl font-extrabold text-emerald-900">{num(total)} {unit(currency)}</p>
              {balances.general[currency] ? <p className="text-[11px] text-emerald-700">منه تسوية عامة {num(balances.general[currency])}</p> : null}
              {canManage && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" disabled={Boolean(busy)} onClick={() => void editTotal(currency)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"><Pencil size={11} /> تعديل الرصيد العام</button>
                  <button type="button" disabled={Boolean(busy)} onClick={() => void resetAll(currency)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"><RotateCcw size={11} /> تصفير الكل</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {loading && !report ? (
        <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 size={18} className="ml-2 animate-spin" /> جاري التحميل...</div>
      ) : !report?.boxes.length ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">مفيش فلوس دخلت أي خزنة في آخر 30 يوم.</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2.5 text-right font-semibold">وسيلة الدفع</th>
                {balances && <th className="px-3 py-2.5 text-right font-semibold">الرصيد الحالي</th>}
                <th className="px-3 py-2.5 text-right font-semibold">دخل اليوم<div className="text-[10px] font-normal text-gray-400">{report.today}</div></th>
                <th className="px-3 py-2.5 text-right font-semibold">دخل امبارح<div className="text-[10px] font-normal text-gray-400">{report.yesterday}</div></th>
                {WINDOWS.filter(([days]) => days !== 1).map(([days, label]) => (
                  <th key={days} className="px-3 py-2.5 text-right font-semibold">
                    {label}
                    <div className="text-[10px] font-normal text-gray-400">من {report.windows[days]}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.boxes.map((box, index) => {
                const money = (value: number) => (
                  <span className={`font-bold ${value < 0 ? 'text-red-600' : value ? 'text-emerald-700' : 'text-gray-300'}`}>{num(value)} {unit(box.currency)}</span>
                );
                return (
                  <tr key={`${box.method}:${box.currency}`} className={`${index % 2 ? 'bg-gray-50' : 'bg-white'} border-t border-gray-100`}>
                    <td className="px-3 py-2 font-bold text-gray-800">{box.method}</td>
                    {balances && (
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`text-base font-extrabold ${(box.balance ?? 0) < 0 ? 'text-red-600' : 'text-gray-900'}`}>{num(box.balance ?? 0)} {unit(box.currency)}</span>
                        {canManage && (
                          <span className="mr-2 inline-flex gap-1 align-middle">
                            <button type="button" title="تعديل الرصيد" aria-label="تعديل الرصيد" disabled={Boolean(busy)} onClick={() => void editBox(box)} className={`${iconButton} border-gray-200 text-gray-600 hover:bg-gray-100`}><Pencil size={12} /></button>
                            <button type="button" title="تصفير" aria-label="تصفير" disabled={Boolean(busy)} onClick={() => void resetBox(box)} className={`${iconButton} border-red-200 text-red-600 hover:bg-red-50`}><RotateCcw size={12} /></button>
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 whitespace-nowrap">{money(box.totals[1])}{box.counts[1] > 0 && <span className="mr-1 text-[10px] text-gray-400">({box.counts[1]} دفعة)</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{money(box.yesterday.total)}{box.yesterday.count > 0 && <span className="mr-1 text-[10px] text-gray-400">({box.yesterday.count} دفعة)</span>}</td>
                    {WINDOWS.filter(([days]) => days !== 1).map(([days]) => (
                      <td key={days} className="px-3 py-2 whitespace-nowrap">{money(box.totals[days])}{box.counts[days] > 0 && <span className="mr-1 text-[10px] text-gray-400">({box.counts[days]} دفعة)</span>}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-emerald-50/60 font-extrabold">
              {currencies.map(currency => {
                const own = report.boxes.filter(box => box.currency === currency);
                const sum = (pick: (box: Box) => number) => own.reduce((total, box) => total + pick(box), 0);
                return (
                  <tr key={currency}>
                    <td className="px-3 py-2 text-emerald-900">الإجمالي{currencies.length > 1 ? ` (${currency})` : ''}</td>
                    {balances && <td className="px-3 py-2 whitespace-nowrap text-emerald-900">{num(sum(box => box.balance ?? 0))} {unit(currency)}</td>}
                    <td className="px-3 py-2 whitespace-nowrap text-emerald-800">{num(sum(box => box.totals[1]))} {unit(currency)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-emerald-800">{num(sum(box => box.yesterday.total))} {unit(currency)}</td>
                    {WINDOWS.filter(([days]) => days !== 1).map(([days]) => (
                      <td key={days} className="px-3 py-2 whitespace-nowrap text-emerald-800">{num(sum(box => box.totals[days]))} {unit(currency)}</td>
                    ))}
                  </tr>
                );
              })}
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-[11px] text-gray-400">
        {balances
          ? 'الرصيد الحالي = اللي دخل الخزنة من آخر تصفير (أو من الأول) ± تعديلاتك. التصفير والتعديل بيتسجلوا في السجل ومبيمسحوش الدفعات. '
          : ''}
        الاسترداد بيتخصم من الخزنة اللي خرج منها. الأرقام من الدفعات المعتمدة بس — الدفعات اللي مستنية مراجعة مش محسوبة.
      </p>

      {balances && events.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white">
          <button type="button" onClick={() => setShowHistory(open => !open)} className="flex w-full items-center gap-2 px-4 py-3 text-right text-sm font-extrabold text-gray-700">
            <History size={15} className="text-gray-500" /> سجل تعديلات الخزائن ({events.length})
          </button>
          {showHistory && (
            <ul className="divide-y divide-gray-100 border-t border-gray-100">
              {events.map(event => (
                <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs">
                  <span><b className="text-gray-800">{KIND[event.kind] || event.kind}</b> · {event.method} {event.actor && <span className="text-gray-500">— {event.actor}</span>}{event.note && <span className="text-gray-500"> · {event.note}</span>}</span>
                  <span className="whitespace-nowrap text-gray-600">{num(event.before)} ← <b>{num(event.after)}</b> {unit(event.currency)} · <span className="text-gray-400">{cairoDateTime(event.at)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
