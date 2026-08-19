import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlarmClock, Banknote, BarChart3, Bell, BookOpen, CalendarDays,
  ChevronDown, CreditCard, FileText, FolderKanban, Image, ListOrdered,
  LogOut, Monitor, RotateCcw, Shield, Tag, TrendingUp,
  UserCheck, UserCog, UserPlus, UserSearch, Users, Video, Wallet, X, MessageSquareText,
  Home,
  type LucideIcon,
} from 'lucide-react';

import { mysqlAdmin, mysqlAuth } from '../../lib/mysqlapi';
import MessagesBell from './MessagesBell';
import type { LeadItem, StaffMember, SubscriberItem } from '../../types';
import type { TabKey } from './navigation';

type NotifRow = { id: string; type: string; title: string; message: string; read_at: string | null; created_at: string };
type VisibleMenuGroup = {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
  items: Array<{ key: TabKey; label: string; icon: LucideIcon }>;
};

type Props = {
  isSalesOnly: boolean;
  isCollectionRole: boolean;
  isReceptionDaqqi: boolean;
  isOnlineManager: boolean;
  isDaqqiManager: boolean;
  isSalesCollectionManager: boolean;
  isAdmin: boolean;
  visibleMenuGroups: VisibleMenuGroup[];
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  activeDropdownGroup: string | null;
  setActiveDropdownGroup: React.Dispatch<React.SetStateAction<string | null>>;
  dropdownRect: DOMRect | null;
  setDropdownRect: React.Dispatch<React.SetStateAction<DOMRect | null>>;
  leads: LeadItem[];
  subscribers: SubscriberItem[];
  monitorPanel: boolean;
  setMonitorPanel: React.Dispatch<React.SetStateAction<boolean>>;
  notifRef: React.RefObject<HTMLDivElement | null>;
  notifOpen: boolean;
  setNotifOpen: React.Dispatch<React.SetStateAction<boolean>>;
  notifRows: NotifRow[];
  setNotifRows: React.Dispatch<React.SetStateAction<NotifRow[]>>;
  notifUnread: number;
  setNotifUnread: React.Dispatch<React.SetStateAction<number>>;
  pendingProofsCount: number;
  inboxUnreadCount: number;
  currentStaff: StaffMember | null | undefined;
  salesDataLoading: boolean;
  staffNotifBadge: number;
  setSalesNotifOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onlineMgrAcademyOpen: boolean;
  setOnlineMgrAcademyOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setOnlineMgrFollowupOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onlineMgrFollowupBadge: number;
  setOnlineMgrNewEventsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onlineMgrNewEventsBadge: number;
  notify: Notify;
};

type Notify = (kind: 'success' | 'error' | 'warning' | 'info', message: string) => void;

type CompactTab = { key: TabKey; label: string; icon: React.ComponentType<{ size?: number }> };

type CompactRoleNavProps = {
  tabs: CompactTab[];
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  activeButtonClass: string;
  avatarClass: string;
  spinnerBorderClass: string;
  roleBadge?: string;
  roleBadgeClass?: string;
  currentStaff: StaffMember | null | undefined;
  salesDataLoading: boolean;
  staffNotifBadge: number;
  setSalesNotifOpen: React.Dispatch<React.SetStateAction<boolean>>;
  notify: Notify;
  extraTabsSlot?: React.ReactNode;
  extraHeaderButtons?: React.ReactNode;
};

