import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  User, TrendingUp, Clock, CheckCircle, Activity, Calendar,
  Phone, UserCheck, Target, Star, ArrowLeft, Bell, FileText,
  BarChart3, Zap, RefreshCw, ChevronRight, MessageCircle,
  UserPlus, Percent, AlertCircle, Briefcase, Award,
} from 'lucide-react';
import type { LeadItem, SubscriberItem, StaffMember } from '../../../types';

type TabKey = string;
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface StaffHomeTabProps {
  staff: StaffMember;
  leads: LeadItem[];
  subscribers: SubscriberItem[];
  notify: NotifyFn;
  onNavigate: (tab: TabKey) => void;
}

const ROLE_LABEL: Record<string, string> = {
  sales:                    'مندوب مبيعات',
  collection:               'موظف تحصيل',
  support:                  'خدمة عملاء',
  manager:                  'مدير',
  online_manager:           'مدير أونلاين',
  consultant:               'استشاري',
  admin:                    'مدير النظام',
  hr:                       'موارد بشرية',
  sales_collection_manager: 'مدير مبيعات وتحصيل',
  instructor:               'مدرب',
  trainer:                  'مدرب',
  accountant:               'محاسب',
  daqqi_manager:            'مدير الدقي',
  reception_daqqi:          'استقبال الدقي',
};

const STATUS_LABEL: Record<string, string> = {
  new: 'جديد', contacted: 'تم التواصل', interested: 'مهتم',
  converted: 'محوّل', lost: 'مفقود', no_answer: 'لا يرد',
  not_interested_hidden: 'غير مهتم',
};
const STATUS_COLOR: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-amber-100 text-amber-700',
  interested: 'bg-purple-100 text-purple-700',
  converted: 'bg-emerald-100 text-emerald-700',
  lost: 'bg-red-100 text-red-700',
  no_answer: 'bg-gray-100 text-gray-600',
};

