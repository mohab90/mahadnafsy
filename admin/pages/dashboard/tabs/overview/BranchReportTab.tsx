import { useEffect, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download } from 'lucide-react';
import { downloadCsv } from '../../../../../shared/csv';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import ChangeBadge from './ChangeBadge';
import { branchCsv, count, isRefusal, money, percent, type BranchFigures, type BranchReport } from './managementFigures';

type IncomeLine = { key: 'bookingsEgp' | 'installmentsEgp' | 'certificatesEgp' | 'otherEgp'; label: string; hint: string };
const LINES: IncomeLine[] = [
  { key: 'bookingsEgp', label: 'الحجوزات', hint: 'فلوس أول دفعة كورس أو مسار لكل عميل على نفس الكورس (الدفع الكامل منها)' },
  { key: 'installmentsEgp', label: 'الأقساط', hint: 'فلوس الأقساط وأي دفعة بعد الحجز على كورس أو مسار العميل حاجزه' },
  { key: 'certificatesEgp', label: 'الشهادات', hint: 'فلوس الشهادات (تحصيل مش مبيعات)' },
  { key: 'otherEgp', label: 'أخرى', hint: 'كارنيهات وكتب واستشارات — اضغط تشوف كل نوع لوحده' },
];

function Headline({ line, branch, open, toggle }: { line: IncomeLine; branch: BranchFigures; open: boolean; toggle: () => void }) {
  const isOther = line.key === 'otherEgp';
  return (
    <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-3" title={line.hint}>
      <div className="text-xs font-bold text-gray-500">{line.label}</div>
      <div className="mt-0.5 text-lg font-extrabold tabular-nums text-gray-900">{money(branch[line.key])} <span className="text-xs font-medium text-gray-400">ج</span></div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-gray-400">
        <ChangeBadge vs={branch.vs[line.key]} /><span>قبلها {money(branch.vs[line.key].before)}</span>
      </div>
      {isOther && (
        <>
          <button type="button" onClick={toggle} aria-expanded={open} className="mt-1 text-[11px] font-bold text-primary-700 hover:underline">{open ? 'اخفي التفاصيل' : 'التفاصيل'}</button>
          {open && (
            <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
              {branch.other.length === 0 ? <li className="text-gray-400">مفيش</li> : branch.other.map(item => <li key={item.kind} className="flex justify-between gap-2"><span>{item.label}</span><span className="tabular-nums">{money(item.egp)}</span></li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function BranchCard({ branch }: { branch: BranchFigures }) {
  const [openOther, setOpenOther] = useState(false);
  const stat = (label: string, value: string, extra?: React.ReactNode) => (
    <div className="min-w-0"><div className="text-[11px] text-gray-500">{label}</div><div className="text-sm font-bold tabular-nums text-gray-900">{value}</div>{extra}</div>
  );
  return (
    <article className="min-w-0 space-y-3 rounded-2xl border border-gray-200 bg-gray-50/60 p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-base font-extrabold text-gray-900">{branch.label}</h4>
        <div className="text-sm text-gray-600">
          الدخل الإجمالي <strong className="tabular-nums text-gray-900">{money(branch.incomeEgp)} ج</strong> <ChangeBadge vs={branch.vs.incomeEgp} />
          <span className="mr-1 text-[11px] text-gray-400">قبلها {money(branch.vs.incomeEgp.before)}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {LINES.map(line => <Headline key={line.key} line={line} branch={branch} open={openOther} toggle={() => setOpenOther(value => !value)} />)}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {stat('المصاريف', `${money(branch.expensesEgp)} ج`, <ChangeBadge vs={branch.vs.expensesEgp} lowerIsBetter />)}
        {stat('الصافي', `${money(branch.netEgp)} ج`, <ChangeBadge vs={branch.vs.netEgp} />)}
        {stat('مسترد (مش داخل في الدخل)', `${money(branch.refundsEgp)} ج`)}
        {stat('حجوزات', count(branch.bookings), <ChangeBadge vs={branch.vs.bookings} />)}
        {stat('عملاء جدد', count(branch.newClients), <ChangeBadge vs={branch.vs.newClients} />)}
        {stat('عملاء قدام حجزوا جديد', `${count(branch.returningClients)} (${count(branch.returningBookings)} حجز)`, <ChangeBadge vs={branch.vs.returningClients} />)}
        {stat('متوسط الحجز', branch.avgTicketEgp === null ? '—' : `${money(branch.avgTicketEgp)} ج`)}
        {stat('أقساط مستحقة / اتحصّلت', `${count(branch.instalmentsDue)} / ${count(branch.instalmentsPaid)}`, <span className="text-[11px] text-gray-400">نسبة التحصيل {percent(branch.collectionRatePct)}</span>)}
      </div>
      {branch.expensesByCategory.length > 0 && (
        <p className="text-xs text-gray-600">المصاريف: {branch.expensesByCategory.map(item => `${item.label} ${money(item.egp)}`).join(' · ')}</p>
      )}
      {branch.topCourses.length > 0 && (
        <p className="text-xs text-gray-600">أعلى كورسات: {branch.topCourses.map(item => `${item.title} ${money(item.egp)}`).join(' · ')}</p>
      )}
      {branch.unconverted.payments > 0 && (
        <p className="text-xs text-amber-700">فيه {count(branch.unconverted.payments)} دفعة بعملة أجنبية من غير قيمة بالجنيه ({Object.entries(branch.unconverted.byCurrency).map(([currency, amount]) => `${money(amount)} ${currency}`).join('، ')}) — مش داخلة في الأرقام دي.</p>
      )}
    </article>
  );
}

function SeriesChart({ report }: { report: BranchReport }) {
  const [granularity, setGranularity] = useState<'weekly' | 'monthly'>('weekly');
  const [which, setWhich] = useState('TOTAL');
  const series = report.series?.[granularity];
  if (!series) return null;
  const data = series.map(point => {
    const cell = which === 'TOTAL' ? point.total : point.branches[which] ?? point.total;
    return { label: granularity === 'weekly' ? point.from.slice(5) : point.label, income: cell.incomeEgp, expenses: cell.expensesEgp, net: cell.netEgp };
  });
  const tab = (active: boolean) => `rounded-lg px-3 py-1 text-xs font-bold ${active ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`;
  return (
    <section className="min-w-0 space-y-2 rounded-2xl border border-gray-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-extrabold text-gray-900">الدخل والمصاريف والصافي</h4>
        <button type="button" className={tab(granularity === 'weekly')} onClick={() => setGranularity('weekly')}>آخر ٨ أسابيع</button>
        <button type="button" className={tab(granularity === 'monthly')} onClick={() => setGranularity('monthly')}>آخر ٦ شهور</button>
        <select value={which} onChange={event => setWhich(event.target.value)} className="mr-auto rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs" aria-label="الفرع">
          <option value="TOTAL">الإجمالي</option>
          {report.branches.map(branch => <option key={branch.key} value={branch.key}>{branch.label}</option>)}
        </select>
      </div>
      <div className="h-64 w-full min-w-0" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} width={48} />
            <Tooltip formatter={(value) => `${money(Number(value))} ج`} />
            <Legend formatter={name => ({ income: 'الدخل', expenses: 'المصاريف', net: 'الصافي' } as Record<string, string>)[name] ?? name} />
            <Bar dataKey="income" fill="#10b981" radius={[3, 3, 0, 0]} />
            <Bar dataKey="expenses" fill="#f43f5e" radius={[3, 3, 0, 0]} />
            <Line dataKey="net" stroke="#6366f1" strokeWidth={2} dot={false} type="monotone" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/** «تقرير الفروع»: the four income lines per branch and in total, expenses, net, clients, instalments, the previous period beside each, and the series. */
export default function BranchReportTab({ query, onRefused }: { query: string; onRefused: () => void }) {
  const [report, setReport] = useState<BranchReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setReport(null); setError(null);
    mysqlAdmin.getManagementBranches(query)
      .then(next => { if (current) setReport(next); })
      .catch((reason: unknown) => {
        if (!current) return;
        if (isRefusal(reason)) onRefused(); else setError('تعذر تحميل تقرير الفروع — جرّب تاني');
      });
    return () => { current = false; };
  }, [query, onRefused]);

  if (error) return <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>;
  if (!report) return <div className="flex justify-center py-10" role="status" aria-label="جاري التحميل"><div className="h-7 w-7 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" /></div>;
  const exportCsv = () => downloadCsv(`branches_${report.period.from}_${report.period.to}`, branchCsv(report));
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">{report.period.from === report.period.to ? report.period.from : `${report.period.from} ← ${report.period.to}`} · قبلها: {report.period.previous.from} ← {report.period.previous.to}</p>
        <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50"><Download size={13} />تصدير CSV</button>
      </div>
      {report.branches.length > 1 && <BranchCard branch={report.total} />}
      {report.branches.map(branch => <BranchCard key={branch.key} branch={branch} />)}
      <SeriesChart report={report} />
    </div>
  );
}
