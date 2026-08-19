import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, RefreshCw, Scale } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

interface BalanceSheet {
  asOf: string;
  branch: string | null;
  assets: { cashAndEquivalents: number; totalRevenue: number; totalAssets: number };
  liabilities: { outstandingReceivables: number; totalLiabilities: number };
  equity: { retainedEarnings: number; contributedEquity: number; totalEquity: number };
  summary: {
    totalRevenue: number;
    totalExpenses: number;
    totalRefunds: number;
    netPosition: number;
    ledgerImbalance: number;
  };
}

const money = (value: number) =>
  Number(value || 0).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 });

const BalanceSheetTab: React.FC<Props> = ({ notify }) => {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [sheet, setSheet] = useState<BalanceSheet | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSheet(await mysqlAdmin.getFinancialBalanceSheet(asOf));
    } catch (error) {
      setSheet(null);
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل الميزانية العمومية');
    } finally {
      setLoading(false);
    }
  }, [asOf, notify]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <div className="flex min-h-56 items-center justify-center text-gray-500"><RefreshCw className="ml-2 animate-spin" size={18} /> جاري تحميل دفتر الأستاذ…</div>;
  }
  if (!sheet) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-700">لا يمكن عرض ميزانية غير مؤكدة. راجع اتصال قاعدة البيانات ثم أعد المحاولة.</div>;
  }

  const rows = [
    {
      title: 'الأصول',
      icon: <ArrowUpRight size={18} />,
      tone: 'border-blue-100 bg-blue-50 text-blue-800',
      total: sheet.assets.totalAssets,
      items: [
        ['النقدية وما في حكمها', sheet.assets.cashAndEquivalents],
        ['أصول أخرى مسجلة بالدفتر', sheet.assets.totalAssets - sheet.assets.cashAndEquivalents],
      ] as [string, number][],
    },
    {
      title: 'الخصوم',
      icon: <ArrowDownRight size={18} />,
      tone: 'border-red-100 bg-red-50 text-red-800',
      total: sheet.liabilities.totalLiabilities,
      items: [
        ['إجمالي الخصوم المسجلة', sheet.liabilities.totalLiabilities],
      ] as [string, number][],
    },
    {
      title: 'حقوق الملكية',
      icon: <Scale size={18} />,
      tone: 'border-emerald-100 bg-emerald-50 text-emerald-800',
      total: sheet.equity.totalEquity,
      items: [
        ['رأس المال وحقوق الملكية', sheet.equity.contributedEquity],
        ['الأرباح المحتجزة', sheet.equity.retainedEarnings],
      ] as [string, number][],
    },
  ];
  const balanced = Math.abs(sheet.summary.ledgerImbalance) < 0.01;

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl bg-gradient-to-l from-emerald-700 to-teal-600 p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold"><Scale size={22} /> الميزانية العمومية</h2>
            <p className="mt-1 text-sm text-emerald-100">أرقام فعلية محسوبة من قيود دفتر الأستاذ حتى التاريخ المحدد.</p>
          </div>
          <label className="text-sm">
            حتى تاريخ
            <input
              type="date"
              value={asOf}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setAsOf(event.target.value)}
              className="mr-2 rounded-xl border border-white/30 bg-white/15 px-3 py-2 text-white"
            />
          </label>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ['إجمالي الأصول', sheet.assets.totalAssets],
            ['إجمالي الخصوم', sheet.liabilities.totalLiabilities],
            ['حقوق الملكية', sheet.equity.totalEquity],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl bg-white/15 p-3 text-center">
              <div className="text-lg font-black">{money(Number(value))} ج.م</div>
              <div className="text-xs text-emerald-100">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {!balanced && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          <AlertTriangle size={18} />
          دفتر الأستاذ غير متوازن بفارق {money(sheet.summary.ledgerImbalance)} ج.م؛ التقرير للقراءة فقط لحين تسوية القيود.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {rows.map((section) => (
          <section key={section.title} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <header className={`border-b p-4 ${section.tone}`}>
              <h3 className="flex items-center gap-2 font-bold">{section.icon}{section.title}</h3>
              <p className="text-xl font-black">{money(section.total)} ج.م</p>
            </header>
            <div className="space-y-2 p-4">
              {section.items.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-gray-100 py-2 text-sm">
                  <span className="text-gray-600">{label}</span>
                  <strong>{money(value)}</strong>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className={`rounded-2xl border p-4 text-center text-sm font-bold ${balanced ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
        الأصول ({money(sheet.assets.totalAssets)}) = الخصوم ({money(sheet.liabilities.totalLiabilities)}) + حقوق الملكية ({money(sheet.equity.totalEquity)})
        <div className="mt-1 text-xs font-normal">
          {balanced ? '✅ المعادلة المحاسبية متوازنة من القيود الفعلية.' : '❌ المعادلة غير متوازنة؛ لا تعتمد التقرير قبل التسوية.'}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-center text-sm sm:grid-cols-4">
        {[
          ['الإيرادات', sheet.summary.totalRevenue],
          ['المصروفات', sheet.summary.totalExpenses],
          ['الاستردادات', sheet.summary.totalRefunds],
          ['صافي المركز', sheet.summary.netPosition],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border bg-white p-3">
            <div className="text-gray-500">{label}</div>
            <strong>{money(Number(value))} ج.م</strong>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BalanceSheetTab;
