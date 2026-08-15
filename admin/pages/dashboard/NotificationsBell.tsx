import React, { useMemo, useState } from 'react';
import {
  Bell, X, CheckCheck, Banknote, RotateCcw, Users, UserPlus, Ticket,
  Award, Settings, AlertTriangle, Info, type LucideIcon,
} from 'lucide-react';

import { mysqlAdmin } from '../../lib/mysqlapi';
import type { TabKey } from './navigation';

export type NotifRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
};

/** Each kind of notification, with where it came from and where it goes. The
 *  bell used to render every row as identical grey text, so a refund decision
 *  and a "welcome" notice looked the same and neither was clickable. */
const TYPES: Record<string, { label: string; icon: LucideIcon; tone: string; tab?: TabKey }> = {
  payment:     { label: 'مدفوعات',  icon: Banknote,      tone: 'text-emerald-600 bg-emerald-50', tab: 'financial' },
  refund:      { label: 'استرداد',  icon: RotateCcw,     tone: 'text-rose-600 bg-rose-50',       tab: 'refund_requests' },
  subscriber:  { label: 'عملاء',    icon: Users,         tone: 'text-sky-600 bg-sky-50',         tab: 'online_clients' },
  lead:        { label: 'محتملون',  icon: UserPlus,      tone: 'text-indigo-600 bg-indigo-50',   tab: 'leads' },
  ticket:      { label: 'تذاكر',    icon: Ticket,        tone: 'text-amber-600 bg-amber-50',     tab: 'tickets' },
  hr:          { label: 'موارد بشرية', icon: Users,      tone: 'text-violet-600 bg-violet-50',   tab: 'my_hr' },
  certificate: { label: 'شهادات',   icon: Award,         tone: 'text-teal-600 bg-teal-50' },
  system:      { label: 'النظام',   icon: Settings,      tone: 'text-slate-600 bg-slate-100' },
  alert:       { label: 'تنبيه',    icon: AlertTriangle, tone: 'text-red-600 bg-red-50' },
  warning:     { label: 'تحذير',    icon: AlertTriangle, tone: 'text-orange-600 bg-orange-50' },
  info:        { label: 'معلومة',   icon: Info,          tone: 'text-blue-600 bg-blue-50' },
};
const FALLBACK = { label: 'عام', icon: Info, tone: 'text-gray-500 bg-gray-100' };
const metaFor = (type: string) => TYPES[type] || FALLBACK;

/** Arabic relative time. A raw timestamp forces the reader to do the subtraction
 *  themselves, which is the one thing they actually wanted to know. */
function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return 'الآن';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `منذ ${days} يوم`;
  return new Date(iso).toLocaleDateString('ar-EG');
}

interface NotificationsBellProps {
  rows: NotifRow[];
  setRows: React.Dispatch<React.SetStateAction<NotifRow[]>>;
  unread: number;
  setUnread: React.Dispatch<React.SetStateAction<number>>;
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onNavigate: (tab: TabKey) => void;
}

/**
 * Everything the signed-in user is allowed to see, in one place. The API
 * decides that: a notification addressed to someone by name is theirs, and an
 * unaddressed one is filtered by the permission its type implies.
 *
 * Opening the panel used to mark the entire list read as a side effect, so a
 * glance at the badge destroyed the record of what had not been dealt with.
 * Marking read is now something the reader does — per row, or all at once.
 */
export const NotificationsBell: React.FC<NotificationsBellProps> = ({
  rows, setRows, unread, setUnread, open, setOpen, panelRef, onNavigate,
}) => {
  const [filter, setFilter] = useState<string>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Only offer filters for kinds that are actually present.
  const presentTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.type, (counts.get(row.type) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const visible = useMemo(
    () => rows.filter(row => (filter === 'all' || row.type === filter) && (!unreadOnly || !row.read_at)),
    [rows, filter, unreadOnly]
  );

  const markOne = async (row: NotifRow) => {
    if (row.read_at) return;
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, read_at: new Date().toISOString() } : r)));
    setUnread(n => Math.max(0, n - 1));
    // A failed write leaves the row read in this session only; the next poll
    // restores the truth rather than inventing a state neither side agrees on.
    try { await mysqlAdmin.markNotificationRead(row.id); } catch { /* poll corrects it */ }
  };

  const markAll = async () => {
    setRows(prev => prev.map(r => ({ ...r, read_at: r.read_at || new Date().toISOString() })));
    setUnread(0);
    try { await mysqlAdmin.markAllNotificationsRead(); } catch { /* poll corrects it */ }
  };

  const openRow = (row: NotifRow) => {
    void markOne(row);
    const tab = metaFor(row.type).tab;
    if (tab) { onNavigate(tab); setOpen(false); }
  };

  return (
    <div className="relative flex-shrink-0" ref={panelRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative w-8 h-8 rounded-xl bg-gray-100 hover:bg-primary-50 hover:text-primary-600 text-gray-500 grid place-items-center transition"
        title="الإشعارات"
        aria-label={unread > 0 ? `الإشعارات — ${unread} غير مقروء` : 'الإشعارات'}
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold grid place-items-center leading-none">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-10 left-0 z-[200] w-[22rem] max-w-[92vw] bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden" dir="rtl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-baseline gap-2">
              <span className="font-bold text-gray-800 text-sm">الإشعارات</span>
              {unread > 0 && <span className="text-[11px] text-red-600 font-bold">{unread} غير مقروء</span>}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={markAll}
                  className="flex items-center gap-1 text-[11px] font-bold text-primary-600 hover:text-primary-800 px-2 py-1 rounded-lg hover:bg-primary-50 transition"
                  title="تعليم الكل كمقروء"
                >
                  <CheckCheck size={13} /> تعليم الكل
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 p-1" aria-label="إغلاق"><X size={14} /></button>
            </div>
          </div>

          {rows.length > 0 && (
            <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 overflow-x-auto">
              <button
                onClick={() => setUnreadOnly(u => !u)}
                className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border transition ${
                  unreadOnly ? 'bg-red-500 text-white border-red-500' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                غير المقروء
              </button>
              <span className="w-px h-4 bg-gray-200 shrink-0" />
              <button
                onClick={() => setFilter('all')}
                className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border transition ${
                  filter === 'all' ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                الكل {rows.length}
              </button>
              {presentTypes.map(([type, count]) => (
                <button
                  key={type}
                  onClick={() => setFilter(f => (f === type ? 'all' : type))}
                  className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border transition ${
                    filter === type ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {metaFor(type).label} {count}
                </button>
              ))}
            </div>
          )}

          <div className="max-h-[26rem] overflow-y-auto divide-y divide-gray-50">
            {visible.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">
                {rows.length === 0 ? 'لا توجد إشعارات' : 'لا شيء يطابق هذا الفلتر'}
              </div>
            ) : visible.map(row => {
              const meta = metaFor(row.type);
              const Icon = meta.icon;
              return (
                <button
                  key={row.id}
                  onClick={() => openRow(row)}
                  className={`w-full text-right flex gap-3 px-4 py-3 hover:bg-gray-50 transition ${!row.read_at ? 'bg-blue-50/60' : ''}`}
                >
                  <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${meta.tone}`}>
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800 text-sm truncate">{row.title}</span>
                      {!row.read_at && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
                    </span>
                    <span className="block text-xs text-gray-500 mt-0.5 line-clamp-2">{row.message}</span>
                    <span className="block text-[10px] text-gray-400 mt-1">
                      {meta.label} · {timeAgo(row.created_at)}
                      {meta.tab && <span className="text-primary-500 font-bold"> · افتح</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationsBell;
