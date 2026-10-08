import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlarmClock, Banknote, BarChart3, Bell, BookOpen, CalendarDays,
  CalendarCheck, ChevronDown, CreditCard, FileText, FolderKanban, Headphones, Image, ListOrdered,
  LogOut, Menu, Monitor, RotateCcw, Shield, Star, Tag, TrendingUp,
  UserCheck, UserCog, UserPlus, UserSearch, Users, Video, Wallet, MessageSquareText, MessageCircle, Inbox,
  type LucideIcon,
} from 'lucide-react';

import { useAuth } from '../../context/AuthContext';
import { useSiteData } from '../../context/SiteDataContext';
import MessagesBell from './MessagesBell';
import { hasPermission } from '../../constants/permissions';
import { NotificationsBell } from './NotificationsBell';
import type { LeadItem, StaffMember, SubscriberItem } from '../../types';
import type { TabKey } from './navigation';
import { isProfileTab } from './my-profile/profileTabs';
import { branchOfRole, PHYSICAL_BRANCHES } from '../../lib/physicalBranch';

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
  isSupport: boolean;
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
  currentStaff: StaffMember | null | undefined;
  salesDataLoading: boolean;
  staffNotifBadge: number;
  setSalesNotifOpen: React.Dispatch<React.SetStateAction<boolean>>;
  notify: Notify;
  extraTabsSlot?: React.ReactNode;
  extraHeaderButtons?: React.ReactNode;
};

// «خلي نمط التصميم واحد لكل الموظفين باختلاف صلاحيتهم»: every bar is drawn the
// way the management bar is — the mark, compact buttons, one colour, the same
// icon controls — whatever tabs a role is given.
const barButtonClass = (active: boolean) => `flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex-shrink-0 ${
  active ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`;
const menuRowClass = (active: boolean) => `w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-semibold transition text-right ${
  active ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-primary-50 hover:text-primary-700'}`;
const iconButtonClass = 'relative w-8 h-8 rounded-xl bg-gray-100 hover:bg-primary-50 hover:text-primary-600 text-gray-500 grid place-items-center transition';

/**
 * The institute's mark — the roundel, not the wordmark. institute.logo is the
 * name beside the mark, and in a bar that needs its width for the menu the
 * name is the half worth dropping; institute.favicon is that mark, already
 * square, already uploaded.
 */
function BrandMark() {
  const { content } = useSiteData();
  const logoUrl = (content['institute.favicon'] || content['institute.logo'] || '').trim();
  return (
    <div className="flex items-center flex-shrink-0">
      {logoUrl ? (
        <img src={logoUrl} alt={content['institute.name'] || 'معهد الدراسات النفسية'} className="h-10 w-10 object-contain" />
      ) : (
        // No logo set for this tenant — an <img> with an empty src is a broken
        // image where the brand should be.
        <div className="w-7 h-7 rounded-xl bg-primary-600 text-white grid place-items-center flex-shrink-0">
          <Shield size={14} />
        </div>
      )}
    </div>
  );
}

/**
 * «ملفي» — the one way into the person's own page, and the same small icon in
 * every account: the admin bar and each role's bar. Two text tabs used to sit
 * at the end of every role bar («ملفي الشخصي», «ملفي الوظيفي») while the admin
 * bar had two icons; the owner asked for one icon, on the left, everywhere.
 */
function ProfileIconButton({ activeTab, setActiveTab }: { activeTab: TabKey; setActiveTab: (tab: TabKey) => void }) {
  const active = isProfileTab(activeTab);
  return (
    <button type="button" onClick={() => setActiveTab('staff_home')} title="ملفي" aria-label="ملفي"
      aria-current={active ? 'page' : undefined}
      className={`w-8 h-8 rounded-xl grid place-items-center transition ${
        active ? 'bg-primary-600 text-white' : 'bg-gray-100 hover:bg-primary-50 hover:text-primary-600 text-gray-500'}`}>
      <UserCog size={15} />
    </button>
  );
}

