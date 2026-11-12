import { Suspense, lazy, useCallback, useState } from 'react';
import { cairoDateOnly } from '../../../../../shared/cairoDate';
import { PERIOD_LABELS, periodQuery, type PeriodKey } from './managementFigures';

const EmployeeReportTab = lazy(() => import('./EmployeeReportTab'));
const BranchReportTab = lazy(() => import('./BranchReportTab'));

const TABS = [{ key: 'branches', label: 'تقرير الفروع' }, { key: 'employees', label: 'تقرير الموظفين' }] as const;

/**
 * «تقارير الإدارة» on «نظرة عامة»: a period switch and the two reports as tabs. Nothing is fetched until the section is opened and a tab is shown,
 * and each tab's code loads then. An account the server refuses (a rep, a collection officer, a branch it does not reach) never sees the section:
 * it disappears on the first refusal, with no message.
 */
export default function ManagementReportsSection() {
  const [opened, setOpened] = useState(false);
  const [refused, setRefused] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('branches');
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [from, setFrom] = useState(() => cairoDateOnly());
  const [to, setTo] = useState(() => cairoDateOnly());
  const onRefused = useCallback(() => setRefused(true), []);
  if (refused) return null;

  const query = periodQuery(period, from, to);
  const pill = (active: boolean) => `whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold ${active ? 'bg-primary-600 text-white' : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`;
  return (
    <section className="min-w-0 space-y-4" aria-label="تقارير الإدارة">
      <div className="flex items-center gap-3">
        <div className="h-8 w-1 rounded-full bg-gradient-to-b from-primary-500 to-violet-500" />
        <h2 className="text-xl font-extrabold text-gray-900">تقارير الإدارة</h2>
      </div>
      {!opened ? (
        <button type="button" onClick={() => setOpened(true)} className="w-full rounded-2xl border border-dashed border-primary-300 bg-primary-50/40 py-5 text-sm font-bold text-primary-700 hover:bg-primary-50">
          اعرض تقارير الفروع والموظفين
        </button>
      ) : (
        <div className="min-w-0 space-y-3 rounded-2xl border border-gray-200 bg-white p-3 sm:p-4">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="نوع التقرير">
            {TABS.map(item => <button key={item.key} role="tab" aria-selected={tab === item.key} type="button" className={pill(tab === item.key)} onClick={() => setTab(item.key)}>{item.label}</button>)}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="الفترة">
            {PERIOD_LABELS.map(item => <button key={item.key} type="button" aria-pressed={period === item.key} className={pill(period === item.key)} onClick={() => setPeriod(item.key)}>{item.label}</button>)}
            {period === 'custom' && (
              <span className="flex flex-wrap items-center gap-1 text-xs text-gray-600">
                من <input type="date" value={from} max={to} onChange={event => event.target.value && setFrom(event.target.value)} className="rounded-lg border border-gray-200 px-2 py-1" />
                إلى <input type="date" value={to} min={from} onChange={event => event.target.value && setTo(event.target.value)} className="rounded-lg border border-gray-200 px-2 py-1" />
              </span>
            )}
          </div>
          <Suspense fallback={<div className="flex justify-center py-10" role="status" aria-label="جاري التحميل"><div className="h-7 w-7 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" /></div>}>
            {tab === 'branches' ? <BranchReportTab query={query} onRefused={onRefused} /> : <EmployeeReportTab query={query} onRefused={onRefused} />}
          </Suspense>
        </div>
      )}
    </section>
  );
}
