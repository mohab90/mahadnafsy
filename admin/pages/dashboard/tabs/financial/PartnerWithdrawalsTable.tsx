import { useCallback, useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { confirmDialog } from '../../../../../shared/ui/confirmDialog';

type Row = {
  id: string; box: string; currency: string; amount: number; kind: 'partner' | 'expense' | 'transfer' | 'other'; partnerName: string | null;
  toBox: string | null; account: string | null; note: string; date: string; actor: string; voided: boolean;
};
type PartnerSummary = { key: string; name: string; totals: Record<string, number>; boxes: { box: string; currency: string; total: number }[]; count: number };
type Report = { rows: Row[]; partners: PartnerSummary[] };

const num = (value: number) => value.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 });
const unit = (currency: string) => (currency === 'EGP' ? 'ج.م' : currency);
const DIRECTION: Record<Row['kind'], string> = { partner: 'سحب شخصي', expense: 'مصروف', transfer: 'تحويل بين خزائن', other: 'حساب آخر' };

/**
 * «جدول بالأرصدة اللي سحبها مهاب واللي سحبها وليد من كل الخزن»: what each partner drew, in total and from each box, for a period, and every
 * withdrawal below with where it was booked. A cancelled one stays in the list, struck through, and is in no total.
 */
export function PartnerWithdrawalsTable({ canManage, refreshKey, onChanged }: { canManage: boolean; refreshKey: number; onChanged: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    mysqlAdmin.adminGet<Report>(`/admin/finance/boxes/withdrawals${query.size ? `?${query}` : ''}`).then(setReport, err => setError(err instanceof Error ? err.message : 'تعذر تحميل المسحوبات'));
  }, [from, to]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const cancel = async (row: Row) => {
    if (!await confirmDialog(`إلغاء سحب ${num(row.amount)} ${unit(row.currency)} من «${row.box}»؟ الفلوس هترجع للخزنة وهيتسجل قيد عكسي.`)) return;
    setBusy(row.id);
    try { await mysqlAdmin.adminPost('/admin/finance/boxes/withdrawals/void', { id: row.id }); onChanged(); load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر الإلغاء'); } finally { setBusy(''); }
  };

  if (!report) return <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> بيحمّل المسحوبات…</div>;
  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-gray-800"><Users size={16} className="text-indigo-600" /> مسحوبات الشركاء من كل الخزن</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          من <input type="date" value={from} onChange={event => setFrom(event.target.value)} className="rounded-lg border border-gray-200 px-2 py-1" />
          إلى <input type="date" value={to} onChange={event => setTo(event.target.value)} className="rounded-lg border border-gray-200 px-2 py-1" />
        </div>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {report.partners.map(partner => (
          <div key={partner.key} className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
            <p className="text-sm font-extrabold text-indigo-900">{partner.name} <span className="text-[11px] font-normal text-gray-500">({partner.count} سحب)</span></p>
            {Object.keys(partner.totals).length === 0
              ? <p className="mt-1 text-xs text-gray-400">مسحبش حاجة في الفترة دي.</p>
              : Object.entries(partner.totals).map(([currency, total]) => <p key={currency} className="mt-1 text-xl font-extrabold text-indigo-900">{num(total)} {unit(currency)}</p>)}
            {partner.boxes.length > 0 && (
              <table className="mt-2 w-full text-xs">
                <thead className="text-gray-500"><tr><th className="py-1 text-right font-semibold">الخزنة</th><th className="py-1 text-right font-semibold">اللي اتسحب منها</th></tr></thead>
                <tbody>{partner.boxes.map(entry => (
                  <tr key={`${entry.box}|${entry.currency}`} className="border-t border-indigo-100"><td className="py-1 text-gray-700">{entry.box}</td><td className="py-1 font-bold text-gray-800">{num(entry.total)} {unit(entry.currency)}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
        ))}
      </div>
      {report.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>{['التاريخ', 'الخزنة', 'التوجيه', 'المبلغ', 'ملاحظة', 'سجّله', ''].map(label => <th key={label} className="px-3 py-2 text-right font-semibold">{label}</th>)}</tr>
            </thead>
            <tbody>
              {report.rows.map(row => (
                <tr key={row.id} className={`border-t border-gray-100 ${row.voided ? 'text-gray-400 line-through' : ''}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{row.date}</td>
                  <td className="px-3 py-2">{row.box}</td>
                  <td className="px-3 py-2">{row.kind === 'partner' ? `${DIRECTION.partner} — ${row.partnerName}` : row.kind === 'transfer' ? `${DIRECTION.transfer} ← ${row.toBox}` : `${DIRECTION[row.kind]}${row.account ? ` (${row.account})` : ''}`}</td>
                  <td className="px-3 py-2 font-bold whitespace-nowrap">{num(row.amount)} {unit(row.currency)}</td>
                  <td className="px-3 py-2">{row.note}</td>
                  <td className="px-3 py-2">{row.actor}</td>
                  <td className="px-3 py-2">{canManage && !row.voided && (
                    <button type="button" disabled={busy === row.id} onClick={() => void cancel(row)} className="rounded-lg border border-red-200 px-2 py-1 text-[11px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-40">إلغاء</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
