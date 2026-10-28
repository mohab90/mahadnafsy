import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Bell, CalendarClock, ClipboardList, Globe2, GraduationCap, LayoutDashboard, LogOut, MessageCircle, Radio, Star, UserRound, Video, Wallet,
} from 'lucide-react';
import { LecturerCommunity } from './lecturer/LecturerCommunity';
import { LecturerConsultations } from './lecturer/LecturerConsultations';
import { LecturerEarnings } from './lecturer/LecturerEarnings';
import { LecturerFeedback } from './lecturer/LecturerFeedback';
import { LecturerHours } from './lecturer/LecturerHours';
import { LecturerLives } from './lecturer/LecturerLives';
import { LecturerOverview } from './lecturer/LecturerOverview';
import { LecturerProfile } from './lecturer/LecturerProfile';
import { LecturerRequests } from './lecturer/LecturerRequests';
import { LecturerStudents } from './lecturer/LecturerStudents';
import { errorText, lecturerApi, money, type LecturerNotification, type Overview } from './lecturer/lecturerApi';
import { Card, Empty, Loading } from './lecturer/ui';
import { cairoDateTime } from '../../shared/cairoDate';
import { useSiteData } from '../context/SiteDataContext';

// «حساب محاضر» (25 Oct 2026), redesigned on 26 Oct: one place for a lecturer or consultant — the lives they schedule, their weekly
// consultation hours, the consultations booked with them, their ratings, students, earnings, their own requests (permission, leave,
// advance), the community and their profile. It is the whole of their account: the dashboard's course and content pages are not theirs.
// Everything it shows is the signed-in lecturer's own (api/routes/lecturer-portal.js).

type TabDef = { id: string; label: string; icon: typeof Video; needs?: 'consultant' };
const GROUPS: Array<{ title: string; tabs: TabDef[] }> = [
  {
    title: 'شغلي',
    tabs: [
      { id: 'overview', label: 'الرئيسية', icon: LayoutDashboard },
      { id: 'lives', label: 'اللايفات', icon: Video },
      { id: 'hours', label: 'مواعيد الاستشارات', icon: CalendarClock, needs: 'consultant' },
      { id: 'consultations', label: 'الاستشارات', icon: MessageCircle, needs: 'consultant' },
    ],
  },
  {
    title: 'نتايجي',
    tabs: [
      { id: 'feedback', label: 'التقييمات', icon: Star },
      { id: 'students', label: 'طلابي', icon: GraduationCap },
      { id: 'earnings', label: 'الأرباح', icon: Wallet },
    ],
  },
  {
    title: 'حسابي',
    tabs: [
      { id: 'requests', label: 'طلباتي (إذن · إجازة · سلفة)', icon: ClipboardList },
      { id: 'notifications', label: 'الإشعارات', icon: Bell },
      { id: 'community', label: 'المجتمع', icon: Globe2 },
      { id: 'profile', label: 'ملفي', icon: UserRound },
    ],
  },
];
const ALL_TABS = GROUPS.flatMap(group => group.tabs);

type Toast = { type: 'success' | 'error' | 'info'; text: string } | null;

