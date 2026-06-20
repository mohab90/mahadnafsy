import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlarmClock,
  BarChart3,
  Banknote,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronDown,
  CreditCard,
  FileText,
  FolderKanban,
  Image,
  ListOrdered,
  LogOut,
  MessageSquareText,
  Monitor,
  RotateCcw,
  Tag,
  TrendingUp,
  UserCheck,
  UserCog,
  UserPlus,
  UserSearch,
  Users,
  Video,
  Wallet,
} from 'lucide-react';
import { mysqlAuth } from '../../lib/mysqlapi';
import { type TabKey } from './navigation';
import { type StaffMember } from '../../types';

interface DashboardRoleNavbarProps {
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  isSalesOnly: boolean;
  isCollectionRole: boolean;
  isReceptionDaqqi: boolean;
  isDaqqiManager: boolean;
  isSalesCollectionManager: boolean;
  isOnlineManager: boolean;
  isAdmin: boolean;
  currentStaff: StaffMember | null;
  salesDataLoading: boolean;
  staffNotifBadge: number;
  onlineMgrFollowupBadge: number;
  onlineMgrNewEventsBadge: number;
  setSalesNotifOpen: (open: boolean) => void;
  setOnlineMgrFollowupOpen: (open: boolean) => void;
  setOnlineMgrNewEventsOpen: (open: boolean) => void;
  onlineMgrAcademyOpen: boolean;
  setOnlineMgrAcademyOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function DashboardRoleNavbar({
  activeTab,
  setActiveTab,
  isSalesOnly,
  isCollectionRole,
  isReceptionDaqqi,
  isDaqqiManager,
  isSalesCollectionManager,
  isOnlineManager,
  isAdmin,
  currentStaff,
  salesDataLoading,
  staffNotifBadge,
  onlineMgrFollowupBadge,
  onlineMgrNewEventsBadge,
  setSalesNotifOpen,
  setOnlineMgrFollowupOpen,
  setOnlineMgrNewEventsOpen,
  onlineMgrAcademyOpen,
  setOnlineMgrAcademyOpen,
}: DashboardRoleNavbarProps) {
  const navigate = useNavigate();

  const handleLogout = () => { mysqlAuth.logout(); navigate('/auth'); };

  const staffBadge = (badge: number) =>
    badge > 0 ? (
      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[8px] font-bold grid place-items-center">
        {badge > 9 ? '9+' : badge}
      </span>
    ) : null;

  const navBtnCls = (isActive: boolean, activeColor: string) =>
    `flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition ${
      isActive ? `${activeColor} text-white shadow-md` : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    }`;

  return (
    <>
      {/* ── Sales horizontal nav (no sidebar) ── */}
      {isSalesOnly && (
        <nav className="bg-white border border-gray-200 rounded-2xl p-2 shadow-sm flex items-center gap-2 flex-wrap justify-between" dir="rtl">
          <div className="flex items-center gap-1.5 flex-wrap">
            {(
              [
                { key: 'leads' as TabKey, label: 'العملاء المحتملون', icon: UserPlus },
                { key: 'online_clients' as TabKey, label: 'عملائي', icon: UserCheck },
                { key: 'orders' as TabKey, label: 'مدفوعاتي', icon: CreditCard },
                { key: 'overview' as TabKey, label: 'إحصائياتي', icon: BarChart3 },
                { key: 'staff_settings' as TabKey, label: 'ملفي الشخصي', icon: UserCog },
              ] as { key: TabKey; label: string; icon: React.ComponentType<{ size?: number }> }[]
            ).map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={navBtnCls(activeTab === tab.key, 'bg-primary-600 shadow-primary-200')}>
                  <Icon size={15} />
                  {tab.label}
                </button>
              );
            })}
          </div>
          {currentStaff && (
            <div className="flex items-center gap-2 pl-2 text-sm text-gray-600">
              <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 grid place-items-center text-xs font-bold flex-shrink-0">
                {currentStaff.name.charAt(0)}
              </div>
              <span className="font-semibold text-gray-800">{currentStaff.name}</span>
              {salesDataLoading && <span className="w-4 h-4 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />}
              <button onClick={() => setSalesNotifOpen(true)}
                className="relative w-7 h-7 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-600 hover:text-amber-800 grid place-items-center transition"
                title="الإشعارات والمتابعات">
                <Bell size={13} />
                {staffBadge(staffNotifBadge)}
              </button>
              <button onClick={handleLogout}
                className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 grid place-items-center transition"
                title="تسجيل الخروج"><LogOut size={13} /></button>
            </div>
          )}
        </nav>
      )}

