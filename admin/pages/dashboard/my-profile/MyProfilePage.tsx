import React, { Suspense, useEffect, useState } from 'react';
import {
  Briefcase, CalendarCheck2, ClipboardList, LayoutDashboard, Mail, MessagesSquare, Phone,
  Settings2, TrendingUp, Umbrella,
} from 'lucide-react';
import { TabErrorBoundary } from '../../../../shared/ui/TabErrorBoundary';
import { cairoDateTime } from '../../../../shared/cairoDate';
import { ROLE_LABELS, type RoleKey } from '../../../constants/permissions';
import type { LeadItem, StaffMember, SubscriberItem } from '../../../types';
import { StaffHomeTab } from '../lazyTabs';
import type { TabKey } from '../navigation';
import MyWorkRecordPanel from '../staff-settings/MyWorkRecordPanel';
import { MyJobFileSection } from './MyJobFileSection';
import { MyPerformanceSection } from './MyPerformanceSection';
import { MyRequestsSection } from './MyRequestsSection';
import { MySettingsSection } from './MySettingsSection';
import { useMyHr } from './useMyHr';

type Notify = (kind: 'success' | 'error' | 'warning' | 'info', message: string) => void;
type Section = 'today' | 'requests' | 'job' | 'performance' | 'messages' | 'settings';

/** The jobs whose day is a list of people to call — «شغل النهاردة» is theirs. */
const DESK_ROLES: RoleKey[] = [
  'sales', 'collection', 'consultant', 'support', 'sales_collection_manager',
  'online_manager', 'reception_daqqi', 'daqqi_manager',
];

const Spinner = () => (
  <div className="flex items-center justify-center p-16">
    <span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
  </div>
);