function CompactRoleNav({
  tabs, activeTab, setActiveTab, activeButtonClass, avatarClass, spinnerBorderClass,
  roleBadge, roleBadgeClass, currentStaff, salesDataLoading, staffNotifBadge,
  setSalesNotifOpen, notify, extraTabsSlot, extraHeaderButtons,
}: CompactRoleNavProps) {
  const navigate = useNavigate();
  return (
    <nav className="bg-white border border-gray-200 rounded-2xl p-2 shadow-sm flex items-center gap-2 flex-wrap justify-between" dir="rtl">
      <div className="flex items-center gap-1.5 flex-wrap">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition ${
                isActive ? activeButtonClass : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}>
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
        {extraTabsSlot}
      </div>
      {currentStaff && (
        <div className="flex items-center gap-2 pl-2 text-sm text-gray-600">
          <div className={`w-7 h-7 rounded-full grid place-items-center text-xs font-bold flex-shrink-0 ${avatarClass}`}>
            {currentStaff.name.charAt(0)}
          </div>
          <span className="font-semibold text-gray-800">{currentStaff.name}</span>
          {roleBadge && <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${roleBadgeClass}`}>{roleBadge}</span>}
          {salesDataLoading && <span className={`w-4 h-4 border-2 border-t-transparent rounded-full animate-spin ${spinnerBorderClass}`} />}
          <button
            onClick={() => setSalesNotifOpen(true)}
            className="relative w-7 h-7 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-600 hover:text-amber-800 grid place-items-center transition"
            title="الإشعارات والمتابعات"
          >
            <Bell size={13} />
            {staffNotifBadge > 0 && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[8px] font-bold grid place-items-center">{staffNotifBadge > 9 ? '9+' : staffNotifBadge}</span>}
          </button>
          <MessagesBell mode="staff" notify={notify} compact />
          {extraHeaderButtons}
          <button
            onClick={() => { mysqlAuth.logout(); navigate('/auth'); }}
            className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 grid place-items-center transition"
            title="تسجيل الخروج"
          ><LogOut size={13} /></button>
        </div>
      )}
    </nav>
  );
}

export function DashboardNavigation(props: Props) {
  const {
    isSalesOnly, isCollectionRole, isReceptionDaqqi, isOnlineManager, isDaqqiManager,
    isSalesCollectionManager, isAdmin, visibleMenuGroups, activeTab, setActiveTab,
    activeDropdownGroup, setActiveDropdownGroup, dropdownRect, setDropdownRect, leads,
    subscribers, monitorPanel, setMonitorPanel, notifRef,
    notifOpen, setNotifOpen, notifRows, setNotifRows, notifUnread, setNotifUnread,
    pendingProofsCount, inboxUnreadCount, currentStaff, salesDataLoading, staffNotifBadge,
    setSalesNotifOpen, onlineMgrAcademyOpen, setOnlineMgrAcademyOpen, setOnlineMgrFollowupOpen,
    onlineMgrFollowupBadge, setOnlineMgrNewEventsOpen, onlineMgrNewEventsBadge, notify,
  } = props;
  const navigate = useNavigate();

  return (
<>
        {/* ── Main nav bar ── */}
        {!isSalesOnly && !isCollectionRole && !isReceptionDaqqi && !isOnlineManager && (
          <div className="relative mb-4" dir="rtl">
            {/* Single bar */}
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-2xl px-3 py-2 shadow-sm">
              {/* Brand */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-7 h-7 rounded-xl bg-primary-600 text-white grid place-items-center flex-shrink-0">
                  <Shield size={14} />
                </div>
                <div>
                  <h2 className="font-extrabold text-gray-900 text-xs leading-tight">لوحة الإدارة</h2>
                  <button onClick={() => setActiveTab('server_monitor')} className="text-[9px] flex items-center gap-0.5 hover:underline cursor-pointer" title="مراقبة السيرفر">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-emerald-600 font-bold">متصل</span>
                  </button>
                </div>
              </div>

              <div className="w-px h-5 bg-gray-200 flex-shrink-0 mx-0.5" />

              {/* Group nav buttons — scrollable */}
              <div className="flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0">
                {visibleMenuGroups.map((group) => {
                  const GroupIcon = group.icon;
                  const hasActive = group.items.some(i => i.key === activeTab);
                  const isOpen = activeDropdownGroup === group.key;
                  return (
                    <button
                      key={group.key}
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                        if (isOpen) { setActiveDropdownGroup(null); setDropdownRect(null); }
                        else { setActiveDropdownGroup(group.key); setDropdownRect(r); }
                      }}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex-shrink-0 ${
                        hasActive || isOpen
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      <GroupIcon size={13} />
                      <span>{group.label}</span>
                      <ChevronDown size={11} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                  );
                })}
              </div>

              <div className="w-px h-5 bg-gray-200 flex-shrink-0 mx-0.5" />

              {/* Monitor button — unified (sales + collection + daqqi) */}
              {(() => {
                const td = new Date().toISOString().slice(0,10);
                const salesBadge = leads.filter(l => !l.hidden && l.nextFollowUpDate && l.nextFollowUpDate <= td && !['converted','lost'].includes(l.status||'')).length;
                const collBadge = subscribers.filter(s => (s.installmentPlans||[]).some(p=>(p.entries||[]).some(e=>!e.paidAt&&e.dueDate<td))).length;
                const totalBadge = salesBadge + collBadge;
                return (
                  <button
                    onClick={() => setMonitorPanel(p => !p)}
                    title="لوحة المتابعة — سيلز · تحصيل · دقي"
                    className={`relative w-8 h-8 rounded-xl grid place-items-center transition flex-shrink-0 ${monitorPanel ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-violet-500 hover:bg-violet-50'}`}
                  >
                    <Activity size={14} />
                    {totalBadge > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold grid place-items-center leading-none">{totalBadge > 9 ? '9+' : totalBadge}</span>
                    )}
                  </button>
                );
              })()}

              {/* Controls */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {currentStaff && ['instructor', 'trainer'].includes(currentStaff.role) && (
                  <button
                    onClick={() => navigate('/therapist-portal')}
                    className="w-8 h-8 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 grid place-items-center transition"
                    title="بوابة المحاضر وجلساتي"
                  >
                    <UserCheck size={15} />
                  </button>
                )}
                {/* Personal pages. This used to be one icon that only ever
                    opened staff_home; ملفي الشخصي was reachable solely through a
                    card inside that page, so employees on the full nav could not
                    find their own account. All three are named and reachable. */}
                <div className="flex items-center rounded-xl bg-gray-100 p-0.5 gap-0.5">
                  {([
                    ['staff_home',     'الرئيسية',       Home],
                    ['staff_settings', 'ملفي الشخصي',    UserCog],
                    ['my_hr',          'ملفي الوظيفي',   FileText],
                  ] as const).map(([tab, label, Icon]) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`w-7 h-7 rounded-lg grid place-items-center transition ${
                        activeTab === tab
                          ? 'bg-indigo-600 text-white'
                          : 'hover:bg-indigo-50 hover:text-indigo-600 text-gray-500'
                      }`}
                      title={label}
                    >
                      <Icon size={14} />
                    </button>
                  ))}
                </div>
                {/* Staff messages used to be visible one employee at a time,
                    inside each profile page — so an incoming message went unseen
                    until someone opened that person's file. */}
                <MessagesBell mode="management" notify={notify} />
                <div className="relative flex-shrink-0" ref={notifRef}>
                  <button
                    onClick={async () => {
                      const opening = !notifOpen;
                      setNotifOpen(opening);
                      if (opening && notifUnread > 0) {
                        try {
                          await mysqlAdmin.markAllNotificationsRead();
                          setNotifUnread(0);
                          setNotifRows(rows => rows.map(r => ({ ...r, read_at: r.read_at ?? new Date().toISOString() })));
                        } catch {
                          // Keep the unread state intact; polling will retry.
                        }
                      }
                    }}
                    className="relative w-8 h-8 rounded-xl bg-gray-100 hover:bg-primary-50 hover:text-primary-600 text-gray-500 grid place-items-center transition"
                    title="الإشعارات"
                  >
                    <Bell size={15} />
                    {notifUnread > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold grid place-items-center leading-none">{notifUnread > 9 ? '9+' : notifUnread}</span>
                    )}
                  </button>
                  {notifOpen && (
                    <div className="absolute top-10 left-0 z-[200] w-80 bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden" dir="rtl">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <span className="font-bold text-gray-800 text-sm">الإشعارات</span>
                        <button onClick={() => setNotifOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                      </div>
                      <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                        {notifRows.length === 0 ? (
                          <div className="text-center py-8 text-gray-400 text-sm">لا توجد إشعارات</div>
                        ) : notifRows.slice(0, 20).map(n => (
                          <div key={n.id} className={`px-4 py-3 hover:bg-gray-50 transition ${!n.read_at ? 'bg-blue-50' : ''}`}>
                            <div className="font-semibold text-gray-800 text-sm">{n.title}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{n.message}</div>
                            <div className="text-[10px] text-gray-400 mt-1">{new Date(n.created_at).toLocaleString('ar-EG-u-nu-latn')}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button onClick={() => { mysqlAuth.logout(); navigate('/auth'); }}
                  className="w-8 h-8 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 grid place-items-center transition"
                  title="تسجيل الخروج">
                  <LogOut size={14} />
                </button>
              </div>
            </div>


            {/* Dropdown panel — fixed below the clicked button */}
            {activeDropdownGroup && dropdownRect && (() => {
              const group = visibleMenuGroups.find(g => g.key === activeDropdownGroup);
              if (!group) return null;
              const GroupIcon = group.icon;
              return (
                <>
                  <div className="fixed inset-0 z-[9998]" onClick={() => { setActiveDropdownGroup(null); setDropdownRect(null); }} />
                  <div
                    className="fixed z-[9999] bg-white border border-gray-200 rounded-2xl shadow-2xl p-1.5 min-w-[220px]"
                    style={{ top: dropdownRect.bottom + 4, right: window.innerWidth - dropdownRect.right }}
                  >
                    <div className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-gray-400 border-b border-gray-100 mb-1 flex items-center gap-2">
                      <GroupIcon size={12} className={group.color} />
                      {group.label}
                    </div>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.key;
                      return (
                        <button
                          key={`${item.key}-${group.key}`}
                          onClick={() => { setActiveTab(item.key as TabKey); setActiveDropdownGroup(null); }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-semibold transition text-right ${
                            isActive ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-primary-50 hover:text-primary-700'
                          }`}
                        >
                          <Icon size={14} className="flex-shrink-0" />
                          <span className="truncate flex-1">{item.label}</span>
                          {item.key === 'financial' && pendingProofsCount > 0 && (
                            <span className="bg-amber-500 text-white text-[10px] font-extrabold rounded-full px-1.5 leading-[18px] min-w-[18px] text-center flex-shrink-0">
                              {pendingProofsCount}
                            </span>
                          )}
                          {item.key === 'notif_inbox' && inboxUnreadCount > 0 && (
                            <span className="bg-red-500 text-white text-[10px] font-extrabold rounded-full px-1.5 leading-[18px] min-w-[18px] text-center flex-shrink-0">
                              {inboxUnreadCount > 9 ? '9+' : inboxUnreadCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>
        )}

            {/* ── Sales horizontal nav (no sidebar) ── */}
            {isSalesOnly && (
              <CompactRoleNav
                tabs={[
                  // staff_home is where the rep lands at login, but nothing in
                  // this bar pointed back at it — leave the page and it was gone
                  // for the rest of the session.
                  { key: 'staff_home', label: 'الرئيسية', icon: Home },
                  { key: 'leads', label: 'العملاء المحتملون', icon: UserPlus },
                  { key: 'online_clients', label: 'عملائي', icon: UserCheck },
                  { key: 'orders', label: 'مدفوعاتي', icon: CreditCard },
                  { key: 'overview', label: 'إحصائياتي', icon: BarChart3 },
                  { key: 'staff_settings', label: 'ملفي الشخصي', icon: UserCog },
                ]}
                activeTab={activeTab} setActiveTab={setActiveTab}
                activeButtonClass="bg-primary-600 text-white shadow-md shadow-primary-200"
                avatarClass="bg-primary-100 text-primary-700"
                spinnerBorderClass="border-primary-400"
                currentStaff={currentStaff} salesDataLoading={salesDataLoading}
                staffNotifBadge={staffNotifBadge} setSalesNotifOpen={setSalesNotifOpen} notify={notify}
              />
            )}

            {/* ── Collection horizontal nav (no sidebar) ── */}
            {isCollectionRole && (
              <CompactRoleNav
                tabs={[
                  { key: 'staff_home', label: 'الرئيسية', icon: Home },
                  { key: 'online_clients', label: 'عملاء الاونلاين', icon: UserCheck },
                  { key: 'leads', label: 'العملاء المحتملين', icon: UserSearch },
                  { key: 'refund_requests', label: 'طلبات الاسترداد', icon: RotateCcw },
                  { key: 'orders', label: 'مدفوعاتي', icon: CreditCard },
                  { key: 'overview', label: 'إحصائياتي', icon: BarChart3 },
                  { key: 'staff_settings', label: 'ملفي الشخصي', icon: UserCog },
                ]}
                activeTab={activeTab} setActiveTab={setActiveTab}
                activeButtonClass="bg-primary-600 text-white shadow-md shadow-primary-200"
                avatarClass="bg-teal-100 text-teal-700"
                spinnerBorderClass="border-teal-400"
                currentStaff={currentStaff} salesDataLoading={salesDataLoading}
                staffNotifBadge={staffNotifBadge} setSalesNotifOpen={setSalesNotifOpen} notify={notify}
              />
            )}

            {/* ── Reception Daqqi horizontal nav (no sidebar) ── */}
            {isReceptionDaqqi && !isDaqqiManager && (
              <CompactRoleNav
                tabs={[
                  { key: 'daqqi_schedule', label: 'جدول الدقي', icon: CalendarDays },
                  { key: 'daqqi_clients', label: 'عملائي', icon: UserCheck },
                  { key: 'leads', label: 'العملاء المحتملين', icon: UserSearch },
                  { key: 'orders', label: 'مدفوعاتي', icon: CreditCard },
                  { key: 'overview', label: 'إحصائياتي', icon: BarChart3 },
                  { key: 'staff_settings', label: 'ملفي الشخصي', icon: UserCog },
                ]}
                activeTab={activeTab} setActiveTab={setActiveTab}
                activeButtonClass="bg-primary-600 text-white shadow-md shadow-primary-200"
                avatarClass="bg-orange-100 text-orange-700"
                spinnerBorderClass="border-orange-400"
                currentStaff={currentStaff} salesDataLoading={salesDataLoading}
                staffNotifBadge={staffNotifBadge} setSalesNotifOpen={setSalesNotifOpen} notify={notify}
              />
            )}

            {/* ── Daqqi Manager horizontal nav (no sidebar) ── */}
            {isDaqqiManager && !isAdmin && (
              <CompactRoleNav
                tabs={[
                  { key: 'daqqi_schedule', label: 'جدول الدقي', icon: CalendarDays },
                  { key: 'daqqi_clients', label: 'عملاء الدقي', icon: UserCheck },
                  { key: 'leads', label: 'العملاء المحتملين', icon: UserSearch },
                  { key: 'orders', label: 'الطلبات والمدفوعات', icon: CreditCard },
                  { key: 'daqqi_accounting', label: 'حسابات الدقي', icon: Wallet },
                  { key: 'daqqi_stats', label: 'إحصائيات فريق الدقي', icon: BarChart3 },
                  { key: 'staff_settings', label: 'ملفي الشخصي', icon: UserCog },
                ]}
                activeTab={activeTab} setActiveTab={setActiveTab}
                activeButtonClass="bg-purple-600 text-white shadow-md shadow-purple-200"
                avatarClass="bg-purple-100 text-purple-700"
                spinnerBorderClass="border-purple-400"
                roleBadge="مدير الدقي" roleBadgeClass="bg-purple-100 text-purple-700"
                currentStaff={currentStaff} salesDataLoading={salesDataLoading}
                staffNotifBadge={staffNotifBadge} setSalesNotifOpen={setSalesNotifOpen} notify={notify}
              />
            )}

            {/* ── Sales & Collection Manager horizontal nav (no sidebar) ── */}
            {isSalesCollectionManager && !isAdmin && (
              <CompactRoleNav
                tabs={[
                  { key: 'leads', label: 'العملاء المحتملون', icon: UserPlus },
                  { key: 'sales_hub', label: 'فريق المبيعات', icon: TrendingUp },
                  { key: 'online_clients', label: 'عملاء الأونلاين', icon: UserCheck },
                  { key: 'online_hub', label: 'فريق التحصيل', icon: Monitor },
                  { key: 'orders', label: 'الطلبات والمدفوعات', icon: CreditCard },
                  { key: 'financial', label: 'التقارير المالية', icon: BarChart3 },
                  { key: 'activity', label: 'سجل النشاط', icon: Activity },
                  { key: 'overview', label: 'إحصائيات', icon: BarChart3 },
                  { key: 'staff_settings', label: 'ملفي الشخصي', icon: UserCog },
                ]}
                activeTab={activeTab} setActiveTab={setActiveTab}
                activeButtonClass="bg-indigo-600 text-white shadow-md shadow-indigo-200"
                avatarClass="bg-indigo-100 text-indigo-700"
                spinnerBorderClass="border-indigo-400"
                roleBadge="مدير المبيعات والتحصيل" roleBadgeClass="bg-indigo-100 text-indigo-700"
                currentStaff={currentStaff} salesDataLoading={salesDataLoading}
                staffNotifBadge={staffNotifBadge} setSalesNotifOpen={setSalesNotifOpen} notify={notify}
              />
            )}

            {/* ── Online Manager horizontal nav (no sidebar) ── */}
            {isOnlineManager && !isAdmin && (() => {
              const academyTabKeys: TabKey[] = ['courses','lectures','instructors','bundles','testimonials','discounts','quizzes','live_streams','community','institute_gallery'];
              const isAcademyActive = academyTabKeys.includes(activeTab as TabKey);
              return (
                <CompactRoleNav
                  tabs={[
                    { key: 'online_clients', label: 'عملاء الاونلاين', icon: UserCheck },
                    { key: 'client', label: 'قاعدة العملاء', icon: UserSearch },
                    { key: 'registrations', label: 'التسجيلات', icon: UserPlus },
                    { key: 'refund_requests', label: 'طلبات الاسترداد', icon: RotateCcw },
                    { key: 'orders', label: 'الطلبات والمدفوعات', icon: CreditCard },
                    { key: 'overview', label: 'إحصائيات', icon: BarChart3 },
                    { key: 'staff_settings', label: 'ملفي الشخصي', icon: UserCog },
                  ]}
                  activeTab={activeTab} setActiveTab={setActiveTab}
                  activeButtonClass="bg-emerald-600 text-white shadow-md shadow-emerald-200"
                  avatarClass="bg-emerald-100 text-emerald-700"
                  spinnerBorderClass="border-emerald-400"
                  roleBadge="مسئول الأونلاين" roleBadgeClass="bg-emerald-100 text-emerald-700"
                  currentStaff={currentStaff} salesDataLoading={salesDataLoading}
                  staffNotifBadge={staffNotifBadge} setSalesNotifOpen={setSalesNotifOpen} notify={notify}
                  extraTabsSlot={
                    <div className="relative">
                      <button
                        onClick={() => setOnlineMgrAcademyOpen(o => !o)}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition ${
                          isAcademyActive ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                        }`}>
                        <BookOpen size={15} />
                        الأكاديمية والمحتوى
                        <ChevronDown size={13} className={`transition-transform ${onlineMgrAcademyOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {onlineMgrAcademyOpen && (
                        <div className="absolute top-full mt-1 right-0 bg-white border border-gray-200 rounded-xl shadow-xl z-50 min-w-[180px] py-1" dir="rtl">
                          {([
                            { key: 'courses' as TabKey, label: 'الكورسات والدبلومات', icon: BookOpen },
                            { key: 'lectures' as TabKey, label: 'الدروس', icon: ListOrdered },
                            { key: 'instructors' as TabKey, label: 'المحاضرون والخبراء', icon: Users },
                            { key: 'bundles' as TabKey, label: 'المسارات والباقات', icon: FolderKanban },
                            { key: 'testimonials' as TabKey, label: 'الآراء والتوصيات', icon: MessageSquareText },
                            { key: 'discounts' as TabKey, label: 'الخصومات والكوبونات', icon: Tag },
                            { key: 'quizzes' as TabKey, label: 'اختبارات الكورسات', icon: FileText },
                            { key: 'live_streams' as TabKey, label: 'البث المباشر', icon: Video },
                            { key: 'community' as TabKey, label: 'المجتمع', icon: MessageSquareText },
                            { key: 'institute_gallery' as TabKey, label: 'معرض صور المعهد', icon: Image },
                          ] as { key: TabKey; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[]).map(item => {
                            const Icon = item.icon;
                            const isActive = activeTab === item.key;
                            return (
                              <button key={item.key}
                                onClick={() => { setActiveTab(item.key); setOnlineMgrAcademyOpen(false); }}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-right transition ${
                                  isActive ? 'bg-emerald-600 text-white' : 'text-gray-700 hover:bg-gray-50'
                                }`}>
                                <Icon size={13} className="flex-shrink-0" />
                                <span className="flex-1 text-right">{item.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  }
                  extraHeaderButtons={
                    <>
                      <button
                        onClick={() => setOnlineMgrFollowupOpen(true)}
                        className="relative w-7 h-7 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 hover:text-teal-800 grid place-items-center transition"
                        title="متابعات التحصيل والأقساط"
                      >
                        <AlarmClock size={13} />
                        {onlineMgrFollowupBadge > 0 && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[8px] font-bold grid place-items-center">{onlineMgrFollowupBadge > 9 ? '9+' : onlineMgrFollowupBadge}</span>}
                      </button>
                      <button
                        onClick={() => setOnlineMgrNewEventsOpen(true)}
                        className="relative w-7 h-7 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-600 hover:text-emerald-800 grid place-items-center transition"
                        title="عملاء أونلاين جدد ومدفوعات"
                      >
                        <Banknote size={13} />
                        {onlineMgrNewEventsBadge > 0 && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 text-white text-[8px] font-bold grid place-items-center">{onlineMgrNewEventsBadge > 9 ? '9+' : onlineMgrNewEventsBadge}</span>}
                      </button>
                    </>
                  }
                />
              );
            })()}
</>
  );
}
