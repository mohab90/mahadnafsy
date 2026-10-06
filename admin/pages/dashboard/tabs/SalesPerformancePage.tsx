import { Suspense, lazy, type ComponentProps } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, CalendarDays, Target, Trophy, TrendingUp } from 'lucide-react';
import type { SalesTarget } from '../../../types';

const TeamDailyReport = lazy(() => import('./leads/TeamDailyReport').then(module => ({ default: module.TeamDailyReport })));
const CrmCoachingButton = lazy(() => import('./leads/CrmCoachingPanel').then(module => ({ default: module.CrmCoachingButton })));
const LeadsTab = lazy(() => import('./LeadsTab'));
const SalesHubTab = lazy(() => import('./SalesHubTab'));
const SalesTeamTab = lazy(() => import('./SalesTeamTab'));

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type LeadsTabProps = Omit<ComponentProps<typeof LeadsTab>, 'notify' | 'performanceOnly'>;

/**
 * «أداء المبيعات» — what were three screens and a tab, on one page:
 *
 *   «تاب اداء الفريق لازم يتشال من هنا ويكون صفحه لوحدة من برة القسم وادمج
 *   معاها صفحه مركز المبيعات وصفحه فريق المبيعات والتشغيل … دمج بذكاء».
 *
 * By the question each part answers, the day's first:
 *   الفريق النهارده   per rep for a day or a period: calls, the leads handed to
 *                     them (new and older, lead by lead), follow-ups, bookings,
 *                     money — the leads screen's «أداء الفريق» report
 *   الأداء والأهداف   conversion per rep against the month's target, the weekly
 *                     scorecard and the charts — the rest of that tab
 *   لوحة الفريق       the leaderboard, follow-ups and the team's posts — «مركز المبيعات»
 *   الشهر             the month's leads, conversions and revenue per rep — «فريق المبيعات والتشغيل»
 */
const SECTIONS = [
  { key: 'today', label: 'الفريق النهارده', icon: CalendarDays },
  { key: 'performance', label: 'الأداء والأهداف', icon: Target },
  { key: 'board', label: 'لوحة الفريق', icon: Trophy },
  { key: 'month', label: 'الشهر', icon: BarChart3 },
] as const;
type SectionKey = typeof SECTIONS[number]['key'];

const fallback = (
  <div className="flex items-center justify-center p-16">
    <span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
  </div>
);

export default function SalesPerformancePage({ notify, salesTargets, onOpenStaffProfile, leadsTabProps }: {
  notify: NotifyFn;
  salesTargets: SalesTarget[];
  onOpenStaffProfile?: (staffId: string) => void;
  leadsTabProps: LeadsTabProps;
}) {
  // In the address, so a link can open a section and a reload keeps it.
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') as SectionKey | null;
  const section: SectionKey = SECTIONS.some(item => item.key === requested) ? requested as SectionKey : 'today';
  const choose = (key: SectionKey) => setParams(current => {
    const next = new URLSearchParams(current);
    next.set('section', key);
    return next;
  }, { replace: true });

  return (
    <div className="space-y-4" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-l from-indigo-600 to-violet-700 p-4 text-white">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold"><TrendingUp size={22} /> أداء المبيعات</h2>
          <p className="mt-0.5 text-sm text-indigo-100">النهارده، الأهداف، الترتيب والشهر — كل السيلز في صفحة واحدة</p>
        </div>
        <Suspense fallback={null}><CrmCoachingButton notify={notify} /></Suspense>
      </header>

      <nav className="flex gap-1.5 overflow-x-auto rounded-xl bg-gray-100 p-1" role="tablist" aria-label="أقسام أداء المبيعات">
        {SECTIONS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" role="tab" aria-selected={section === key} onClick={() => choose(key)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-sm transition ${section === key
              ? 'bg-white font-bold text-indigo-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>

      <Suspense fallback={fallback}>
        {section === 'today' && <TeamDailyReport notify={notify} />}
        {section === 'performance' && <LeadsTab notify={notify} {...leadsTabProps} performanceOnly />}
        {section === 'board' && <SalesHubTab notify={notify} salesTargets={salesTargets} onOpenStaffProfile={onOpenStaffProfile} />}
        {section === 'month' && <SalesTeamTab notify={notify} salesTargets={salesTargets} onOpenStaffProfile={onOpenStaffProfile} />}
      </Suspense>
    </div>
  );
}
