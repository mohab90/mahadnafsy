import React from 'react';
import { AlertCircle, Bell, Sparkles, X } from 'lucide-react';

type NotificationItem = {
  id: string;
  title: string;
  body?: string;
  type?: string;
};

type InstallmentAlert = {
  planId: string;
  entryId: string;
  courseTitle: string;
  isOverdue: boolean;
  daysOverdue?: number;
  daysLeft?: number;
  amount: number;
  currency: string;
  dueDate: string;
};

type StudentNotificationsTabProps = {
  notifications: NotificationItem[];
  unreadNotifications: NotificationItem[];
  dismissedNotifIds: string[];
  installmentAlerts: InstallmentAlert[];
  onMarkAllRead: () => void;
  onDismissNotification: (id: string) => void;
  onOpenPayments: () => void;
};

export function StudentNotificationsTab({
  notifications,
  unreadNotifications,
  dismissedNotifIds,
  installmentAlerts,
  onMarkAllRead,
  onDismissNotification,
  onOpenPayments,
}: StudentNotificationsTabProps) {
  return (
    <div className="max-w-2xl space-y-4">
      {installmentAlerts.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-700">تذكيرات الأقساط</p>
          {installmentAlerts.map((alert) => (
            <div
              key={`${alert.planId}-${alert.entryId}`}
              className={`flex gap-4 rounded-2xl border p-4 ${alert.isOverdue ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}
            >
              <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${alert.isOverdue ? 'bg-red-100' : 'bg-amber-100'}`}>
                <AlertCircle size={20} className={alert.isOverdue ? 'text-red-600' : 'text-amber-600'} />
              </div>
              <div className="flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <p className="text-sm font-bold text-gray-900">{alert.courseTitle}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${alert.isOverdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {alert.isOverdue ? `متأخر ${alert.daysOverdue} يوم` : `خلال ${alert.daysLeft} يوم`}
                  </span>
                </div>
                <p className="text-sm text-gray-700">
                  قسط بمبلغ <span className="font-bold">{alert.amount.toLocaleString()} {alert.currency === 'EGP' ? 'ج.م' : alert.currency}</span>، موعد الاستحقاق: {alert.dueDate}
                </p>
                <button
                  onClick={onOpenPayments}
                  className="mt-2 text-xs font-bold text-primary-600 underline hover:text-primary-700"
                >
                  عرض تفاصيل المدفوعات
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {notifications.length === 0 && installmentAlerts.length === 0 ? (
        <div className="glass-card-premium rounded-2xl border border-white/50 bg-white/70 p-12 text-center shadow-xl shadow-gray-200/50 backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-primary-500/20">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
            <Bell size={28} className="text-gray-300" />
          </div>
          <p className="font-bold text-gray-500">لا توجد إشعارات حاليًا</p>
        </div>
      ) : (
        <>
          {unreadNotifications.length > 0 && (
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-bold text-gray-600">{unreadNotifications.length} إشعار غير مقروء</p>
              <button onClick={onMarkAllRead} className="text-xs font-bold text-primary-600 hover:text-primary-700">
                تعليم الكل كمقروء
              </button>
            </div>
          )}
          {notifications.map((notification) => {
            const isRead = dismissedNotifIds.includes(notification.id);
            const typeConfig = {
              offer: {
                bg: 'bg-orange-50',
                border: 'border-orange-200',
                icon: <Sparkles size={18} className="text-orange-500" />,
                badge: 'bg-orange-100 text-orange-700',
                badgeLabel: 'عرض خاص',
              },
              update: {
                bg: 'bg-blue-50',
                border: 'border-blue-200',
                icon: <Bell size={18} className="text-blue-500" />,
                badge: 'bg-blue-100 text-blue-700',
                badgeLabel: 'تحديث',
              },
              info: {
                bg: 'bg-primary-50',
                border: 'border-primary-200',
                icon: <Bell size={18} className="text-primary-600" />,
                badge: 'bg-primary-100 text-primary-700',
                badgeLabel: 'إشعار',
              },
            };
            const cfg = typeConfig[notification.type as keyof typeof typeConfig] || typeConfig.info;
            return (
              <div
                key={notification.id}
                className={`flex gap-4 rounded-2xl border p-4 transition ${isRead ? 'border-gray-100 bg-gray-50 opacity-60' : `${cfg.bg} ${cfg.border}`}`}
              >
                <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${isRead ? 'bg-gray-100' : 'bg-white shadow-sm'}`}>
                  {cfg.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-gray-900">{notification.title}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.badge}`}>{cfg.badgeLabel}</span>
                    {!isRead && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />}
                  </div>
                  {notification.body && <p className="text-sm leading-relaxed text-gray-600">{notification.body}</p>}
                </div>
                {!isRead && (
                  <button
                    onClick={() => onDismissNotification(notification.id)}
                    className="flex-shrink-0 text-gray-300 transition hover:text-gray-500"
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
}