      {/* ── Collection horizontal nav (no sidebar) ── */}
      {isCollectionRole && (
        <nav className="bg-white border border-gray-200 rounded-2xl p-2 shadow-sm flex items-center gap-2 flex-wrap justify-between" dir="rtl">
          <div className="flex items-center gap-1.5 flex-wrap">
            {(
              [
                { key: 'online_clients' as TabKey, label: 'عملاء الاونلاين', icon: UserCheck },
                { key: 'leads' as TabKey, label: 'العملاء المحتملين', icon: UserSearch },
                { key: 'refund_requests' as TabKey, label: 'طلبات الاسترداد', icon: RotateCcw },
                { key: 'orders' as TabKey, label: 'مدفوعاتي', icon: CreditCard },
                { key: 'overview' as TabKey, label: 'إحصائياتي', icon: BarChart3 },
                { key: 'staff_settings' as TabKey, label: 'ملفي الشخصي', icon: UserCog },
              ] as { key: TabKey; label: string; icon: React.ComponentType<{ size?: number }> }[]
            ).map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={navBtnCls(activeTab === tab.key, 'bg-primary-600 shadow-primary-200')}>
                  <Icon size={15} />
                  {tab.label}
                </button>
              );
            })}
          </div>
          {currentStaff && (
            <div className="flex items-center gap-2 pl-2 text-sm text-gray-600">
              <div className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 grid place-items-center text-xs font-bold flex-shrink-0">
                {currentStaff.name.charAt(0)}
              </div>
              <span className="font-semibold text-gray-800">{currentStaff.name}</span>
              {salesDataLoading && <span className="w-4 h-4 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />}
              <button onClick={() => setSalesNotifOpen(true)}
                className="relative w-7 h-7 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-600 hover:text-amber-800 grid place-items-center transition"
                title="الإشعارات والمتابعات">
                <Bell size={13} />
                {staffBadge(staffNotifBadge)}
              </button>
              <button onClick={handleLogout}
                className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 grid place-items-center transition"
                title="تسجيل الخروج"><LogOut size={13} /></button>
            </div>
          )}
        </nav>
      )}

      {/* ── Reception Daqqi horizontal nav (no sidebar) ── */}
      {isReceptionDaqqi && !isDaqqiManager && (
        <nav className="bg-white border border-gray-200 rounded-2xl p-2 shadow-sm flex items-center gap-2 flex-wrap justify-between" dir="rtl">
          <div className="flex items-center gap-1.5 flex-wrap">
            {(
              [
                { key: 'daqqi_schedule' as TabKey, label: 'جدول الدقي', icon: CalendarDays },
                { key: 'my_clients' as TabKey, label: 'عملائي', icon: UserCheck },
                { key: 'leads' as TabKey, label: 'العملاء المحتملين', icon: UserSearch },
                { key: 'orders' as TabKey, label: 'مدفوعاتي', icon: CreditCard },
                { key: 'overview' as TabKey, label: 'إحصائياتي', icon: BarChart3 },
                { key: 'staff_settings' as TabKey, label: 'ملفي الشخصي', icon: UserCog },
              ] as { key: TabKey; label: string; icon: React.ComponentType<{ size?: number }> }[]
            ).map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={navBtnCls(activeTab === tab.key, 'bg-primary-600 shadow-primary-200')}>
                  <Icon size={15} />
                  {tab.label}
                </button>
              );
            })}
          </div>
          {currentStaff && (
            <div className="flex items-center gap-2 pl-2 text-sm text-gray-600">
              <div className="w-7 h-7 rounded-full bg-orange-100 text-orange-700 grid place-items-center text-xs font-bold flex-shrink-0">
                {currentStaff.name.charAt(0)}
              </div>
              <span className="font-semibold text-gray-800">{currentStaff.name}</span>
              {salesDataLoading && <span className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />}
              <button onClick={() => setSalesNotifOpen(true)}
                className="relative w-7 h-7 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-600 hover:text-amber-800 grid place-items-center transition"
                title="الإشعارات والمتابعات">
                <Bell size={13} />
                {staffBadge(staffNotifBadge)}
              </button>
              <button onClick={handleLogout}
                className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 grid place-items-center transition"
                title="تسجيل الخروج"><LogOut size={13} /></button>
            </div>
          )}
        </nav>
      )}

      {/* ── Daqqi Manager horizontal nav (no sidebar) ── */}
      {isDaqqiManager && !isAdmin && (
        <nav className="bg-white border border-gray-200 rounded-2xl p-2 shadow-sm flex items-center gap-2 flex-wrap justify-between" dir="rtl">
          <div className="flex items-center gap-1.5 flex-wrap">
            {(
              [
                { key: 'daqqi_schedule' as TabKey, label: 'جدول الدقي', icon: CalendarDays },
                { key: 'my_clients' as TabKey, label: 'عملاء الدقي', icon: UserCheck },
                { key: 'leads' as TabKey, label: 'العملاء المحتملين', icon: UserSearch },
                { key: 'orders' as TabKey, label: 'الطلبات والمدفوعات', icon: CreditCard },
                { key: 'daqqi_accounting' as TabKey, label: 'حسابات الدقي', icon: Wallet },
                { key: 'daqqi_stats' as TabKey, label: 'إحصائيات فريق الدقي', icon: BarChart3 },
                { key: 'staff_settings' as TabKey, label: 'ملفي الشخصي', icon: UserCog },
              ] as { key: TabKey; label: string; icon: React.ComponentType<{ size?: number }> }[]
            ).map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={navBtnCls(activeTab === tab.key, 'bg-purple-600 shadow-purple-200')}>
                  <Icon size={15} />
                  {tab.label}
                </button>
              );
            })}
          </div>
          {currentStaff && (
            <div className="flex items-center gap-2 pl-2 text-sm text-gray-600">
              <div className="w-7 h-7 rounded-full bg-purple-100 text-purple-700 grid place-items-center text-xs font-bold flex-shrink-0">
                {currentStaff.name.charAt(0)}
              </div>
              <span className="font-semibold text-gray-800">{currentStaff.name}</span>
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-bold">مدير الدقي</span>
              {salesDataLoading && <span className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />}
              <button onClick={() => setSalesNotifOpen(true)}
                className="relative w-7 h-7 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-600 hover:text-amber-800 grid place-items-center transition"
                title="الإشعارات والمتابعات">
                <Bell size={13} />
                {staffBadge(staffNotifBadge)}
              </button>
              <button onClick={handleLogout}
                className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 grid place-items-center transition"
                title="تسجيل الخروج"><LogOut size={13} /></button>
            </div>
          )}
        </nav>
      )}

      {/* ── Sales & Collection Manager horizontal nav (no sidebar) ── */}
      {isSalesCollectionManager && !isAdmin && (
        <nav className="bg-white border border-gray-200 rounded-2xl p-2 shadow-sm flex items-center gap-2 flex-wrap justify-between" dir="rtl">
          <div className="flex items-center gap-1.5 flex-wrap">
            {([
              { key: 'leads' as TabKey, label: 'العملاء المحتملون', icon: UserPlus },
              { key: 'sales_hub' as TabKey, label: 'فريق المبيعات', icon: TrendingUp },
              { key: 'online_clients' as TabKey, label: 'عملاء الأونلاين', icon: UserCheck },
              { key: 'online_hub' as TabKey, label: 'فريق التحصيل', icon: Monitor },
              { key: 'orders' as TabKey, label: 'الطلبات والمدفوعات', icon: CreditCard },
              { key: 'financial' as TabKey, label: 'التقارير المالية', icon: BarChart3 },
              { key: 'activity' as TabKey, label: 'سجل النشاط', icon: Activity },
              { key: 'overview' as TabKey, label: 'إحصائيات', icon: BarChart3 },
              { key: 'staff_settings' as TabKey, label: 'ملفي الشخصي', icon: UserCog },
            ] as { key: TabKey; label: string; icon: React.ComponentType<{ size?: number }> }[]).map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={navBtnCls(activeTab === tab.key, 'bg-indigo-600 shadow-indigo-200')}>
                  <Icon size={15} />
                  {tab.label}
                </button>
              );
            })}
          </div>
          {currentStaff && (
            <div className="flex items-center gap-2 pl-2 text-sm text-gray-600">
              <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center text-xs font-bold flex-shrink-0">
                {currentStaff.name.charAt(0)}
              </div>
              <span className="font-semibold text-gray-800">{currentStaff.name}</span>
              <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">مدير المبيعات والتحصيل</span>
              {salesDataLoading && <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />}
              <button onClick={() => setSalesNotifOpen(true)}
                className="relative w-7 h-7 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-600 hover:text-amber-800 grid place-items-center transition"
                title="الإشعارات">
                <Bell size={13} />
                {staffBadge(staffNotifBadge)}
              </button>
              <button onClick={handleLogout}
                className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 grid place-items-center transition"
                title="تسجيل الخروج"><LogOut size={13} /></button>
            </div>
          )}
        </nav>
      )}

      {/* ── Online Manager horizontal nav (no sidebar) ── */}
      {isOnlineManager && !isAdmin && (() => {
        const academyTabKeys: TabKey[] = ['courses','lectures','instructors','bundles','testimonials','discounts','quizzes','live_streams','community','institute_gallery'];
        const isAcademyActive = academyTabKeys.includes(activeTab as TabKey);
        return (
          <nav className="bg-white border border-gray-200 rounded-2xl p-2 shadow-sm flex items-center gap-2 flex-wrap justify-between" dir="rtl">
            <div className="flex items-center gap-1.5 flex-wrap">
              {([
                { key: 'online_clients' as TabKey, label: 'عملاء الاونلاين', icon: UserCheck },
                { key: 'client' as TabKey, label: 'قاعدة العملاء', icon: UserSearch },
                { key: 'refund_requests' as TabKey, label: 'طلبات الاسترداد', icon: RotateCcw },
                { key: 'orders' as TabKey, label: 'الطلبات والمدفوعات', icon: CreditCard },
                { key: 'overview' as TabKey, label: 'إحصائيات', icon: BarChart3 },
                { key: 'staff_settings' as TabKey, label: 'ملفي الشخصي', icon: UserCog },
              ] as { key: TabKey; label: string; icon: React.ComponentType<{ size?: number }> }[]).map(tab => {
                const Icon = tab.icon;
                return (
                  <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                    className={navBtnCls(activeTab === tab.key, 'bg-emerald-600 shadow-emerald-200')}>
                    <Icon size={15} />
                    {tab.label}
                  </button>
                );
              })}
              {/* Academy dropdown */}
              <div className="relative">
                <button
                  onClick={() => setOnlineMgrAcademyOpen(o => !o)}
                  className={navBtnCls(isAcademyActive, 'bg-emerald-600 shadow-emerald-200')}>
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
            </div>
            {currentStaff && (
              <div className="flex items-center gap-2 pl-2 text-sm text-gray-600">
                <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center text-xs font-bold flex-shrink-0">
                  {currentStaff.name.charAt(0)}
                </div>
                <span className="font-semibold text-gray-800">{currentStaff.name}</span>
                <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">مسئول الأونلاين</span>
                {salesDataLoading && <span className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />}
                <button onClick={() => setOnlineMgrFollowupOpen(true)}
                  className="relative w-7 h-7 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 hover:text-teal-800 grid place-items-center transition"
                  title="متابعات التحصيل والأقساط">
                  <AlarmClock size={13} />
                  {onlineMgrFollowupBadge > 0 && (
                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[8px] font-bold grid place-items-center">
                      {onlineMgrFollowupBadge > 9 ? '9+' : onlineMgrFollowupBadge}
                    </span>
                  )}
                </button>
                <button onClick={() => setOnlineMgrNewEventsOpen(true)}
                  className="relative w-7 h-7 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-600 hover:text-emerald-800 grid place-items-center transition"
                  title="عملاء أونلاين جدد ومدفوعات">
                  <Banknote size={13} />
                  {onlineMgrNewEventsBadge > 0 && (
                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 text-white text-[8px] font-bold grid place-items-center">
                      {onlineMgrNewEventsBadge > 9 ? '9+' : onlineMgrNewEventsBadge}
                    </span>
                  )}
                </button>
                <button onClick={handleLogout}
                  className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 grid place-items-center transition"
                  title="تسجيل الخروج"><LogOut size={13} /></button>
              </div>
            )}
          </nav>
        );
      })()}
    </>
  );
}