const tenure = (from: string | null | undefined) => {
  if (!from) return '';
  const months = Math.floor((Date.now() - new Date(from).getTime()) / (30.44 * 86400000));
  if (!Number.isFinite(months) || months < 0) return '';
  if (months < 1) return 'معانا من أقل من شهر';
  if (months < 12) return `معانا من ${months} ${months <= 10 ? 'شهور' : 'شهر'}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `معانا من ${years === 1 ? 'سنة' : years === 2 ? 'سنتين' : `${years} سنين`}${rest ? ` و${rest} شهور` : ''}`;
};

interface MyProfilePageProps {
  activeTab: TabKey;
  staff: StaffMember;
  leads: LeadItem[];
  subscribers: SubscriberItem[];
  notify: Notify;
  onNavigate: (tab: TabKey) => void;
}

/**
 * ملفي — one page for the person signed in, in every account.
 *
 * «الملف الشخصي» and «ملفي الوظيفي» were two destinations with two headers and
 * two copies of the leave form, and the profile's own HR section loaded only
 * under a URL no bar used. One page now: who you are at the top, and six tabs —
 * today's work, your requests to HR, your job file, your numbers, your messages
 * and your settings. Every bar opens it from the same small icon.
 */
export function MyProfilePage({ activeTab, staff, leads, subscribers, notify, onNavigate }: MyProfilePageProps) {
  const role = String(staff.role || '').toLowerCase() as RoleKey;
  const isDesk = DESK_ROLES.includes(role);
  const { hr, leaves, advances, disciplinary, setDisciplinary, reload, pendingCount } = useMyHr(notify);
  const [section, setSection] = useState<Section>(activeTab === 'my_hr' ? 'job' : isDesk ? 'today' : 'requests');
  // A notification that links to the job file lands on it, even from inside the page.
  useEffect(() => { if (activeTab === 'my_hr') setSection('job'); }, [activeTab]);

  const tabs: { key: Section; label: string; icon: typeof Briefcase; badge?: number }[] = [
    ...(isDesk ? [{ key: 'today' as const, label: 'شغل النهاردة', icon: LayoutDashboard }] : []),
    { key: 'requests', label: 'طلباتي', icon: ClipboardList, badge: pendingCount },
    { key: 'job', label: 'ملفي الوظيفي', icon: Briefcase },
    ...(isDesk ? [{ key: 'performance' as const, label: 'أدائي', icon: TrendingUp }] : []),
    { key: 'messages', label: 'مراسلاتي', icon: MessagesSquare },
    { key: 'settings', label: 'الإعدادات', icon: Settings2 },
  ];
  const showing = tabs.some(tab => tab.key === section) ? section : tabs[0].key;

  const initials = String(staff.name || '؟').split(' ').slice(0, 2).map(word => word[0]).join('');
  // Cairo's hour, not the device's.
  const hour = Number(cairoDateTime(new Date()).slice(11, 13));
  const greeting = hour < 12 ? 'صباح الخير' : hour < 17 ? 'مساء الخير' : 'مساء النور';
  const joined = hr?.staff.hire_date || hr?.staff.joined_at || staff.joinedAt || staff.createdAt;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Who is signed in, and where their month stands. */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-indigo-800 p-6 text-white shadow-xl">
        <div className="pointer-events-none absolute -left-16 -top-24 h-64 w-64 rounded-full bg-indigo-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-10 h-56 w-56 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-5">
          <div className="grid h-20 w-20 flex-shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-white/20 bg-white/10 text-2xl font-black shadow-lg">
            {staff.image
              ? <img src={staff.image} alt="" className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              : initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-indigo-200">{greeting} 👋</div>
            <h2 className="truncate text-2xl font-black">{staff.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-full bg-white/15 px-2.5 py-1 font-bold">{ROLE_LABELS[role] || staff.role}</span>
              {hr?.staff.department_name && <span className="rounded-full bg-white/10 px-2.5 py-1">{hr.staff.department_name}</span>}
              {tenure(joined) && <span className="rounded-full bg-white/10 px-2.5 py-1">{tenure(joined)}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-indigo-100/80" dir="ltr">
              {staff.email && <span className="flex items-center gap-1"><Mail size={11} /> {staff.email}</span>}
              {staff.phone && <span className="flex items-center gap-1"><Phone size={11} /> {staff.phone}</span>}
            </div>
          </div>
          <div className="grid w-full grid-cols-3 gap-2 sm:w-auto">
            {[
              { label: 'حضور الشهر', value: hr ? `${hr.attendance.present_days} يوم` : '—', icon: CalendarCheck2 },
              { label: 'رصيد الإجازات', value: hr ? `${hr.leaveBalance.remaining} يوم` : '—', icon: Umbrella },
              { label: 'طلبات معلقة', value: String(pendingCount), icon: ClipboardList },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="min-w-[96px] rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5 backdrop-blur">
                <Icon size={14} className="mb-1 text-indigo-200" />
                <div className="text-base font-black">{value}</div>
                <div className="text-[10px] text-indigo-200">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* One tab bar, where the page begins. */}
      <nav className="flex flex-wrap gap-1 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-sm">
        {tabs.map(({ key, label, icon: Icon, badge }) => (
          <button key={key} type="button" onClick={() => setSection(key)} aria-current={showing === key ? 'page' : undefined}
            className={`relative flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold transition ${
              showing === key ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200' : 'text-gray-600 hover:bg-gray-100'}`}>
            <Icon size={15} /> {label}
            {!!badge && <span className={`rounded-full px-1.5 text-[10px] leading-4 ${showing === key ? 'bg-white text-indigo-700' : 'bg-amber-500 text-white'}`}>{badge}</span>}
          </button>
        ))}
      </nav>

      <TabErrorBoundary>
        {showing === 'today' && (
          <Suspense fallback={<Spinner />}>
            <StaffHomeTab staff={staff} leads={leads} subscribers={subscribers} notify={notify} onNavigate={tab => onNavigate(tab as TabKey)} hideHeader />
          </Suspense>
        )}
        {showing === 'requests' && <MyRequestsSection hr={hr} leaves={leaves} advances={advances} reload={reload} notify={notify} />}
        {showing === 'job' && <MyJobFileSection hr={hr} disciplinary={disciplinary} setDisciplinary={setDisciplinary} notify={notify} />}
        {showing === 'performance' && <MyPerformanceSection staff={staff} subscribers={subscribers} notify={notify} />}
        {showing === 'messages' && <MyWorkRecordPanel notify={notify} part="thread" />}
        {showing === 'settings' && <MySettingsSection staff={staff} notify={notify} />}
      </TabErrorBoundary>
    </div>
  );
}

export default React.memo(MyProfilePage);
