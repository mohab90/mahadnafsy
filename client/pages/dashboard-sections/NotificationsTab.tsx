import React from 'react';
import { Bell, Sparkles, X, AlertCircle } from 'lucide-react';

interface NotificationsTabProps {
  installmentAlerts: any[];
  notifications: any[];
  unreadNotifications: any[];
  dismissedNotifIds: string[];
  setDismissedNotifIds: (ids: string[]) => void;
  setActiveTab: (tab: any) => void;
  setAccountSection: (section: any) => void;
}

export const NotificationsTab: React.FC<NotificationsTabProps> = ({
  installmentAlerts,
  notifications,
  unreadNotifications,
  dismissedNotifIds,
  setDismissedNotifIds,
  setActiveTab,
  setAccountSection,
}) => {
  return (
    <div className="max-w-2xl space-y-4">
      {/* ── Installment due alerts ── */}
      {installmentAlerts.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">تذكيرات الأقساط</p>
          {installmentAlerts.map(alert => (
            <div key={`${alert.planId}-${alert.entryId}`}
              className={`rounded-2xl border p-4 flex gap-4 ${alert.isOverdue ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${alert.isOverdue ? 'bg-red-100' : 'bg-amber-100'}`}>
                <AlertCircle size={20} className={alert.isOverdue ? 'text-red-600' : 'text-amber-600'} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <p className="font-bold text-gray-900 text-sm">{alert.courseTitle}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${alert.isOverdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {alert.isOverdue ? `متأخر ${alert.daysOverdue} يوم` : `خلال ${alert.daysLeft} يوم`}
                  </span>
                </div>
                <p className="text-sm text-gray-700">قسط بمبلغ <span className="font-bold">{alert.amount.toLocaleString()} {alert.currency === 'EGP' ? 'ج.م' : alert.currency}</span> — موعد الاستحقاق: {alert.dueDate}</p>
                <button
                  onClick={() => { setActiveTab('account'); setAccountSection('payments'); }}
                  className="mt-2 text-xs font-bold text-primary-600 hover:text-primary-700 underline"
                >
                  عرض تفاصيل المدفوعات ←
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {notifications.length === 0 && installmentAlerts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center shadow-sm">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Bell size={28} className="text-gray-300" />
          </div>
          <p className="text-gray-500 font-bold">لا توجد إشعارات حالياً</p>
        </div>
      ) : (
        <>
          {unreadNotifications.length > 0 && (
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-gray-600">{unreadNotifications.length} إشعار غير مقروء</p>
              <button
                onClick={() => {
                  const allIds = notifications.map(n => n.id);
                  setDismissedNotifIds(allIds);
                  localStorage.setItem('dismissed-notifs', JSON.stringify(allIds));
                }}
                className="text-xs text-primary-600 hover:text-primary-700 font-bold"
              >
                تعليم الكل كمقروء
              </button>
            </div>
          )}
          {notifications.map(n => {
            const isRead = dismissedNotifIds.includes(n.id);
            const typeConfig = {
              offer:  { bg: 'bg-orange-50', border: 'border-orange-200', icon: <Sparkles size={18} className="text-orange-500" />, badge: 'bg-orange-100 text-orange-700', badgeLabel: 'عرض خاص' },
              update: { bg: 'bg-blue-50',   border: 'border-blue-200',   icon: <Bell size={18} className="text-blue-500" />,    badge: 'bg-blue-100 text-blue-700',   badgeLabel: 'تحديث' },
              info:   { bg: 'bg-primary-50', border: 'border-primary-200', icon: <Bell size={18} className="text-primary-600" />, badge: 'bg-primary-100 text-primary-700', badgeLabel: 'إشعار' },
            };
            const cfg = typeConfig[n.type as keyof typeof typeConfig] || typeConfig.info;
            return (
              <div key={n.id} className={`rounded-2xl border p-4 flex gap-4 transition ${isRead ? 'opacity-60 bg-gray-50 border-gray-100' : `${cfg.bg} ${cfg.border}`}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isRead ? 'bg-gray-100' : 'bg-white shadow-sm'}`}>
                  {cfg.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="font-bold text-gray-900 text-sm">{n.title}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.badgeLabel}</span>
                    {!isRead && <span className="w-2 h-2 bg-red-500 rounded-full flex-shrink-0"></span>}
                  </div>
                  {n.body && <p className="text-sm text-gray-600 leading-relaxed">{n.body}</p>}
                </div>
                {!isRead && (
                  <button
                    onClick={() => {
                      const next = [...dismissedNotifIds, n.id];
                      setDismissedNotifIds(next);
                      localStorage.setItem('dismissed-notifs', JSON.stringify(next));
                    }}
                    className="flex-shrink-0 text-gray-300 hover:text-gray-500 transition"
                    title="تعليم كمقروء"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
};
