// «التقرير المالي» — one period read back as a statement, beside the period
// before it: what came in, what went out, what is left, what the team is still
// owed, where the money came from and went, and who still owes us.
// The figures are GET /api/admin/finance/statement (api/lib/financeStatement.js).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Download, Minus, RefreshCw } from 'lucide-react';
import { cairoDateOnly, cairoDaysAgo, cairoMonthStart } from '../../../../../shared/cairoDate';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { BRANCH_LABELS_AR, type BranchKey } from '../../../../constants/branches';
import { exportToExcel } from '../../../../lib/exportUtils';

type Totals = {
  collected: number; payments: number; payingClients: number; averageTicket: number;
  refunds: number; refundsCount: number; expenses: number; expensesCount: number;
  operating: number; margin: number; teamAccrued: number; teamPending: number; afterTeam: number;
};
type Ranked = { key: string; amount: number; count: number };
type Statement = {
  period: { from: string; to: string; days: number };
  previousPeriod: { from: string; to: string };
  branch: string | null;
  instructorFeesIncluded: boolean;
  current: Totals;
  previous: Totals;
  byBranch: Ranked[];
  byType: Ranked[];
  byMethod: Ranked[];
  topItems: { name: string; kind: string; amount: number; count: number; clients: number }[];
  expensesByCategory: Ranked[];
  series: { unit: 'day' | 'month'; points: { key: string; collected: number; expenses: number }[] };
  ledger: { revenue: number; expenses: number; net: number };
  receivables: { total: number; clients: number; top: { name: string; code: string | null; outstanding: number }[] };
};

const TYPE_LABEL: Record<string, string> = {
  COURSE: 'كورسات', BUNDLE: 'مسارات', CERTIFICATE: 'شهادات', CONSULTATION: 'استشارات',
  BOOK: 'كتب', CARNEH: 'كارنيهات', OTHER: 'أخرى',
};
const EXPENSE_LABEL: Record<string, string> = {
  SALARIES: 'رواتب', RENT: 'إيجار', UTILITIES: 'مرافق', SOFTWARE: 'برمجيات', MARKETING: 'تسويق',
  EQUIPMENT: 'معدات', MAINTENANCE: 'صيانة', TRAVEL: 'سفر وانتقالات', OTHER: 'أخرى',
};
const branchLabel = (key: string) => BRANCH_LABELS_AR[key as BranchKey] || key || 'بدون فرع';

// `|| 0` turns -0 into 0: a period with no refunds read «-0 ج.م».
const egp = (value: number) => `${(Math.round(value) || 0).toLocaleString('ar-EG-u-nu-latn')} ج.م`;
const count = (value: number) => value.toLocaleString('ar-EG-u-nu-latn');
const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Change against the previous period, as a percentage, or null when there was nothing before. */
const change = (now: number, before: number) => (before ? ((now - before) / Math.abs(before)) * 100 : null);