function CompactRoleNav({
  tabs, activeTab, setActiveTab, currentStaff, salesDataLoading, staffNotifBadge,
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
  const pick = (key: TabKey) => { setActiveTab(key); setMenuOpen(false); };
  return (
    <nav className="sticky top-3 z-40 mb-4" dir="rtl">
      <div className="flex items-center gap-2 bg-white/95 backdrop-blur border border-gray-200 rounded-2xl px-3 py-2 shadow-sm">
        <BrandMark />
        <div className="md:hidden flex-1 min-w-0">
          <button type="button" onClick={() => setMenuOpen(open => !open)} aria-expanded={menuOpen} aria-label="القائمة"
            className={`w-9 h-9 grid place-items-center rounded-xl transition ${menuOpen ? 'bg-primary-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
            <Menu size={20} />
          </button>
        </div>
        <div className="hidden md:flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.key} onClick={() => pick(tab.key)} className={barButtonClass(activeTab === tab.key)}>
                <Icon size={13} />
                <span>{tab.label}</span>
              </button>
            );
          })}
          {extraTabsSlot}
        </div>
        <div className="w-px h-5 bg-gray-200 flex-shrink-0 mx-0.5" />
        {currentStaff && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {salesDataLoading && <span className="w-4 h-4 border-2 border-t-transparent border-primary-400 rounded-full animate-spin" />}
            <ProfileIconButton activeTab={activeTab} setActiveTab={setActiveTab} />
            <button onClick={() => setSalesNotifOpen(true)} className={iconButtonClass} title="الإشعارات والمتابعات">
              <Bell size={15} />
              {staffNotifBadge > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold grid place-items-center">{staffNotifBadge > 9 ? '9+' : staffNotifBadge}</span>}
            </button>
            <MessagesBell mode="staff" notify={notify} />
            {extraHeaderButtons}
            <button onClick={signOut} className="w-8 h-8 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 grid place-items-center transition" title="تسجيل الخروج">
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
      {menuOpen && (
        <div className="md:hidden mt-2 bg-white border border-gray-200 rounded-2xl shadow-xl p-1.5 max-h-[70vh] overflow-y-auto overscroll-contain">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.key} onClick={() => pick(tab.key)} className={menuRowClass(activeTab === tab.key)}>
                <Icon size={14} />
                <span className="truncate flex-1">{tab.label}</span>
              </button>
            );
          })}
          {extraTabsSlot}
        </div>
      )}
    </nav>
  );
}

export function DashboardNavigation(props: Props) {
  const {
    isSalesOnly, isCollectionRole, isReceptionDaqqi, isSupport, isOnlineManager, isDaqqiManager,
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
  // A role with a bar of its own sees that bar and nothing else. The management
  // bar was hidden for four of them and not for the Dokki manager or the sales
  // and collection manager, who got both — the whole panel's groups on top of
  // their own tabs.
  // A branch's own staff: their bar names their branch (Dokki, or Tagamoa).
  const staffBranchLabel = PHYSICAL_BRANCHES[branchOfRole(currentStaff?.role) || 'DAQQI'].label;
  const hasRoleBar = isSalesOnly || isCollectionRole || (isReceptionDaqqi && !isDaqqiManager) || isSupport
    || ((isDaqqiManager || isSalesCollectionManager || isOnlineManager) && !isAdmin);
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
        className={menuRowClass(isActive)}
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
        {!hasRoleBar && (
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
              <BrandMark />

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
                      className={barButtonClass(hasActive || isOpen)}
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
                <ProfileIconButton activeTab={activeTab} setActiveTab={setActiveTab} />
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
                  // staff_home — where the rep lands at login — is the profile
                  // icon at the end of the bar, the same one in every account.
                  { key: 'leads', label: 'العملاء المحتملون', icon: UserPlus },
                  { key: 'online_clients', label: 'عملائي', icon: UserCheck },
                  { key: 'team_inbox', label: 'صندوق الرسائل', icon: Inbox },
                  { key: 'whatsapp_web', label: 'واتسابي', icon: MessageCircle },
                  { key: 'sales_daqqi_schedule', label: 'جدول الدقي', icon: CalendarDays },
                  { key: 'orders', label: 'مدفوعاتي', icon: CreditCard },
                  { key: 'staff_performance', label: 'إحصائياتي', icon: BarChart3 },
                ]}
                activeTab={activeTab} setActiveTab={setActiveTab}
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
                  // «واتسابي» only: the shared inbox is not collection's.
                  { key: 'whatsapp_web', label: 'واتسابي', icon: MessageCircle },
                  // الاستردادات live inside مدفوعاتي now, in its design.
                  { key: 'orders', label: 'مدفوعاتي', icon: CreditCard },
                  { key: 'overview', label: 'إحصائياتي', icon: BarChart3 },
                ]}
                activeTab={activeTab} setActiveTab={setActiveTab}
                currentStaff={currentStaff} salesDataLoading={salesDataLoading}
                staffNotifBadge={staffNotifBadge} setSalesNotifOpen={setSalesNotifOpen} notify={notify}
              />
            )}

            {/* ── Reception Daqqi horizontal nav (no sidebar) ── */}
            {isReceptionDaqqi && !isDaqqiManager && (
              <CompactRoleNav
                tabs={[
                  { key: 'daqqi_schedule', label: `جدول ${staffBranchLabel}`, icon: CalendarDays },
                  { key: 'daqqi_clients', label: 'عملائي', icon: UserCheck },
                  { key: 'leads', label: 'العملاء المحتملين', icon: UserSearch },
                  { key: 'orders', label: 'مدفوعاتي', icon: CreditCard },
                  { key: 'staff_performance', label: 'إحصائياتي', icon: BarChart3 },
                ]}
                activeTab={activeTab} setActiveTab={setActiveTab}
                currentStaff={currentStaff} salesDataLoading={salesDataLoading}
                staffNotifBadge={staffNotifBadge} setSalesNotifOpen={setSalesNotifOpen} notify={notify}
              />
            )}

            {/* ── Customer service horizontal nav (no sidebar) ──
                Both branches' clients and the desks the section works:
                complaints, refunds, certificates, consultations and the
                service hub. No leads, no management. */}
            {isSupport && (
              <CompactRoleNav
                tabs={[
                  { key: 'daqqi_schedule', label: 'جدول الدقي', icon: CalendarDays },
                  { key: 'daqqi_clients', label: 'عملاء الدقي', icon: Users },
                  { key: 'online_clients', label: 'عملاء الأونلاين', icon: UserCheck },
                  // «خلي يظهرها قاعده البيانات كامله … واظهرلها صفحه المدفوعات»:
                  // a caller is looked up among every person the institute holds,
                  // and the desk sees the payments to answer about them.
                  { key: 'client', label: 'قاعدة البيانات', icon: UserSearch },
                  { key: 'orders', label: 'المدفوعات', icon: CreditCard },
                  { key: 'customer_inbox', label: 'المشاكل', icon: Headphones },
                  { key: 'refund_requests', label: 'الاستردادات', icon: RotateCcw },
                  { key: 'cert_requests', label: 'الشهادات', icon: FileText },
                  { key: 'consultations', label: 'الاستشارات', icon: CalendarCheck },
                  { key: 'service_hub', label: 'الدعم والجودة', icon: Star },
                ]}
                activeTab={activeTab} setActiveTab={setActiveTab}
                currentStaff={currentStaff} salesDataLoading={salesDataLoading}
                staffNotifBadge={staffNotifBadge} setSalesNotifOpen={setSalesNotifOpen} notify={notify}
              />
            )}

            {/* ── Daqqi Manager horizontal nav (no sidebar) ── */}
            {isDaqqiManager && !isAdmin && (
              <CompactRoleNav
                tabs={[
                  { key: 'daqqi_schedule', label: `جدول ${staffBranchLabel}`, icon: CalendarDays },
                  { key: 'daqqi_clients', label: `عملاء ${staffBranchLabel}`, icon: UserCheck },
                  { key: 'leads', label: 'العملاء المحتملين', icon: UserSearch },
                  { key: 'orders', label: 'الطلبات والمدفوعات', icon: CreditCard },
                  { key: 'daqqi_accounting', label: `حسابات ${staffBranchLabel}`, icon: Wallet },
                  { key: 'daqqi_stats', label: `إحصائيات فريق ${staffBranchLabel}`, icon: BarChart3 },
                ]}
                activeTab={activeTab} setActiveTab={setActiveTab}
                currentStaff={currentStaff} salesDataLoading={salesDataLoading}
                staffNotifBadge={staffNotifBadge} setSalesNotifOpen={setSalesNotifOpen} notify={notify}
              />
            )}

            {/* ── Sales & Collection Manager horizontal nav (no sidebar) ── */}
            {isSalesCollectionManager && !isAdmin && (
              <CompactRoleNav
                tabs={[
                  { key: 'leads', label: 'العملاء المحتملون', icon: UserPlus },
                  { key: 'sales_hub', label: 'أداء المبيعات', icon: TrendingUp },
                  { key: 'sales_daqqi_schedule', label: 'جدول الدقي', icon: CalendarDays },
                  { key: 'online_clients', label: 'عملاء الأونلاين', icon: UserCheck },
                  { key: 'online_hub', label: 'فريق التحصيل', icon: Monitor },
                  { key: 'team_inbox', label: 'صندوق الرسائل', icon: Inbox },
                  { key: 'whatsapp_web', label: 'واتسابي', icon: MessageCircle },
                  { key: 'orders', label: 'الطلبات والمدفوعات', icon: CreditCard },
                  { key: 'financial', label: 'التقارير المالية', icon: BarChart3 },
                  { key: 'activity', label: 'سجل النشاط', icon: Activity },
                  { key: 'overview', label: 'إحصائيات', icon: BarChart3 },
                ]}
                activeTab={activeTab} setActiveTab={setActiveTab}
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
                  ]}
                  activeTab={activeTab} setActiveTab={setActiveTab}
                  currentStaff={currentStaff} salesDataLoading={salesDataLoading}
                  staffNotifBadge={staffNotifBadge} setSalesNotifOpen={setSalesNotifOpen} notify={notify}
                  extraTabsSlot={
                    <div className="relative">
                      <button
                        onClick={() => setOnlineMgrAcademyOpen(o => !o)}
                        className={barButtonClass(isAcademyActive || onlineMgrAcademyOpen)}>
                        <BookOpen size={13} />
                        <span>الأكاديمية والمحتوى</span>
                        <ChevronDown size={11} className={`transition-transform ${onlineMgrAcademyOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {onlineMgrAcademyOpen && (
                        <div className="absolute top-full mt-1 right-0 bg-white border border-gray-200 rounded-2xl shadow-2xl z-50 min-w-[220px] p-1.5" dir="rtl">
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
                                className={menuRowClass(isActive)}>
                                <Icon size={14} className="flex-shrink-0" />
                                <span className="truncate flex-1">{item.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  }
                  extraHeaderButtons={
                    <>
                      <button onClick={() => setOnlineMgrFollowupOpen(true)} className={iconButtonClass} title="متابعات التحصيل والأقساط">
                        <AlarmClock size={15} />
                        {onlineMgrFollowupBadge > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold grid place-items-center">{onlineMgrFollowupBadge > 9 ? '9+' : onlineMgrFollowupBadge}</span>}
                      </button>
                      <button onClick={() => setOnlineMgrNewEventsOpen(true)} className={iconButtonClass} title="عملاء أونلاين جدد ومدفوعات">
                        <Banknote size={15} />
                        {onlineMgrNewEventsBadge > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px] font-bold grid place-items-center">{onlineMgrNewEventsBadge > 9 ? '9+' : onlineMgrNewEventsBadge}</span>}
                      </button>
                    </>
                  }
                />
              );
            })()}
</>
  );
}
