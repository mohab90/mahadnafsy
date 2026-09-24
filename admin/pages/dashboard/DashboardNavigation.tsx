import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlarmClock, Banknote, BarChart3, Bell, BookOpen, Briefcase, CalendarDays,
  ChevronDown, CreditCard, FileText, FolderKanban, Image, ListOrdered,
  LogOut, Menu, Monitor, RotateCcw, Shield, Tag, TrendingUp,
  UserCheck, UserCog, UserPlus, UserSearch, Users, Video, Wallet, MessageSquareText,
  type LucideIcon,
} from 'lucide-react';

import { useAuth } from '../../context/AuthContext';
import { useSiteData } from '../../context/SiteDataContext';
import MessagesBell from './MessagesBell';
import { hasPermission } from '../../constants/permissions';
import { NotificationsBell } from './NotificationsBell';
import type { LeadItem, StaffMember, SubscriberItem } from '../../types';
import type { TabKey } from './navigation';

type NotifRow = { id: string; type: string; title: string; message: string; read_at: string | null; created_at: string };
type VisibleMenuGroup = {
  key: string;
  label: string;
  /** What the bar shows when the full label is too wide for it. */
  short?: string;
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
  subscribers: SubscriberItem[];  notifRef: React.RefObject<HTMLDivElement | null>;
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
  const { logout } = useAuth();
  // Signing out has to tell the app, not only the server. This cleared the
  // cookie and navigated, so the panel stayed "signed in": the dashboard kept
  // drawing and every request it made came back 401, one toast each.
  const signOut = () => { logout(); navigate('/auth'); };
  // Same as the admin bar: on a phone the tabs wrapped into three or four rows
  // of buttons above the page. Below md they fold into ☰ and open downwards.
  const [menuOpen, setMenuOpen] = React.useState(false);
  const tabButton = (tab: CompactTab, block: boolean) => {
    const Icon = tab.icon;
    const isActive = activeTab === tab.key;
    return (
      <button key={tab.key} onClick={() => { setActiveTab(tab.key); setMenuOpen(false); }}
        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition ${block ? 'w-full text-right' : ''} ${
          isActive ? activeButtonClass : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        }`}>
        <Icon size={15} />
        {tab.label}
      </button>
    );
  };
  return (
    <nav className="sticky top-3 z-40 bg-white/95 backdrop-blur border border-gray-200 rounded-2xl p-2 shadow-sm flex items-center gap-2 flex-wrap justify-between" dir="rtl">
      <button
        type="button"
        onClick={() => setMenuOpen(open => !open)}
        aria-expanded={menuOpen}
        aria-label="القائمة"
        className={`md:hidden flex items-center gap-2 min-w-0 px-3 py-2 rounded-xl text-sm font-semibold transition ${
          menuOpen ? activeButtonClass : 'text-gray-700 hover:bg-gray-100'}`}
      >
        <Menu size={18} className="flex-shrink-0" />
        <span className="truncate">{tabs.find(tab => tab.key === activeTab)?.label || 'القائمة'}</span>
      </button>
      <div className="hidden md:flex items-center gap-1.5 flex-wrap">
        {tabs.map(tab => tabButton(tab, false))}
        {extraTabsSlot}
      </div>
      {currentStaff && (
        <div className="flex items-center gap-2 pl-2 text-sm text-gray-600">
          <div className={`w-7 h-7 rounded-full grid place-items-center text-xs font-bold flex-shrink-0 ${avatarClass}`}>
            {currentStaff.name.charAt(0)}
          </div>
          {/* The initial says who it is on a phone; the name needs the width
              the ☰ button is using there. */}
          <span className="hidden sm:inline font-semibold text-gray-800">{currentStaff.name}</span>
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
            onClick={signOut}
            className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 grid place-items-center transition"
            title="تسجيل الخروج"
          ><LogOut size={13} /></button>
        </div>
      )}
      {menuOpen && (
        <div className="md:hidden basis-full border-t border-gray-100 pt-2 space-y-0.5 max-h-[70vh] overflow-y-auto overscroll-contain">
          {tabs.map(tab => tabButton(tab, true))}
          {extraTabsSlot}
        </div>
      )}
    </nav>
  );
}

export function DashboardNavigation(props: Props) {
  const {
    isSalesOnly, isCollectionRole, isReceptionDaqqi, isOnlineManager, isDaqqiManager,
    isSalesCollectionManager, isAdmin, visibleMenuGroups, activeTab, setActiveTab,
    activeDropdownGroup, setActiveDropdownGroup, dropdownRect, setDropdownRect,
    notifRef,
    notifOpen, setNotifOpen, notifRows, setNotifRows, notifUnread, setNotifUnread,
    pendingProofsCount, inboxUnreadCount, currentStaff, salesDataLoading, staffNotifBadge,
    setSalesNotifOpen, onlineMgrAcademyOpen, setOnlineMgrAcademyOpen, setOnlineMgrFollowupOpen,
    onlineMgrFollowupBadge, setOnlineMgrNewEventsOpen, onlineMgrNewEventsBadge, notify,
  } = props;
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { content } = useSiteData();
  // The roundel, not the wordmark. institute.logo is the name beside the
  // mark, and in a bar that needs its width for the menu the name is the half
  // worth dropping — institute.favicon is that mark, already square, already
  // uploaded. Cropping the wide logo to its right-hand end would have worked
  // for exactly this one image and broken on the next one.
  const logoUrl = (content['institute.favicon'] || content['institute.logo'] || '').trim();
  // Signing out has to tell the app, not only the server. This cleared the
  // cookie and navigated, so the panel stayed "signed in": the dashboard kept
  // drawing and every request it made came back 401, one toast each.
  const signOut = () => { logout(); navigate('/auth'); };

  // A group's menu is positioned once, from the button's rectangle, and drawn
  // fixed. That was survivable while the bar scrolled away underneath it; now
  // the bar stays put and an open menu would be left behind on the page.
  React.useEffect(() => {
    if (!activeDropdownGroup) return undefined;
    const close = () => { setActiveDropdownGroup(null); setDropdownRect(null); };
    window.addEventListener('scroll', close, { passive: true });
    return () => window.removeEventListener('scroll', close);
  }, [activeDropdownGroup, setActiveDropdownGroup, setDropdownRect]);

  // On a phone the ten groups do not fit across the bar, and a bar that scrolls
  // sideways hides most of them behind the edge. Below md the bar carries one
  // ☰ instead, which opens the whole menu downwards: every group, every item.
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  // One item, drawn the same in a group's dropdown and in the phone menu, so
  // the counts on المالية and صندوق الوارد travel with it.
  const menuItem = (item: VisibleMenuGroup['items'][number], groupKey: string, onPicked: () => void) => {
    const Icon = item.icon;
    const isActive = activeTab === item.key;
    return (
      <button
        key={`${item.key}-${groupKey}`}
        onClick={() => { setActiveTab(item.key as TabKey); onPicked(); }}
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
  };

  return (
<>
        {/* ── Main nav bar ── */}
        {!isSalesOnly && !isCollectionRole && !isReceptionDaqqi && !isOnlineManager && (
          // sticky, because the screens under this bar are long ones — the
          // leads table, the client database, a financial report — and moving
          // between sections meant scrolling back to the top first. top-3
          // rather than top-0 keeps it reading as the floating pill it already
          // looks like. z-40 and no higher: shared/ui/Modal draws its dialogs
          // at z-50 and above, and a nav over those would cover every one.
          <div className="sticky top-3 z-40 mb-4" dir="rtl">
            {/* Single bar */}
            <div className="flex items-center gap-2 bg-white/95 backdrop-blur border border-gray-200 rounded-2xl px-3 py-2 shadow-sm">
              {/* Brand — the institute's own mark and nothing else.
                  This was a shield glyph, «لوحة الإدارة» and a pulsing «متصل»
                  under it: three lines telling somebody already inside the
                  panel that they were inside the panel, in the space the logo
                  belongs in. «متصل» linked to the security centre, which keeps
                  its own place in الإعدادات ← الأمان والصيانة. */}
              <div className="flex items-center flex-shrink-0">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={content['institute.name'] || 'معهد الدراسات النفسية'}
                    className="h-10 w-10 object-contain"
                  />
                ) : (
                  // No logo set for this tenant — an <img> with an empty src is
                  // a broken image where the brand should be.
                  <div className="w-7 h-7 rounded-xl bg-primary-600 text-white grid place-items-center flex-shrink-0">
                    <Shield size={14} />
                  </div>
                )}
              </div>

              {/* The phone's way in: the whole menu, opened downwards. */}
              <div className="md:hidden flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(open => !open)}
                  aria-expanded={mobileMenuOpen}
                  aria-label="القائمة"
                  // The icon alone: the five controls leave a phone about thirty
                  // pixels beside it, and the section's name cut to «نظر…» said
                  // less than nothing.
                  className={`w-9 h-9 grid place-items-center rounded-xl transition ${
                    mobileMenuOpen ? 'bg-primary-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                >
                  <Menu size={20} />
                </button>
              </div>

              {/* Group nav buttons — scrollable. No divider before them: the bar
                  needs its width for the groups. */}
              <div className="hidden md:flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0">
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
                      // px-2, not px-2.5: two pixels a side is what the ten
                      // groups needed to fit the bar without it scrolling.
                      className={`flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex-shrink-0 ${
                        hasActive || isOpen
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      <GroupIcon size={13} />
                      <span>{group.short || group.label}</span>
                      <ChevronDown size={11} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                  );
                })}
              </div>

              <div className="w-px h-5 bg-gray-200 flex-shrink-0 mx-0.5" />

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
                {/* Two icons, two subjects. ملفي الشخصي is the person signed in —
                    their numbers, their follow-ups and their details, one page.
                    ملفي الوظيفي is contract, leave and payroll, which is a different
                    thing with a different audience and has its own URL rather than
                    living as a section inside the other. */}
                <button
                  onClick={() => setActiveTab('staff_home')}
                  className={`w-8 h-8 rounded-xl grid place-items-center transition ${
                    ['staff_home', 'staff_settings'].includes(activeTab)
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 hover:bg-indigo-50 hover:text-indigo-600 text-gray-500'
                  }`}
                  title="ملفي الشخصي"
                >
                  <UserCog size={15} />
                </button>
                <button
                  onClick={() => setActiveTab('my_hr')}
                  className={`w-8 h-8 rounded-xl grid place-items-center transition ${
                    activeTab === 'my_hr'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 hover:bg-indigo-50 hover:text-indigo-600 text-gray-500'
                  }`}
                  title="ملفي الوظيفي"
                >
                  <Briefcase size={15} />
                </button>
                {/* Staff messages used to be visible one employee at a time,
                    inside each profile page — so an incoming message went unseen
                    until someone opened that person's file. Only for those its
                    route answers (view_hr): for everyone else it was a bell that
                    always read 0 and opened empty, on a 403 every page load. */}
                {(isAdmin || hasPermission(currentStaff, 'view_hr')) && <MessagesBell mode="management" notify={notify} />}
                <NotificationsBell
                  rows={notifRows}
                  setRows={setNotifRows}
                  unread={notifUnread}
                  setUnread={setNotifUnread}
                  open={notifOpen}
                  setOpen={setNotifOpen}
                  panelRef={notifRef}
                  onNavigate={setActiveTab}
                />
                <button onClick={signOut}
                  className="w-8 h-8 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 grid place-items-center transition"
                  title="تسجيل الخروج">
                  <LogOut size={14} />
                </button>
              </div>
            </div>


            {/* The phone menu. In the sticky block, so it stays under the bar;
                it scrolls itself, so a long menu never runs off the screen. */}
            {mobileMenuOpen && (
              <div className="md:hidden mt-2 bg-white border border-gray-200 rounded-2xl shadow-xl p-1.5 max-h-[70vh] overflow-y-auto overscroll-contain">
                {visibleMenuGroups.map(group => {
                  const GroupIcon = group.icon;
                  return (
                    <div key={group.key} className="py-1 border-b border-gray-100 last:border-0">
                      <div className="px-3 py-1.5 text-[11px] font-extrabold text-gray-400 flex items-center gap-2">
                        <GroupIcon size={12} className={group.color} />
                        {group.label}
                      </div>
                      {group.items.map(item => menuItem(item, group.key, () => setMobileMenuOpen(false)))}
                    </div>
                  );
                })}
              </div>
            )}

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
                    {group.items.map(item => menuItem(item, group.key, () => setActiveDropdownGroup(null)))}
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
                  { key: 'leads', label: 'العملاء المحتملون', icon: UserPlus },
                  { key: 'online_clients', label: 'عملائي', icon: UserCheck },
                  { key: 'orders', label: 'مدفوعاتي', icon: CreditCard },
                  { key: 'staff_performance', label: 'إحصائياتي', icon: BarChart3 },
                  { key: 'staff_home', label: 'ملفي الشخصي', icon: UserCog },
                  { key: 'my_hr', label: 'ملفي الوظيفي', icon: Briefcase },
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
                  { key: 'online_clients', label: 'عملاء الأونلاين', icon: UserCheck },
                  { key: 'leads', label: 'العملاء المحتملين', icon: UserSearch },
                  { key: 'refund_requests', label: 'طلبات الاسترداد', icon: RotateCcw },
                  { key: 'orders', label: 'مدفوعاتي', icon: CreditCard },
                  { key: 'overview', label: 'إحصائياتي', icon: BarChart3 },
                  { key: 'staff_home', label: 'ملفي الشخصي', icon: UserCog },
                  { key: 'my_hr', label: 'ملفي الوظيفي', icon: Briefcase },
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
                  { key: 'staff_performance', label: 'إحصائياتي', icon: BarChart3 },
                  { key: 'staff_home', label: 'ملفي الشخصي', icon: UserCog },
                  { key: 'my_hr', label: 'ملفي الوظيفي', icon: Briefcase },
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
                  { key: 'staff_home', label: 'ملفي الشخصي', icon: UserCog },
                  { key: 'my_hr', label: 'ملفي الوظيفي', icon: Briefcase },
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
                  { key: 'staff_home', label: 'ملفي الشخصي', icon: UserCog },
                  { key: 'my_hr', label: 'ملفي الوظيفي', icon: Briefcase },
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
                    { key: 'online_clients', label: 'عملاء الأونلاين', icon: UserCheck },
                    { key: 'client', label: 'قاعدة العملاء', icon: UserSearch },
                    { key: 'registrations', label: 'التسجيلات', icon: UserPlus },
                    { key: 'refund_requests', label: 'طلبات الاسترداد', icon: RotateCcw },
                    { key: 'orders', label: 'الطلبات والمدفوعات', icon: CreditCard },
                    { key: 'overview', label: 'إحصائيات', icon: BarChart3 },
                    { key: 'staff_home', label: 'ملفي الشخصي', icon: UserCog },
                  { key: 'my_hr', label: 'ملفي الوظيفي', icon: Briefcase },
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