function Delta({ now, before, goodWhenUp = true }: { now: number; before: number; goodWhenUp?: boolean }) {
  const pct = change(now, before);
  if (pct === null) return <span className="text-[11px] text-gray-400">لا مقارنة</span>;
  const up = pct > 0.5; const down = pct < -0.5;
  const good = (up && goodWhenUp) || (down && !goodWhenUp);
  const tone = !up && !down ? 'text-gray-500' : good ? 'text-emerald-600' : 'text-red-600';
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums ${tone}`} dir="ltr">
      <Icon size={12} />{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

type Preset = 'month' | 'last_month' | 'quarter' | 'year' | 'custom';
function rangeFor(preset: Preset): { from: string; to: string } {
  const today = cairoDateOnly();
  if (preset === 'last_month') {
    // The day before this month's first, counted on the Cairo calendar.
    return { from: cairoMonthStart(1), to: cairoDaysAgo(1, `${cairoMonthStart(0)}T12:00:00Z`) };
  }
  if (preset === 'quarter') return { from: cairoMonthStart(2), to: today };
  if (preset === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: cairoMonthStart(0), to: today };
}

/** A list of amounts as bars, each with its share of the whole. */
function ShareBars({ rows, label, tone }: { rows: Ranked[]; label: (key: string) => string; tone: string }) {
  const total = rows.reduce((sum, r) => sum + Math.max(r.amount, 0), 0);
  if (!rows.length) return <p className="py-6 text-center text-xs text-gray-400">لا يوجد في الفترة دي</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map(row => {
        const share = total > 0 ? (Math.max(row.amount, 0) / total) * 100 : 0;
        return (
          <li key={row.key}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-bold text-gray-700 truncate">{label(row.key)}</span>
              <span className="tabular-nums text-gray-900 font-bold whitespace-nowrap">{egp(row.amount)} <span className="font-normal text-gray-400">· {share.toFixed(0)}%</span></span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full rounded-full ${tone}`} style={{ width: `${share}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Collected and spent per day or month, to one scale. */
function TrendChart({ series }: { series: Statement['series'] }) {
  const points = series.points;
  const max = Math.max(1, ...points.map(p => Math.max(p.collected, p.expenses)));
  const width = 720; const height = 180; const pad = 24;
  const slot = (width - pad) / Math.max(points.length, 1);
  const bar = Math.max(2, Math.min(18, slot / 2.6));
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);
  const ticks = [0, 0.5, 1].map(f => f * max);
  const labelEvery = Math.ceil(points.length / 10);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[520px]" role="img" aria-label="المحصّل والمصروف على مدار الفترة">
        {ticks.map(t => (
          <g key={t}>
            <line x1={pad} x2={width} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeDasharray={t ? '3 3' : undefined} />
            <text x={0} y={y(t) + 3} fontSize="9" fill="#9ca3af">{t >= 1000 ? `${Math.round(t / 1000)}k` : Math.round(t)}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = pad + i * slot + slot / 2;
          return (
            <g key={p.key}>
              <rect x={x - bar} y={y(p.collected)} width={bar} height={height - pad - y(p.collected)} rx="1.5" fill="#10b981"><title>{`${p.key} — محصّل ${egp(p.collected)}`}</title></rect>
              <rect x={x} y={y(p.expenses)} width={bar} height={height - pad - y(p.expenses)} rx="1.5" fill="#f87171"><title>{`${p.key} — مصروف ${egp(p.expenses)}`}</title></rect>
              {i % labelEvery === 0 && (
                <text x={x} y={height - 8} fontSize="9" fill="#6b7280" textAnchor="middle">{series.unit === 'day' ? p.key.slice(8) : p.key.slice(5)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function FinancialStatementPanel({ branchFilter, onOpen }: {
  /** A branch's books: 'daqqi' / 'tagamoa'. */
  branchFilter?: string;
  /** Opens another finance screen (the receivables list). */
  onOpen?: (tab: 'outstanding') => void;
}) {
  const fixedBranch = branchFilter ? branchFilter.toUpperCase() : '';
  const [preset, setPreset] = useState<Preset>('month');
  const [range, setRange] = useState(() => rangeFor('month'));
  const [branch, setBranch] = useState(fixedBranch);
  const [data, setData] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const q = new URLSearchParams({ from: range.from, to: range.to });
      if (branch) q.set('branch', branch);
      setData(await mysqlAdmin.adminGet<Statement>(`/admin/finance/statement?${q}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل التقرير');
    } finally { setLoading(false); }
  }, [range.from, range.to, branch]);
  useEffect(() => { void load(); }, [load]);

  const choose = (next: Preset) => { setPreset(next); if (next !== 'custom') setRange(rangeFor(next)); };

  const lines = useMemo(() => {
    if (!data) return [];
    const c = data.current; const p = data.previous;
    return [
      { label: 'المحصّل من العملاء', now: c.collected, before: p.collected, kind: 'in' as const, note: `${count(c.payments)} دفعة من ${count(c.payingClients)} عميل` },
      { label: '(−) المرتجعات', now: -c.refunds, before: -p.refunds, kind: 'out' as const, note: c.refundsCount ? `${count(c.refundsCount)} مرتجع` : '' },
      { label: '(−) المصروفات', now: -c.expenses, before: -p.expenses, kind: 'out' as const, note: c.expensesCount ? `${count(c.expensesCount)} بند` : '' },
      { label: 'نتيجة التشغيل', now: c.operating, before: p.operating, kind: 'total' as const, note: c.collected ? `هامش ${c.margin.toFixed(1)}%` : '' },
      { label: '(−) مستحقات الفريق لسه ما اتصرفتش', now: -c.teamPending, before: -p.teamPending, kind: 'out' as const, note: data.instructorFeesIncluded ? 'عمولات ومكافآت حجز وأتعاب محاضرين' : 'عمولات ومكافآت حجز (أتعاب المحاضرين على مستوى المعهد)' },
      { label: 'النتيجة بعد مستحقات الفريق', now: c.afterTeam, before: p.afterTeam, kind: 'grand' as const, note: '' },
    ];
  }, [data]);

  const exportExcel = () => {
    if (!data) return;
    const rows = lines.map(l => ({ line: l.label, now: Math.round(l.now), before: Math.round(l.before), change: change(l.now, l.before)?.toFixed(1) ?? '' }));
    void exportToExcel(rows, [
      { header: 'البند', key: 'line', width: 34 },
      { header: `${data.period.from} → ${data.period.to}`, key: 'now', width: 18 },
      { header: `${data.previousPeriod.from} → ${data.previousPeriod.to}`, key: 'before', width: 18 },
      { header: 'التغيّر %', key: 'change', width: 10 },
    ], { filename: `finance-statement-${data.period.from}-${data.period.to}`, title: 'التقرير المالي' });
  };

  const c = data?.current;
  const p = data?.previous;
  const ledgerGap = data ? data.current.collected - data.current.refunds - data.ledger.revenue : 0;

  return (
    <div className="space-y-4" dir="rtl" data-testid="finance-statement">
      {/* Period */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1">
          {([['month', 'الشهر ده'], ['last_month', 'الشهر اللي فات'], ['quarter', 'آخر 3 شهور'], ['year', 'السنة دي'], ['custom', 'فترة مخصصة']] as [Preset, string][]).map(([key, label]) => (
            <button key={key} type="button" onClick={() => choose(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${preset === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>{label}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-1.5 text-xs">
            <input type="date" value={range.from} max={range.to} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="rounded-lg border border-gray-200 px-2 py-1.5" />
            <span className="text-gray-400">←</span>
            <input type="date" value={range.to} min={range.from} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="rounded-lg border border-gray-200 px-2 py-1.5" />
          </div>
        )}
        {!fixedBranch && (
          <select value={branch} onChange={e => setBranch(e.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700">
            <option value="">كل الفروع</option>
            {(['DAQQI', 'TAGAMOA', 'ONLINE_EGYPT', 'ONLINE_SAUDI', 'ONLINE_ABROAD'] as BranchKey[]).map(key => <option key={key} value={key}>{BRANCH_LABELS_AR[key]}</option>)}
          </select>
        )}
        <div className="mr-auto flex gap-2">
          <button type="button" onClick={() => void load()} className="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
          <button type="button" onClick={exportExcel} disabled={!data} className="flex items-center gap-1 rounded-xl bg-gray-900 px-3 py-2 text-xs font-bold text-white hover:bg-gray-800 disabled:opacity-40">
            <Download size={13} /> Excel
          </button>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {!data && loading && <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-400">جاري تجهيز التقرير…</div>}

      {data && c && p && (
        <>
          {/* Headline figures */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: 'المحصّل', value: c.collected, before: p.collected, up: true, sub: `متوسط الدفعة ${egp(c.averageTicket)}` },
              { label: 'المصروفات والمرتجعات', value: c.expenses + c.refunds, before: p.expenses + p.refunds, up: false, sub: `مصروفات ${egp(c.expenses)}` },
              { label: 'نتيجة التشغيل', value: c.operating, before: p.operating, up: true, sub: c.collected ? `هامش ${c.margin.toFixed(1)}%` : '—' },
              { label: 'مديونيات على العملاء', value: data.receivables.total, before: data.receivables.total, up: false, sub: `${count(data.receivables.clients)} عميل عليه فلوس` },
            ].map((kpi, i) => (
              <div key={kpi.label} className="rounded-2xl border border-gray-200 bg-white p-4">
                <p className="text-xs font-bold text-gray-500">{kpi.label}</p>
                <p className={`mt-1 text-xl font-black tabular-nums ${kpi.value < 0 ? 'text-red-600' : 'text-gray-900'}`}>{egp(kpi.value)}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-gray-500 truncate">{kpi.sub}</span>
                  {i < 3 && <Delta now={kpi.value} before={kpi.before} goodWhenUp={kpi.up} />}
                </div>
              </div>
            ))}
          </div>

          {/* The statement */}
          <section className="rounded-2xl border border-gray-200 bg-white">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 px-5 py-4">
              <div>
                <h3 className="text-base font-extrabold text-gray-900">قائمة نتيجة الفترة{data.branch ? ` — ${branchLabel(data.branch)}` : ''}</h3>
                <p className="text-xs text-gray-500">{shortDate(data.period.from)} – {shortDate(data.period.to)} ({count(data.period.days)} يوم) · مقارنة بـ {shortDate(data.previousPeriod.from)} – {shortDate(data.previousPeriod.to)}</p>
              </div>
              <span className="text-[11px] text-gray-400">بالجنيه المصري</span>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-[11px] font-bold text-gray-500">
                    <th className="px-5 py-2 text-right">البند</th>
                    <th className="px-3 py-2 text-left">الفترة دي</th>
                    <th className="px-3 py-2 text-left">الفترة اللي قبلها</th>
                    <th className="px-5 py-2 text-left">التغيّر</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => (
                    <tr key={line.label} className={line.kind === 'grand' ? 'bg-gray-900 text-white' : line.kind === 'total' ? 'bg-gray-50 font-bold' : 'border-t border-gray-100'}>
                      <td className="px-5 py-2.5">
                        <span className={line.kind === 'grand' || line.kind === 'total' ? 'font-extrabold' : 'text-gray-700'}>{line.label}</span>
                        {line.note && <span className={`block text-[11px] ${line.kind === 'grand' ? 'text-gray-300' : 'text-gray-400'}`}>{line.note}</span>}
                      </td>
                      <td className={`px-3 py-2.5 text-left tabular-nums font-bold ${line.kind === 'grand' ? '' : line.now < 0 ? 'text-red-600' : 'text-gray-900'}`} dir="ltr">{egp(line.now)}</td>
                      <td className={`px-3 py-2.5 text-left tabular-nums ${line.kind === 'grand' ? 'text-gray-300' : 'text-gray-500'}`} dir="ltr">{egp(line.before)}</td>
                      <td className="px-5 py-2.5 text-left"><Delta now={line.now} before={line.before} goodWhenUp /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-gray-100 px-5 py-3 text-[11px] leading-5 text-gray-500">
              المحصّل = الدفعات المؤكدة بالجنيه. مستحقات الفريق = العمولات ومكافآت الحجز{data.instructorFeesIncluded ? ' وأتعاب المحاضرين' : ''} اللي اتسجلت في الفترة ولسه ما دخلتش المرتبات — اللي اتصرف منها جوه المصروفات بالفعل.
              {' '}الدفاتر بتقول: إيرادات {egp(data.ledger.revenue)} ومصروفات {egp(data.ledger.expenses)}
              {Math.abs(ledgerGap) >= 1 && <> — <b className="text-amber-700">فرق {egp(ledgerGap)} بين التحصيل والدفاتر</b> (دفعات أو مرتجعات ما اتقيدتش، أو قيود يدوية)</>}.
            </p>
          </section>

          {/* Trend */}
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-extrabold text-gray-900">المحصّل والمصروف {data.series.unit === 'day' ? 'يوم بيوم' : 'شهر بشهر'}</h3>
              <div className="flex gap-3 text-[11px] text-gray-500">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" />محصّل</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-400" />مصروف</span>
              </div>
            </div>
            <TrendChart series={data.series} />
          </section>

          {/* Where it came from, where it went */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <h3 className="mb-3 text-sm font-extrabold text-gray-900">الإيراد حسب الفرع</h3>
              <ShareBars rows={data.byBranch} label={branchLabel} tone="bg-emerald-500" />
            </section>
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <h3 className="mb-3 text-sm font-extrabold text-gray-900">الإيراد حسب النوع</h3>
              <ShareBars rows={data.byType} label={key => TYPE_LABEL[key] || key} tone="bg-sky-500" />
              <h3 className="mb-3 mt-5 text-sm font-extrabold text-gray-900">حسب طريقة الدفع</h3>
              <ShareBars rows={data.byMethod.slice(0, 6)} label={key => key} tone="bg-indigo-400" />
            </section>
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <h3 className="mb-3 text-sm font-extrabold text-gray-900">المصروفات حسب البند</h3>
              <ShareBars rows={data.expensesByCategory} label={key => EXPENSE_LABEL[key] || key} tone="bg-red-400" />
            </section>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <section className="rounded-2xl border border-gray-200 bg-white lg:col-span-3">
              <h3 className="border-b border-gray-100 px-5 py-3 text-sm font-extrabold text-gray-900">أعلى 10 كورسات ومسارات دخلاً</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-xs">
                  <thead><tr className="text-gray-500"><th className="px-5 py-2 text-right">#</th><th className="py-2 text-right">الاسم</th><th className="px-3 py-2 text-left">عملاء</th><th className="px-5 py-2 text-left">المحصّل</th></tr></thead>
                  <tbody>
                    {data.topItems.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-gray-400">لا يوجد</td></tr>}
                    {data.topItems.map((item, i) => (
                      <tr key={`${item.kind}-${item.name}`} className="border-t border-gray-100">
                        <td className="px-5 py-2 text-gray-400 tabular-nums">{i + 1}</td>
                        <td className="py-2 font-bold text-gray-800">
                          {/* A payment tied to no course or track is named by its type alone. */}
                          {TYPE_LABEL[item.name] ? `${TYPE_LABEL[item.name]} غير مربوطة بكورس` : item.name}
                          <span className="font-normal text-gray-400"> · {TYPE_LABEL[item.kind] || item.kind}</span>
                        </td>
                        <td className="px-3 py-2 text-left tabular-nums text-gray-600">{count(item.clients)}</td>
                        <td className="px-5 py-2 text-left tabular-nums font-bold text-gray-900">{egp(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="rounded-2xl border border-gray-200 bg-white lg:col-span-2">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
                <h3 className="text-sm font-extrabold text-gray-900">أكبر المديونيات</h3>
                {onOpen && <button type="button" onClick={() => onOpen('outstanding')} className="text-xs font-bold text-primary-700">كل المديونيات ←</button>}
              </div>
              <ul className="divide-y divide-gray-100">
                {data.receivables.top.length === 0 && <li className="py-6 text-center text-xs text-gray-400">مفيش مديونيات</li>}
                {data.receivables.top.map(row => (
                  <li key={`${row.code}-${row.name}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-xs">
                    <span className="font-bold text-gray-800 truncate">{row.name}{row.code && <span className="font-normal text-gray-400"> · {row.code}</span>}</span>
                    <span className="tabular-nums font-bold text-amber-700 whitespace-nowrap">{egp(row.outstanding)}</span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-gray-100 px-5 py-2.5 text-[11px] text-gray-500">الإجمالي {egp(data.receivables.total)} على {count(data.receivables.clients)} عميل — من أول التعامل، مش الفترة دي بس.</p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
