import { Bell, RefreshCw } from 'lucide-react';
import type { StaffMember } from '../../../../types';

type ReminderView = 'list' | 'kanban';

type LeadRemindersHeaderProps = {
  overdueCount: number;
  todayCount: number;
  upcomingCount: number;
  completionRate: number;
  reminderView: ReminderView;
  setReminderView: (view: ReminderView) => void;
  isSalesOnly: boolean;
  reminderStaffFilter: string;
  setReminderStaffFilter: (value: string) => void;
  salesReps: StaffMember[];
  snoozeCount: number;
  onClearSnoozes: () => void;
  dueTodayLoading: boolean;
  onRefreshDueToday: () => void;
};

export function LeadRemindersHeader({
  overdueCount,
  todayCount,
  upcomingCount,
  completionRate,
  reminderView,
  setReminderView,
  isSalesOnly,
  reminderStaffFilter,
  setReminderStaffFilter,
  salesReps,
  snoozeCount,
  onClearSnoozes,
  dueTodayLoading,
  onRefreshDueToday,
}: LeadRemindersHeaderProps) {
  const stats = [
    { label: 'متأخرة', val: overdueCount, color: 'bg-red-50 border-red-200 text-red-700', icon: '🔴' },
    { label: 'اليوم', val: todayCount, color: 'bg-amber-50 border-amber-200 text-amber-700', icon: '🟡' },
    { label: 'هذا الأسبوع', val: upcomingCount, color: 'bg-blue-50 border-blue-200 text-blue-700', icon: '📅' },
    {
      label: 'معدل الإنجاز',
      val: `${completionRate}%`,
      color: completionRate >= 70 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-orange-50 border-orange-200 text-orange-700',
      icon: completionRate >= 70 ? '🏆' : '⚡',
    },
  ];

  return (
    <>
      <div className="flex items-center gap-3 pt-2">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="flex items-center gap-1.5 text-sm font-bold text-gray-500 px-2">
          <Bell size={14} className="text-primary-500" />
          التذكيرات والمتابعة
        </span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className={`${stat.color} border rounded-2xl p-4 flex items-center gap-3`}>
            <span className="text-2xl">{stat.icon}</span>
            <div>
              <p className="text-2xl font-extrabold">{stat.val}</p>
              <p className="text-xs opacity-70">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
        <div className="flex gap-1">
          <button
            onClick={() => setReminderView('kanban')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${reminderView === 'kanban' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            بطاقات
          </button>
          <button
            onClick={() => setReminderView('list')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${reminderView === 'list' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            قائمة
          </button>
        </div>

        {!isSalesOnly && (
          <select
            value={reminderStaffFilter}
            onChange={(event) => setReminderStaffFilter(event.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-1.5 text-xs bg-white"
          >
            <option value="">كل المندوبين</option>
            {salesReps.map((rep) => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
          </select>
        )}

        {snoozeCount > 0 && (
          <button onClick={onClearSnoozes} className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition">
            إلغاء التأجيل ({snoozeCount})
          </button>
        )}

        <div className="mr-auto flex items-center gap-2">
          <button onClick={onRefreshDueToday} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition">
            <RefreshCw size={12} className={dueTodayLoading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </div>
    </>
  );
}
