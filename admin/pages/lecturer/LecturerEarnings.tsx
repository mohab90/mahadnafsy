import { useCallback, useEffect, useState } from 'react';
import { Download, Wallet } from 'lucide-react';
import { cairoDateOnly, cairoDay } from '../../../shared/cairoDate';
import { downloadCsv } from '../../../shared/csv';
import { errorText, lecturerApi, money, type Earnings, type Notify } from './lecturerApi';
import { Card, Empty, field, Loading, quietButton, Stat } from './ui';

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'مستني اعتماد الحسابات', cls: 'bg-amber-100 text-amber-800' }, approved: { label: 'معتمد', cls: 'bg-blue-100 text-blue-800' },
  included_in_payroll: { label: 'داخل المرتبات', cls: 'bg-blue-100 text-blue-800' }, paid: { label: 'اتصرف', cls: 'bg-emerald-100 text-emerald-800' },
  rejected: { label: 'مرفوض', cls: 'bg-red-100 text-red-700' },
};
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/**
 * «حسابات المحاضرات اللايف والفلوس بتاعة تدوير العملاء والمكافآت … كشف الحساب»: the fees the accounts team records for
 * the lectures delivered, the share of payments and the retention bonus — by status — and the payslips that paid them.
 */
export function LecturerEarnings({ notify }: { notify: Notify }) {
  const today = cairoDateOnly();
  const [month, setMonth] = useState(0);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [data, setData] = useState<Earnings | null>(null);

  const load = useCallback(() => {
    setData(null);
    lecturerApi.earnings(month || undefined, month ? year : undefined).then(setData)
      .catch(error => { notify('error', errorText(error, 'تعذر تحميل كشف الحساب')); setData({ totals: { waiting: 0, approved: 0, paid: 0, retention: 0 }, byType: [], fees: [], payslips: [] }); });
  }, [month, year, notify]);
  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(`كشف-حساب-المحاضر-${month ? `${year}-${month}` : 'الكل'}`, [
      ['النوع', 'الكورس', 'الشهر', 'المبلغ', 'العملة', 'الحالة', 'ملاحظة'],
      ...data.fees.map(fee => [fee.label, fee.course, fee.month && fee.year ? `${fee.year}-${String(fee.month).padStart(2, '0')}` : '', fee.amount, fee.currency, STATUS[fee.status]?.label || fee.status, fee.note]),
    ]);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-bold text-gray-600">الشهر
          <select className={field} value={month} onChange={e => setMonth(Number(e.target.value))}>
            <option value={0}>كل الفترات</option>{MONTHS.map((label, i) => <option key={label} value={i + 1}>{label}</option>)}</select></label>
        {month > 0 && <label className="text-xs font-bold text-gray-600">السنة
          <input type="number" className={`${field} !w-24`} value={year} onChange={e => setYear(Number(e.target.value))} /></label>}
        <button type="button" className={quietButton} onClick={exportCsv} disabled={!data || data.fees.length === 0}><Download size={15} /> تصدير كشف الحساب</button>
      </div>
      {!data ? <Loading /> : (<>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="مستني اعتماد" value={money(data.totals.waiting)} tone="amber" hint="بيتسجل لوحده بعد كل محاضرة" />
          <Stat label="معتمد" value={money(data.totals.approved)} tone="blue" hint="هيدخل المرتبات" />
          <Stat label="اتصرف" value={money(data.totals.paid)} tone="emerald" />
          <Stat label="مكافآت تدوير العملاء" value={money(data.totals.retention)} tone="violet" hint="لما طالب درس معاك يشتري كورس تاني" />
        </div>
        {data.byType.length > 0 && (
          <Card title="الفلوس حسب النوع" icon={<Wallet size={18} className="text-emerald-600" />}>
            <div className="grid gap-2 md:grid-cols-3">
              {data.byType.map(row => (
                <div key={row.type} className="rounded-2xl border border-gray-200 bg-gray-50/60 p-3">
                  <p className="text-xs font-bold text-gray-500">{row.label}</p>
                  <p className="text-lg font-extrabold text-gray-900">{money(row.total)}</p>
                  <p className="text-[11px] text-gray-400">{row.count} بند</p>
                </div>
              ))}
            </div>
          </Card>
        )}
        <Card title="بنود كشف الحساب">
          {data.fees.length === 0 ? <Empty>مفيش بنود في الفترة دي. المحاضرات بتتسجل لوحدها لما الروند أو اللايف يخلص.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-200 text-right text-xs text-gray-500"><th className="p-2">النوع</th><th className="p-2">الكورس</th><th className="p-2">الشهر</th><th className="p-2">المبلغ</th><th className="p-2">الحالة</th></tr></thead>
                <tbody>
                  {data.fees.map(fee => (
                    <tr key={fee.id} className="border-b border-gray-100" title={fee.note}>
                      <td className="p-2 font-bold text-gray-900">{fee.label}</td>
                      <td className="p-2 text-xs text-gray-600">{fee.course || '—'}</td>
                      <td className="p-2 text-xs text-gray-500">{fee.month && fee.year ? `${MONTHS[fee.month - 1]} ${fee.year}` : cairoDay(fee.createdAt)}</td>
                      <td className="p-2 font-bold">{money(fee.amount, fee.currency)}</td>
                      <td className="p-2"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS[fee.status]?.cls || 'bg-gray-100 text-gray-600'}`}>{STATUS[fee.status]?.label || fee.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {data.payslips.length > 0 && (
          <Card title="كشوف المرتب المعتمدة">
            <ul className="space-y-1.5">
              {data.payslips.map(slip => (
                <li key={`${slip.year}-${slip.month}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2 text-sm">
                  <span className="font-bold text-gray-900">{MONTHS[slip.month - 1]} {slip.year}</span>
                  <span className="text-xs text-gray-500">عمولات {money(slip.commission)} · مكافآت {money(slip.bonus)}</span>
                  <span className="font-extrabold text-emerald-700">صافي {money(slip.net)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${slip.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{slip.status === 'PAID' ? 'اتصرف' : 'معتمد'}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </>)}
    </div>
  );
}