export default function StaffHomeTab({ staff, leads, subscribers, notify, onNavigate }: StaffHomeTabProps) {
  const [leaveBalance, setLeaveBalance] = useState<number | null>(null);
  const [pendingLeaves, setPendingLeaves] = useState<number>(0);
  const [myTasks, setMyTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = new Date().toISOString().slice(0, 7);

  // ── Derived stats ───────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const myLeads = leads;
    const totalLeads = myLeads.length;
    const converted = myLeads.filter(l => l.status === 'converted');
    const convertedThisMonth = converted.filter(
      l => ((l as any).updatedAt || l.createdAt || '').slice(0, 7) === thisMonth,
    );
    const convRate = totalLeads > 0 ? Math.round((converted.length / totalLeads) * 100) : 0;

    // Overdue follow-ups (past date, still active)
    const overdueFollowups = myLeads.filter(
      l => !['converted', 'lost', 'not_interested_hidden'].includes(l.status || '')
        && l.nextFollowUpDate && l.nextFollowUpDate < today,
    );

    // Today's follow-ups
    const todayFollowups = myLeads.filter(
      l => !['converted', 'lost', 'not_interested_hidden'].includes(l.status || '')
        && l.nextFollowUpDate === today,
    );

    // This month new leads
    const newThisMonth = myLeads.filter(l => (l.createdAt || '').slice(0, 7) === thisMonth);

    // This month calls/communications
    const callsThisMonth = myLeads.reduce((n, l) =>
      n + (l.communications || []).filter(c => (c.date || '').slice(0, 7) === thisMonth).length, 0,
    );

    // Revenue (from subscribers paymentHistory)
    const revenueThisMonth = subscribers.flatMap(s => s.paymentHistory || [])
      .filter(p => (p.at || '').slice(0, 7) === thisMonth)
      .reduce((sum, p) => {
        const egp = p.currency === 'EGP' ? Number(p.amount) : p.currency === 'SAR' ? Number(p.amount) * 13 : Number(p.amount) * 50;
        return sum + (isNaN(egp) ? 0 : egp);
      }, 0);

    // 7-day communications chart
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      const dateStr = d.toISOString().slice(0, 10);
      return {
        day: dateStr,
        label: d.toLocaleDateString('ar-EG', { weekday: 'short' }),
        calls: myLeads.reduce((n, l) =>
          n + (l.communications || []).filter(c => c.date?.slice(0, 10) === dateStr).length, 0,
        ),
        converted: converted.filter(c =>
          ((c as any).updatedAt || c.createdAt || '').slice(0, 10) === dateStr,
        ).length,
      };
    });

    const maxCalls = Math.max(...last7.map(d => d.calls), 1);

    // Recent activity — leads updated in last 3 days
    const recentActivity = [...myLeads]
      .sort((a, b) => ((b as any).updatedAt || b.createdAt || '') > ((a as any).updatedAt || a.createdAt || '') ? 1 : -1)
      .slice(0, 8);

    // Urgent leads: new + interested with no follow-up set
    const urgentLeads = myLeads
      .filter(l => ['new', 'interested', 'contacted'].includes(l.status || '') && !l.nextFollowUpDate)
      .slice(0, 5);

    const commissionRate = (staff as any).commissionRate || 0;
    const commission = commissionRate > 0 ? Math.round(revenueThisMonth * commissionRate / 100) : 0;

    return {
      totalLeads, converted: converted.length, convertedThisMonth: convertedThisMonth.length,
      convRate, overdueFollowups, todayFollowups, newThisMonth: newThisMonth.length,
      callsThisMonth, revenueThisMonth, last7, maxCalls, recentActivity,
      urgentLeads, commission, commissionRate,
    };
  }, [leads, subscribers, today, thisMonth, staff]);

  // ── Load leaves + tasks ─────────────────────────────────────────────────
  const loadHrData = useCallback(async () => {
    if (!staff?.id) return;
    try {
      const res = await fetch(`/api/admin/hr/leaves?staff_id=${staff.id}`, { credentials: 'include' });
      if (res.ok) {
        const data: any[] = await res.json();
        setPendingLeaves(data.filter(l => l.status === 'PENDING').length);
        // Count approved leaves remaining this year
        const approved = data.filter(l => l.status === 'APPROVED' && l.leave_type === 'ANNUAL');
        const usedDays = approved.reduce((sum, l) => {
          const s = new Date(l.start_date), e = new Date(l.end_date);
          const days = Math.ceil((e.getTime() - s.getTime()) / 86400000) + 1;
          return sum + (isNaN(days) ? 0 : days);
        }, 0);
        setLeaveBalance(Math.max(0, 21 - usedDays)); // Assume 21 annual days
      }
    } catch { /* silent */ }
  }, [staff?.id]);

  const loadTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const res = await fetch('/api/admin/tasks?limit=5&my=true', { credentials: 'include' });
      if (res.ok) setMyTasks(await res.json());
    } catch { /* silent */ } finally { setLoadingTasks(false); }
  }, []);

  useEffect(() => {
    loadHrData();
    loadTasks();
  }, [loadHrData, loadTasks]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.allSettled([loadHrData(), loadTasks()]);
    setTimeout(() => setIsRefreshing(false), 600);
  }, [loadHrData, loadTasks]);

  // ── Quick actions by role ────────────────────────────────────────────────
  const quickActions = useMemo(() => {
    const role = (staff.role || '').toLowerCase();
    const base = [
      { label: 'ملفي الوظيفي', icon: Briefcase, tab: 'my_hr', color: 'bg-violet-50 text-violet-600 border-violet-200' },
      { label: 'لوحة المهام', icon: CheckCircle, tab: 'tasks_board', color: 'bg-indigo-50 text-indigo-600 border-indigo-200' },
    ];
    if (['sales', 'sales_collection_manager', 'support', 'consultant'].includes(role)) {
      base.unshift({ label: 'ليداتي', icon: UserPlus, tab: 'leads', color: 'bg-amber-50 text-amber-600 border-amber-200' });
    }
    if (['collection', 'online_manager', 'sales_collection_manager', 'support'].includes(role)) {
      base.unshift({ label: 'عملائي', icon: UserCheck, tab: 'online_clients', color: 'bg-teal-50 text-teal-600 border-teal-200' });
    }
    if (['instructor', 'trainer'].includes(role)) {
      base.unshift({ label: 'الكورسات', icon: Award, tab: 'courses', color: 'bg-blue-50 text-blue-600 border-blue-200' });
    }
    if (['hr'].includes(role)) {
      base.unshift({ label: 'فريق العمل', icon: User, tab: 'hr', color: 'bg-purple-50 text-purple-600 border-purple-200' });
    }
    return base.slice(0, 5);
  }, [staff.role]);

  const isSalesRole = ['sales', 'consultant', 'sales_collection_manager'].includes((staff.role || '').toLowerCase());
  const isCollectionRole = ['collection', 'online_manager', 'sales_collection_manager'].includes((staff.role || '').toLowerCase());

  const avatarInitials = (staff.name || '?').split(' ').slice(0, 2).map(w => w[0]).join('');

  // ── Greeting based on time ───────────────────────────────────────────────
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'صباح الخير' : hour < 17 ? 'مساء الخير' : 'مساء النور';

  return (
    <div className="space-y-5">
      {/* ── Header + Refresh ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900">بوابتي الشخصية</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          تحديث
        </button>
      </div>

      {/* ── Welcome Card ────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-500 to-purple-600 rounded-2xl p-5 text-white shadow-lg">
        {/* background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white" />
          <div className="absolute -bottom-10 -left-10 w-56 h-56 rounded-full bg-white" />
        </div>
        <div className="relative flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white font-extrabold text-xl flex-shrink-0 border border-white/30">
            {avatarInitials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-indigo-100 text-sm">{greeting} 👋</p>
            <h3 className="text-xl font-extrabold truncate">{staff.name}</h3>
            <p className="text-indigo-200 text-sm">{ROLE_LABEL[staff.role || ''] || staff.role}</p>
          </div>
          {stats.commissionRate > 0 && (
            <div className="bg-white/20 border border-white/30 rounded-xl px-3 py-2 text-center flex-shrink-0">
              <p className="text-xs text-indigo-100">عمولتك</p>
              <p className="font-extrabold text-lg">{stats.commissionRate}%</p>
            </div>
          )}
        </div>

        {/* Alert strip — overdue follow-ups */}
        {stats.overdueFollowups.length > 0 && (
          <div className="relative mt-4 bg-red-500/30 border border-red-300/40 rounded-xl px-4 py-2.5 flex items-center gap-3">
            <AlertCircle size={16} className="text-red-200 flex-shrink-0" />
            <p className="text-sm text-white">
              <span className="font-bold">{stats.overdueFollowups.length}</span> متابعة متأخرة — تحتاج إجراء فوري
            </p>
            <button
              onClick={() => onNavigate('leads')}
              className="mr-auto text-xs bg-white/20 hover:bg-white/30 px-2.5 py-1 rounded-lg transition-colors"
            >
              عرضها
            </button>
          </div>
        )}
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────────── */}
      {(isSalesRole || isCollectionRole) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {isSalesRole && (<>
            <KpiCard
              title="ليداتي الكلية" value={stats.totalLeads}
              icon={UserPlus} bg="bg-amber-50" text="text-amber-600" border="border-amber-200"
            />
            <KpiCard
              title="تحويلات هذا الشهر" value={stats.convertedThisMonth}
              icon={TrendingUp} bg="bg-emerald-50" text="text-emerald-600" border="border-emerald-200"
            />
            <KpiCard
              title="معدل التحويل" value={`${stats.convRate}%`}
              icon={Percent} bg="bg-purple-50" text="text-purple-600" border="border-purple-200"
            />
            <KpiCard
              title="مكالمات هذا الشهر" value={stats.callsThisMonth}
              icon={Phone} bg="bg-blue-50" text="text-blue-600" border="border-blue-200"
            />
          </>)}
          {isCollectionRole && (<>
            <KpiCard
              title="عملائي المسندون" value={subscribers.length}
              icon={UserCheck} bg="bg-teal-50" text="text-teal-600" border="border-teal-200"
            />
            <KpiCard
              title="إيرادات هذا الشهر"
              value={`${Math.round(stats.revenueThisMonth).toLocaleString('ar-EG')} ج`}
              icon={BarChart3} bg="bg-green-50" text="text-green-600" border="border-green-200"
            />
          </>)}
          {stats.commissionRate > 0 && (
            <KpiCard
              title="عمولتي هذا الشهر"
              value={`${stats.commission.toLocaleString('ar-EG')} ج`}
              icon={Star} bg="bg-orange-50" text="text-orange-600" border="border-orange-200"
            />
          )}
          <KpiCard
            title="متابعات اليوم" value={stats.todayFollowups.length}
            icon={Bell} bg="bg-rose-50" text="text-rose-600" border="border-rose-200"
          />
        </div>
      )}

      {/* ── Main content grid ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Left: 7-day activity chart (2 cols) */}
        <div className="lg:col-span-2 space-y-5">

          {/* Activity chart */}
          {(isSalesRole) && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h4 className="font-bold text-gray-800 text-sm mb-4 flex items-center gap-2">
                <Activity size={15} className="text-indigo-500" />
                نشاطي — آخر 7 أيام
              </h4>
              <div className="flex items-end gap-1.5 h-28">
                {stats.last7.map((d, i) => {
                  const heightPct = Math.max(4, (d.calls / stats.maxCalls) * 100);
                  const isToday = d.day === today;
                  return (
                    <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[9px] text-gray-400 font-medium">{d.calls > 0 ? d.calls : ''}</span>
                      <div className="w-full relative">
                        <div
                          className="w-full rounded-t-md transition-all duration-500"
                          style={{
                            height: `${Math.round(heightPct * 0.8)}px`,
                            background: isToday
                              ? 'linear-gradient(180deg,#6366f1,#4f46e5)'
                              : i === stats.last7.length - 1
                                ? 'linear-gradient(180deg,#10b981,#059669)'
                                : 'linear-gradient(180deg,#a5b4fc,#818cf8)',
                            opacity: d.calls === 0 ? 0.25 : 1,
                            minHeight: '6px',
                          }}
                        />
                        {d.converted > 0 && (
                          <div
                            className="absolute bottom-0 left-0 right-0 rounded-t-md bg-emerald-500 opacity-70"
                            style={{ height: `${Math.round((d.converted / stats.maxCalls) * 100 * 0.8)}px`, minHeight: '4px' }}
                          />
                        )}
                      </div>
                      <span className={`text-[9px] ${isToday ? 'text-indigo-600 font-bold' : 'text-gray-400'}`}>{d.label}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-400">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-400 inline-block" /> مكالمات</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> تحويلات</span>
              </div>
            </div>
          )}

          {/* Today's follow-ups */}
          {stats.todayFollowups.length > 0 && (
            <div className="bg-white border border-rose-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                  <Bell size={15} className="text-rose-500" />
                  متابعات اليوم
                  <span className="bg-rose-100 text-rose-600 text-xs font-bold px-2 py-0.5 rounded-full">
                    {stats.todayFollowups.length}
                  </span>
                </h4>
                <button onClick={() => onNavigate('leads')} className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
                  عرض الكل <ArrowLeft size={12} />
                </button>
              </div>
              <div className="space-y-2">
                {stats.todayFollowups.slice(0, 5).map(lead => (
                  <FollowupRow key={lead.id} lead={lead} onNavigate={() => onNavigate('leads')} />
                ))}
              </div>
            </div>
          )}

          {/* Recent activity */}
          {stats.recentActivity.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                  <Clock size={15} className="text-gray-500" />
                  آخر النشاطات
                </h4>
                <button onClick={() => onNavigate('leads')} className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
                  الكل <ArrowLeft size={12} />
                </button>
              </div>
              <div className="space-y-2">
                {stats.recentActivity.map(lead => (
                  <div key={lead.id} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                    <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-600 font-bold text-xs">
                      {(lead.name || '?').charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{lead.name}</p>
                      <p className="text-xs text-gray-400 truncate">{lead.phone}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_COLOR[lead.status || ''] || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[lead.status || ''] || lead.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: quick actions + HR + tasks */}
        <div className="space-y-5">

          {/* Quick actions */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <h4 className="font-bold text-gray-800 text-sm mb-3 flex items-center gap-2">
              <Zap size={15} className="text-amber-500" />
              وصول سريع
            </h4>
            <div className="space-y-2">
              {quickActions.map(action => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.tab}
                    onClick={() => onNavigate(action.tab)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border ${action.color} hover:opacity-80 transition-opacity text-sm font-medium`}
                  >
                    <Icon size={15} />
                    {action.label}
                    <ChevronRight size={13} className="mr-auto opacity-50" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* HR Card */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <h4 className="font-bold text-gray-800 text-sm mb-4 flex items-center gap-2">
              <Calendar size={15} className="text-violet-500" />
              الموارد البشرية
            </h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">رصيد الإجازات المتبقي</span>
                <span className="font-bold text-gray-900">
                  {leaveBalance === null ? '—' : `${leaveBalance} يوم`}
                </span>
              </div>
              {pendingLeaves > 0 && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-700">
                  <Clock size={13} />
                  <span>{pendingLeaves} طلب إجازة معلق</span>
                </div>
              )}
              <button
                onClick={() => onNavigate('my_hr')}
                className="w-full text-center text-sm text-indigo-600 font-medium hover:underline pt-1"
              >
                إدارة إجازاتي وملفي الوظيفي ←
              </button>
            </div>
          </div>

          {/* My tasks */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                <FileText size={15} className="text-indigo-500" />
                مهامي
              </h4>
              <button onClick={() => onNavigate('tasks_board')} className="text-xs text-indigo-600 hover:underline">عرض الكل</button>
            </div>
            {loadingTasks ? (
              <div className="flex items-center justify-center py-4 text-gray-400 text-sm gap-2">
                <span className="w-4 h-4 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" />
                جاري التحميل...
              </div>
            ) : myTasks.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">لا توجد مهام معلقة 🎉</p>
            ) : (
              <div className="space-y-2">
                {myTasks.map((task: any) => (
                  <div key={task.id} className="flex items-start gap-2 text-sm">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      task.priority === 'high' ? 'bg-red-500' :
                      task.priority === 'medium' ? 'bg-amber-500' : 'bg-gray-400'
                    }`} />
                    <span className="text-gray-700 text-xs leading-relaxed">{task.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Urgent leads (no follow-up set) */}
          {stats.urgentLeads.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 shadow-sm">
              <h4 className="font-bold text-amber-800 text-sm mb-3 flex items-center gap-2">
                <MessageCircle size={15} className="text-amber-600" />
                ليدات بدون موعد متابعة
                <span className="bg-amber-200 text-amber-800 text-xs font-bold px-2 py-0.5 rounded-full">
                  {stats.urgentLeads.length}
                </span>
              </h4>
              <div className="space-y-2">
                {stats.urgentLeads.map(lead => (
                  <div key={lead.id} className="flex items-center gap-2 text-sm">
                    <User size={12} className="text-amber-600 flex-shrink-0" />
                    <span className="text-amber-900 truncate">{lead.name}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => onNavigate('leads')}
                className="mt-3 w-full text-xs text-amber-700 font-medium hover:underline"
              >
                حدد مواعيد متابعة الآن ←
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({ title, value, icon: Icon, bg, text, border }: {
  title: string; value: string | number; icon: React.FC<any>; bg: string; text: string; border: string;
}) {
  return (
    <article className={`bg-white border ${border} rounded-2xl p-4 shadow-sm flex items-center gap-3`}>
      <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
        <Icon size={17} className={text} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-gray-500 leading-tight truncate">{title}</p>
        <h3 className="text-xl font-extrabold text-gray-900 mt-0.5 truncate">{value}</h3>
      </div>
    </article>
  );
}

function FollowupRow({ lead, onNavigate }: { lead: LeadItem; onNavigate: () => void }) {
  const phone = lead.phone?.replace(/\D/g, '');
  return (
    <div className="flex items-center gap-3 py-2 border-b border-rose-100 last:border-0">
      <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center flex-shrink-0 text-rose-700 font-bold text-xs">
        {(lead.name || '?').charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate">{lead.name}</p>
        <p className="text-xs text-gray-400">{lead.phone}</p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {phone && (
          <a
            href={`https://wa.me/${phone}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center hover:bg-emerald-200 transition-colors"
            title="واتساب"
          >
            <MessageCircle size={13} />
          </a>
        )}
        <button
          onClick={onNavigate}
          className="w-7 h-7 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center hover:bg-rose-200 transition-colors"
          title="فتح في الليدز"
        >
          <ArrowLeft size={13} />
        </button>
      </div>
    </div>
  );
}