function Notifications({ notify, onRead }: { notify: (type: 'success' | 'error' | 'info', text: string) => void; onRead: () => void }) {
  const [items, setItems] = useState<LecturerNotification[] | null>(null);
  useEffect(() => {
    lecturerApi.notifications().then(setItems).catch(error => { notify('error', errorText(error)); setItems([]); });
  }, [notify]);
  const readAll = async () => {
    try { await lecturerApi.readNotifications(); setItems(current => (current || []).map(item => ({ ...item, read: true }))); onRead(); } catch (error) { notify('error', errorText(error)); }
  };
  if (!items) return <Loading />;
  return (
    <Card title="الإشعارات" icon={<Bell size={18} className="text-primary-600" />}
      actions={items.some(item => !item.read) ? <button type="button" onClick={() => void readAll()} className="text-xs font-bold text-primary-700 hover:underline">علّم الكل مقروء</button> : undefined}>
      {items.length === 0 ? <Empty>مفيش إشعارات. أي استشارة جديدة هتظهر هنا وتوصلك كمان على الواتساب.</Empty> : (
        <ul className="space-y-2">
          {items.map(item => (
            <li key={item.id} className={`rounded-2xl border p-3 text-sm ${item.read ? 'border-gray-100 bg-gray-50/60' : 'border-primary-200 bg-primary-50/60'}`}>
              <p className="font-bold text-gray-900">{item.title}</p>
              <p className="text-xs text-gray-600">{item.message}</p>
              <p className="mt-1 text-[10px] text-gray-400">{cairoDateTime(item.at)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** What this login is: the jobs it holds, said plainly at the top of every page. */
function JobChips({ overview }: { overview: Overview }) {
  const chips = [
    overview.capabilities.lecturer && { text: 'محاضر', cls: 'bg-violet-100 text-violet-800' },
    overview.capabilities.consultant && { text: 'استشاري', cls: 'bg-emerald-100 text-emerald-800' },
    overview.capabilities.branchRounds && { text: 'محاضرات الفرع', cls: 'bg-amber-100 text-amber-800' },
  ].filter(Boolean) as Array<{ text: string; cls: string }>;
  return <div className="flex flex-wrap gap-1.5">{chips.map(chip => <span key={chip.text} className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${chip.cls}`}>{chip.text}</span>)}</div>;
}

export default function LecturerPortal() {
  const [params, setParams] = useSearchParams();
  const { logout } = useSiteData();
  const requested = params.get('tab');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [denied, setDenied] = useState('');
  const [toast, setToast] = useState<Toast>(null);

  const notify = useCallback((type: 'success' | 'error' | 'info', text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(current => (current?.text === text ? null : current)), 5000);
  }, []);

  const loadOverview = useCallback(() => {
    lecturerApi.overview().then(setOverview).catch(error => setDenied(errorText(error, 'الصفحة دي لحسابات المحاضرين والمستشارين بس')));
  }, []);
  useEffect(() => { loadOverview(); }, [loadOverview]);

  const open = (next: string) => setParams({ tab: next });

  if (denied) {
    return (
      <div className="grid min-h-screen place-items-center bg-gray-50 p-6" dir="rtl">
        <div className="max-w-md space-y-3 rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <UserRound size={30} className="mx-auto text-gray-400" />
          <h1 className="text-xl font-extrabold text-gray-900">بوابة المحاضر</h1>
          <p className="text-sm text-gray-600">{denied}</p>
          <Link to="/" className="inline-block text-sm font-bold text-primary-700 hover:underline">الرجوع للوحة التحكم</Link>
        </div>
      </div>
    );
  }
  if (!overview) return <div className="min-h-screen bg-gray-50"><Loading /></div>;

  const consultant = overview.capabilities.consultant || Boolean(overview.profile.consultation);
  const groups = GROUPS.map(group => ({ ...group, tabs: group.tabs.filter(item => item.needs !== 'consultant' || consultant) }));
  const tab = ALL_TABS.some(item => item.id === requested) ? (requested as string) : 'overview';
  const mine = overview.earnings;

  return (
    <div className="min-h-screen bg-gray-50 pb-16" dir="rtl">
      {/* The identity strip: who, which jobs, and the three things worth a glance before anything else. */}
      <header className="bg-gradient-to-l from-primary-700 via-primary-600 to-primary-500 text-white">
        <div className="container mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15 text-xl font-extrabold ring-1 ring-white/30">{overview.profile.name.trim().charAt(0) || 'د'}</div>
            <div className="space-y-1.5">
              <h1 className="text-xl font-extrabold">أهلاً د. {overview.profile.name}</h1>
              <JobChips overview={overview} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {overview.lives.liveNow > 0 && (
              <button type="button" onClick={() => open('lives')} className="inline-flex items-center gap-1.5 rounded-xl bg-red-500 px-3 py-2 text-xs font-bold ring-1 ring-white/40"><Radio size={14} className="animate-pulse" /> عندك لايف شغال</button>
            )}
            <div className="rounded-xl bg-white/15 px-3 py-2 text-xs ring-1 ring-white/25">
              <span className="opacity-80">مستحقات معتمدة</span> <b className="mr-1 text-base">{money(mine.approved)}</b>
            </div>
            <div className="rounded-xl bg-white/15 px-3 py-2 text-xs ring-1 ring-white/25">
              <span className="opacity-80">في الانتظار</span> <b className="mr-1 text-base">{money(mine.waiting)}</b>
            </div>
            <button type="button" onClick={() => logout()} className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold ring-1 ring-white/25 hover:bg-white/20"><LogOut size={14} /> خروج</button>
          </div>
        </div>
      </header>

      <div className="container mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[230px_1fr]">
        <nav className="lg:sticky lg:top-4 lg:self-start" aria-label="أقسام البوابة">
          {/* A phone gets one scrolling row; a desktop a grouped side menu. */}
          <div className="flex gap-1 overflow-x-auto pb-1 lg:hidden">
            {groups.flatMap(group => group.tabs).map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => open(id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition ${tab === id ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'}`}>
                <Icon size={15} /> {label.split(' (')[0]}
                {id === 'notifications' && overview.unreadNotifications > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[10px] text-white">{overview.unreadNotifications}</span>}
              </button>
            ))}
          </div>
          <div className="hidden space-y-4 rounded-3xl border border-gray-200 bg-white p-3 shadow-sm lg:block">
            {groups.map(group => (
              <div key={group.title}>
                <p className="px-3 pb-1 text-[11px] font-extrabold text-gray-400">{group.title}</p>
                <div className="space-y-0.5">
                  {group.tabs.map(({ id, label, icon: Icon }) => (
                    <button key={id} type="button" onClick={() => open(id)}
                      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-right text-sm font-bold transition ${tab === id ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200' : 'text-gray-600 hover:bg-gray-50'}`}>
                      <Icon size={16} /> <span className="flex-1">{label}</span>
                      {id === 'notifications' && overview.unreadNotifications > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[10px] text-white">{overview.unreadNotifications}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <main className="min-w-0">
          {tab === 'overview' && <LecturerOverview notify={notify} onOpen={open} />}
          {tab === 'lives' && <LecturerLives notify={notify} />}
          {tab === 'hours' && <LecturerHours notify={notify} />}
          {tab === 'consultations' && <LecturerConsultations notify={notify} systemMeetings={overview.capabilities.systemMeetings} />}
          {tab === 'feedback' && <LecturerFeedback notify={notify} />}
          {tab === 'students' && <LecturerStudents notify={notify} />}
          {tab === 'earnings' && <LecturerEarnings notify={notify} />}
          {tab === 'requests' && <LecturerRequests notify={notify} />}
          {tab === 'community' && <LecturerCommunity notify={notify} name={overview.profile.name} />}
          {tab === 'notifications' && <Notifications notify={notify} onRead={loadOverview} />}
          {tab === 'profile' && <LecturerProfile notify={notify} />}
        </main>
      </div>

      {toast && (
        <div role="status" className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-lg ${toast.type === 'error' ? 'bg-red-600' : toast.type === 'info' ? 'bg-gray-800' : 'bg-emerald-600'}`}>{toast.text}</div>
      )}
    </div>
  );
}
