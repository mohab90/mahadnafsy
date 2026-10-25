import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BarChart3, Bell, CalendarClock, Globe2, GraduationCap, LayoutDashboard, MessageCircle, Star, UserRound, Video, Wallet,
} from 'lucide-react';
import { LecturerCommunity } from './lecturer/LecturerCommunity';
import { LecturerConsultations } from './lecturer/LecturerConsultations';
import { LecturerEarnings } from './lecturer/LecturerEarnings';
import { LecturerFeedback } from './lecturer/LecturerFeedback';
import { LecturerHours } from './lecturer/LecturerHours';
import { LecturerLives } from './lecturer/LecturerLives';
import { LecturerOverview } from './lecturer/LecturerOverview';
import { LecturerProfile } from './lecturer/LecturerProfile';
import { LecturerStudents } from './lecturer/LecturerStudents';
import { errorText, lecturerApi, type LecturerNotification, type Overview } from './lecturer/lecturerApi';
import { Card, Empty, Loading } from './lecturer/ui';
import { cairoDateTime } from '../../shared/cairoDate';

// «حساب محاضر» (25 Oct 2026): one place for a lecturer or consultant — the lives they schedule, their weekly consultation
// hours, the consultations booked with them, their ratings, students, earnings, the community and their profile.
// Everything it shows is the signed-in lecturer's own (api/routes/lecturer-portal.js).

const TABS = [
  { id: 'overview', label: 'الرئيسية', icon: LayoutDashboard },
  { id: 'lives', label: 'اللايفات', icon: Video },
  { id: 'hours', label: 'المواعيد', icon: CalendarClock },
  { id: 'consultations', label: 'الاستشارات', icon: MessageCircle },
  { id: 'feedback', label: 'التقييمات', icon: Star },
  { id: 'students', label: 'طلابي', icon: GraduationCap },
  { id: 'earnings', label: 'الأرباح', icon: Wallet },
  { id: 'community', label: 'المجتمع', icon: Globe2 },
  { id: 'notifications', label: 'الإشعارات', icon: Bell },
  { id: 'profile', label: 'ملفي', icon: UserRound },
] as const;
type TabId = typeof TABS[number]['id'];

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

export default function LecturerPortal() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as TabId | null;
  const tab: TabId = TABS.some(item => item.id === requested) ? (requested as TabId) : 'overview';
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

  const tabs = TABS.filter(item => (item.id === 'hours' || item.id === 'consultations' ? Boolean(overview.profile.consultation) : true));
  return (
    <div className="min-h-screen bg-gray-50 pb-16" dir="rtl">
      <header className="border-b border-gray-200 bg-white">
        <div className="container mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-600 text-white"><BarChart3 size={22} /></div>
            <div>
              <h1 className="text-xl font-extrabold text-gray-900">أهلاً د. {overview.profile.name}</h1>
              <p className="text-xs text-gray-500">بوابة المحاضر — لايفاتك، مواعيدك، تقييماتك وأرباحك في مكان واحد</p>
            </div>
          </div>
          <Link to="/" className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50">لوحة التحكم</Link>
        </div>
        <nav className="container mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2" aria-label="أقسام البوابة">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => open(id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition ${tab === id ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              <Icon size={15} /> {label}
              {id === 'notifications' && overview.unreadNotifications > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[10px] text-white">{overview.unreadNotifications}</span>}
            </button>
          ))}
        </nav>
      </header>

      {toast && (
        <div role="status" className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-lg ${toast.type === 'error' ? 'bg-red-600' : toast.type === 'info' ? 'bg-gray-800' : 'bg-emerald-600'}`}>{toast.text}</div>
      )}

      <main className="container mx-auto max-w-6xl px-4 py-6">
        {tab === 'overview' && <LecturerOverview notify={notify} onOpen={open} />}
        {tab === 'lives' && <LecturerLives notify={notify} />}
        {tab === 'hours' && <LecturerHours notify={notify} />}
        {tab === 'consultations' && <LecturerConsultations notify={notify} />}
        {tab === 'feedback' && <LecturerFeedback notify={notify} />}
        {tab === 'students' && <LecturerStudents notify={notify} />}
        {tab === 'earnings' && <LecturerEarnings notify={notify} />}
        {tab === 'community' && <LecturerCommunity notify={notify} name={overview.profile.name} />}
        {tab === 'notifications' && <Notifications notify={notify} onRead={loadOverview} />}
        {tab === 'profile' && <LecturerProfile notify={notify} />}
      </main>
    </div>
  );
}
