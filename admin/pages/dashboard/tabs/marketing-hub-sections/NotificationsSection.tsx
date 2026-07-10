import React from 'react';
import { Bell, Send, Calendar, Users, Inbox, ChevronRight } from 'lucide-react';
import type { NotificationBroadcast, SubscriberItem } from '../../../../types';
import { StatCard, TODAY, MONTH } from './shared';

interface Props {
  notifications: NotificationBroadcast[];
  subscribers: SubscriberItem[];
}

export function NotificationsSection({ notifications, subscribers }: Props) {
  return (
    <div className="space-y-5">

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="إجمالي الإشعارات" value={notifications.length} icon={Bell} color="text-indigo-600" bg="bg-indigo-50" />
        <StatCard label="مرسل اليوم" value={notifications.filter(n => (n.sentAt || n.createdAt || '').slice(0, 10) === TODAY).length} icon={Send} color="text-green-600" bg="bg-green-50" />
        <StatCard label="مرسل هذا الشهر" value={notifications.filter(n => (n.sentAt || n.createdAt || '').slice(0, 7) === MONTH).length} icon={Calendar} color="text-rose-600" bg="bg-rose-50" />
        <StatCard label="المستقبلون" value={subscribers.filter(s => s.status === 'active').length} icon={Users} color="text-teal-600" bg="bg-teal-50" />
      </div>

      {/* Notifications list */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Inbox size={16} className="text-indigo-500" /> سجل الإشعارات المرسلة
          </h3>
          <span className="text-xs text-gray-400">{notifications.length} إشعار</span>
        </div>
        <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <Bell size={40} className="mx-auto mb-3 opacity-30" />
              <p>لم يُرسل أي إشعار بعد</p>
            </div>
          ) : notifications.map((n, idx) => (
            <div key={n.id} className="p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${idx % 3 === 0 ? 'bg-indigo-100' : idx % 3 === 1 ? 'bg-rose-100' : 'bg-green-100'}`}>
                  <Bell size={14} className={idx % 3 === 0 ? 'text-indigo-500' : idx % 3 === 1 ? 'text-rose-500' : 'text-green-500'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 mb-0.5">
                    <span className="font-semibold text-sm text-gray-800 flex-1">{n.title}</span>
                    <span className="text-xs text-gray-400 shrink-0">{(n.sentAt || n.createdAt || '').slice(0, 10)}</span>
                  </div>
                  <p className="text-sm text-gray-500 line-clamp-2">{n.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick action hint */}
      <div className="bg-gradient-to-l from-indigo-50 to-purple-50 border border-indigo-200 rounded-2xl p-4 flex items-center gap-3">
        <Bell size={22} className="text-indigo-500 shrink-0" />
        <div>
          <p className="text-sm font-medium text-gray-700">لإرسال إشعار جديد</p>
          <p className="text-xs text-gray-400 mt-0.5">اذهب إلى: الاتصالات والتواصل ← إشعارات المشتركين</p>
        </div>
        <ChevronRight size={16} className="text-gray-400 mr-auto" />
      </div>
    </div>
  );
}
