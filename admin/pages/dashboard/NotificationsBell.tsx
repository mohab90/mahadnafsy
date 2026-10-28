import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, X, CheckCheck, Banknote, RotateCcw, Users, UserPlus, Ticket, Award, Settings, AlertTriangle, Info,
  AlarmClock, Siren, Repeat, MessageCircle, ChevronDown, ChevronLeft, type LucideIcon,
} from 'lucide-react';

import { mysqlAdmin } from '../../lib/mysqlapi';
import { devicePushState, enableDevicePush, type DevicePushState } from '../../lib/devicePush';
import type { TabKey } from './navigation';
import { CAIRO_TIME_ZONE, cairoDateOnly, cairoDaysAgo, cairoDay, cairoStamp } from '../../../shared/cairoDate';

export type NotifRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  data_json?: string | null;
  read_at: string | null;
  created_at: string;
};

type Severity = 'critical' | 'repeated' | 'important' | 'followup' | 'normal';

/** How loud a row is: its type's, or the one the server set on it (a payment accepted, rejected or booked on your client). */
const severityOf = (row: NotifRow): Severity | undefined => {
  const set = dataOf(row).importance;
  if (set === 'critical') return 'critical';
  if (set === 'high') return 'important';
  return metaFor(row.type).severity;
};

/** Each kind of notification: what it is, how loud, and where it goes. The two escalations and the
 *  day's follow-ups are told apart at a glance — «زر الاشعارات لازم يكون اقوى». */
const TYPES: Record<string, { label: string; icon: LucideIcon; tone: string; tab?: TabKey; severity?: Severity }> = {
  ticket_client_message: { label: 'رسالة عميل', icon: MessageCircle, tone: 'text-white bg-red-600', tab: 'customer_inbox', severity: 'critical' },
  escalation_critical: { label: 'مهم جدا', icon: Siren, tone: 'text-white bg-red-600', tab: 'customer_inbox', severity: 'critical' },
  escalation_repeated: { label: 'متكررة', icon: Repeat, tone: 'text-white bg-violet-600', tab: 'customer_inbox', severity: 'repeated' },
  followup: { label: 'متابعاتي', icon: AlarmClock, tone: 'text-amber-700 bg-amber-100', severity: 'followup' },
  followup_team: { label: 'متابعات الفريق', icon: AlarmClock, tone: 'text-amber-700 bg-amber-100', severity: 'followup' },
  payment: { label: 'مدفوعات', icon: Banknote, tone: 'text-emerald-600 bg-emerald-50', tab: 'financial' },
  refund: { label: 'استرداد', icon: RotateCcw, tone: 'text-rose-600 bg-rose-50', tab: 'refund_requests' },
  subscriber: { label: 'عملاء', icon: Users, tone: 'text-sky-600 bg-sky-50', tab: 'online_clients' },
  lead: { label: 'محتملون', icon: UserPlus, tone: 'text-indigo-600 bg-indigo-50', tab: 'leads' },
  ticket: { label: 'تذاكر', icon: Ticket, tone: 'text-amber-600 bg-amber-50', tab: 'customer_inbox' },
  hr: { label: 'موارد بشرية', icon: Users, tone: 'text-violet-600 bg-violet-50', tab: 'my_hr' },
  certificate: { label: 'شهادات', icon: Award, tone: 'text-teal-600 bg-teal-50', tab: 'cert_requests' },
  system: { label: 'النظام', icon: Settings, tone: 'text-slate-600 bg-slate-100' },
  alert: { label: 'تنبيه', icon: AlertTriangle, tone: 'text-red-600 bg-red-50', severity: 'critical' },
  warning: { label: 'تحذير', icon: AlertTriangle, tone: 'text-orange-600 bg-orange-50' },
  info: { label: 'معلومة', icon: Info, tone: 'text-blue-600 bg-blue-50' },
};
const FALLBACK = { label: 'عام', icon: Info, tone: 'text-gray-500 bg-gray-100' } as (typeof TYPES)[string];
const metaFor = (type: string) => TYPES[type] || FALLBACK;

const STRIPE: Record<Severity, string> = {
  critical: 'border-red-500 bg-red-50/70', repeated: 'border-violet-500 bg-violet-50/70', important: 'border-emerald-500 bg-emerald-50/60',
  followup: 'border-amber-400 bg-amber-50/60', normal: 'border-transparent',
};
const SECTION_LABEL: Record<string, { icon: string; label: string; path: string }> = {
  leads: { icon: '🎯', label: 'ليدز', path: '/dashboard/leads' },
  online: { icon: '💻', label: 'عملاء أونلاين', path: '/dashboard/my_clients?follow=due' },
  dokki: { icon: '🏫', label: 'عملاء الدقي والتجمع', path: '/dashboard/daqqi_clients?follow=due' },
};

type Data = { ticketId?: string; clientCode?: string; importance?: string; kind?: string; repeats?: number; total?: number; overdue?: number; sections?: Record<string, { overdue: number; today: number }> };
const dataOf = (row: NotifRow): Data => { try { return JSON.parse(row.data_json || '{}') || {}; } catch { return {}; } };

type Destination = { label: string; path: string };
/** Where a notification leads: the very ticket, the follow-ups of each kind, or the tab of its type. */
function destinationsOf(row: NotifRow): Destination[] {
  const data = dataOf(row);
  if (data.ticketId) return [{ label: 'افتح المشكلة', path: `/dashboard/customer_inbox?focus=${encodeURIComponent(data.ticketId)}` }];
  if (row.type === 'followup' && data.sections) {
    return Object.entries(data.sections).map(([key, n]) => {
      const meta = SECTION_LABEL[key];
      return meta ? { label: `${meta.icon} ${n.overdue + n.today} ${meta.label}`, path: meta.path } : null;
    }).filter((d): d is Destination => Boolean(d));
  }
  if (row.type === 'followup_team') return [{ label: 'عملاء الأونلاين', path: '/dashboard/my_clients?follow=overdue' }, { label: 'الليدز', path: '/dashboard/leads' }];
  // Money moving on a client: the client first, then the page where it is dealt with.
  if (row.type === 'payment' && data.clientCode) {
    return [{ label: 'افتح العميل', path: `/client/${encodeURIComponent(data.clientCode)}` }, { label: 'المدفوعات', path: '/dashboard/orders' }];
  }
  const tab = metaFor(row.type).tab;
  return tab ? [{ label: 'افتح', path: `/dashboard/${tab === 'online_clients' ? 'my_clients' : tab}` }] : [];
}

/** Arabic relative time. A raw timestamp forces the reader to do the subtraction themselves. */
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
  return new Date(iso).toLocaleDateString('ar-EG-u-nu-latn', { timeZone: CAIRO_TIME_ZONE });
}
const exactTime = (iso: string) => cairoStamp(iso);

const dayLabel = (iso: string): string => {
  const day = cairoDay(iso);
  if (day === cairoDateOnly()) return 'النهاردة';
  if (day === cairoDaysAgo(1)) return 'امبارح';
  return 'أقدم';
};

type Tab = 'all' | 'important' | 'followups' | 'unread';

export interface NotificationsBellProps {
  rows: NotifRow[];
  setRows: React.Dispatch<React.SetStateAction<NotifRow[]>>;
  unread: number;
  setUnread: React.Dispatch<React.SetStateAction<number>>;
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  /** Kept for callers that still pass it; the bell now opens the exact page by address. */
  onNavigate?: (tab: TabKey) => void;
  /** The last poll failed: the count on the bell may be stale. */
  loadFailed?: boolean;
  onRetry?: () => void;
}

/**
 * Everything the signed-in user is allowed to see, in one place — the API decides that: a
 * notification addressed to someone by name is theirs, an unaddressed one is filtered by the
 * permission its type implies.
 *
 * «غير تصميم القايمة خليها افضل وبتقرا وبتشوف كل حاجة»: grouped by day, the very important (the
 * two kinds of escalation) and the day's follow-ups set apart in colour, every row readable in
 * full without leaving the list, and a button straight to what it is about — the very ticket,
 * or the clients due today. Opening the panel never marks anything read; the reader does.
 */
export const NotificationsBell: React.FC<NotificationsBellProps> = ({
  rows, setRows, unread, setUnread, open, setOpen, panelRef, loadFailed, onRetry,
}) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pushState, setPushState] = useState<DevicePushState | 'working'>('off');
  useEffect(() => {
    if (open) void devicePushState().then(setPushState).catch(() => setPushState('unsupported'));
  }, [open]);
  const turnOnPush = async () => {
    setPushState('working');
    setPushState(await enableDevicePush().catch(() => 'unavailable' as const));
  };

  // The bell shakes for a few seconds when something new arrives.
  const [ringing, setRinging] = useState(false);
  const lastUnread = useRef(unread);
  useEffect(() => {
    if (unread > lastUnread.current) {
      setRinging(true);
      const timer = window.setTimeout(() => setRinging(false), 4000);
      lastUnread.current = unread;
      return () => window.clearTimeout(timer);
    }
    lastUnread.current = unread;
    return undefined;
  }, [unread]);

  const isImportant = (row: NotifRow) => ['critical', 'repeated', 'important'].includes(severityOf(row) || '');
  const isFollowUp = (row: NotifRow) => severityOf(row) === 'followup';
  const counts = useMemo(() => ({
    important: rows.filter(isImportant).length,
    importantUnread: rows.filter(row => isImportant(row) && !row.read_at).length,
    followups: rows.filter(isFollowUp).length,
    unread: rows.filter(row => !row.read_at).length,
  }), [rows]);

  const visible = useMemo(() => rows.filter(row => (
    tab === 'all' ? true : tab === 'important' ? isImportant(row) : tab === 'followups' ? isFollowUp(row) : !row.read_at)), [rows, tab]);
  const groups = useMemo(() => {
    const order = ['النهاردة', 'امبارح', 'أقدم'];
    const map = new Map<string, NotifRow[]>();
    for (const row of visible) { const key = dayLabel(row.created_at); map.set(key, [...(map.get(key) || []), row]); }
    return order.filter(key => map.has(key)).map(key => [key, map.get(key)!] as const);
  }, [visible]);

  const markOne = async (row: NotifRow) => {
    if (row.read_at) return;
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, read_at: new Date().toISOString() } : r)));
    setUnread(n => Math.max(0, n - 1));
    // A failed write leaves the row read in this session only; the next poll restores the truth.
    try { await mysqlAdmin.markNotificationRead(row.id); } catch { /* poll corrects it */ }
  };
  const markAll = async () => {
    setRows(prev => prev.map(r => ({ ...r, read_at: r.read_at || new Date().toISOString() })));
    setUnread(0);
    try { await mysqlAdmin.markAllNotificationsRead(); } catch { /* poll corrects it */ }
  };
  const toggleRow = (row: NotifRow) => {
    setExpanded(current => (current === row.id ? null : row.id));
    void markOne(row);
  };
  const go = (row: NotifRow, destination: Destination) => {
    void markOne(row);
    setOpen(false);
    navigate(destination.path);
  };

  const tabs: Array<[Tab, string, number, string]> = [
    ['all', 'الكل', rows.length, ''],
    ['important', '🚨 مهم', counts.important, counts.importantUnread ? 'text-red-600' : ''],
    ['followups', '📅 متابعات', counts.followups, ''],
    ['unread', 'غير المقروء', counts.unread, ''],
  ];

  return (
    <div className="relative flex-shrink-0" ref={panelRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`relative w-8 h-8 rounded-xl grid place-items-center transition ${unread > 0 ? 'bg-primary-50 text-primary-700 hover:bg-primary-100' : 'bg-gray-100 hover:bg-primary-50 hover:text-primary-600 text-gray-500'} ${ringing ? 'animate-bounce' : ''}`}
        title={loadFailed ? 'الإشعارات — تعذر التحديث' : 'الإشعارات'}
        aria-label={`${unread > 0 ? `الإشعارات — ${unread} غير مقروء` : 'الإشعارات'}${loadFailed ? ' — تعذر التحديث' : ''}`}
      >
        <Bell size={15} className={ringing ? 'fill-current' : ''} />
        {loadFailed && <span className="absolute -bottom-0.5 -left-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-white" aria-hidden="true" />}
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold grid place-items-center leading-none">
            {ringing && <span className="absolute inset-0 rounded-full bg-red-400 opacity-60 animate-ping" />}
            <span className="relative">{unread > 99 ? '99+' : unread}</span>
          </span>
        )}
      </button>

      {open && (
        <div className="fixed sm:absolute top-14 sm:top-10 left-2 right-2 sm:left-0 sm:right-auto z-[200] sm:w-[27rem] bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden" dir="rtl">
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-l from-primary-600 to-primary-500 text-white">
            <div className="flex items-baseline gap-2">
              <span className="font-extrabold text-sm">الإشعارات</span>
              {unread > 0 && <span className="rounded-full bg-white/25 px-2 text-[11px] font-bold">{unread} جديد</span>}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button onClick={markAll} className="flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg bg-white/15 hover:bg-white/25 transition" title="تعليم الكل كمقروء">
                  <CheckCheck size={13} /> تعليم الكل
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 text-white/80 hover:text-white" aria-label="إغلاق"><X size={15} /></button>
            </div>
          </div>

          <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 overflow-x-auto" role="tablist">
            {tabs.map(([key, label, count, tone]) => (
              <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                className={`shrink-0 text-[11px] font-bold px-3 py-1 rounded-full border transition ${tab === key ? 'bg-gray-800 text-white border-gray-800' : `border-gray-200 hover:bg-gray-50 ${tone || 'text-gray-600'}`}`}>
                {label} <span className="opacity-70">{count}</span>
              </button>
            ))}
          </div>

          {pushState !== 'unsupported' && pushState !== 'enabled' && (
            <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-100 text-[11px] bg-amber-50 text-amber-900">
              <span className="font-bold">
                {pushState === 'denied' ? '📱 الإشعارات مرفوضة من المتصفح — فعّلها من إعدادات الموقع'
                  : pushState === 'unavailable' ? '📱 تعذر التفعيل دلوقتي — جرّب تاني'
                    : '📱 خلي الإشعارات توصل الموبايل/الجهاز ده حتى لو اللوحة مقفولة'}
              </span>
              {(pushState === 'off' || pushState === 'unavailable' || pushState === 'working') && (
                <button onClick={() => void turnOnPush()} disabled={pushState === 'working'}
                  className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 font-bold text-white hover:bg-amber-700 disabled:opacity-50">
                  {pushState === 'working' ? '…' : 'فعّل'}
                </button>
              )}
            </div>
          )}

          {loadFailed && (
            <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-100 text-[11px] bg-red-50 text-red-800">
              <span className="font-bold">تعذر تحديث الإشعارات — القائمة والعدد قد يكونا قديمين</span>
              {onRetry && (
                <button onClick={onRetry} className="shrink-0 rounded-lg bg-red-600 px-2.5 py-1 font-bold text-white hover:bg-red-700">إعادة المحاولة</button>
              )}
            </div>
          )}

          <div className="max-h-[28rem] overflow-y-auto">
            {visible.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                <Bell size={28} className="mx-auto mb-2 opacity-40" />
                {rows.length === 0 ? 'مفيش إشعارات' : 'مفيش حاجة هنا'}
              </div>
            ) : groups.map(([day, list]) => (
              <div key={day}>
                <div className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur px-4 py-1 text-[11px] font-extrabold text-gray-500">{day}</div>
                <div className="divide-y divide-gray-50">
                  {list.map(row => {
                    const meta = metaFor(row.type);
                    const Icon = meta.icon;
                    const isOpen = expanded === row.id;
                    const data = dataOf(row);
                    const destinations = destinationsOf(row);
                    return (
                      <div key={row.id} className={`border-r-4 ${STRIPE[severityOf(row) || 'normal']} ${!row.read_at && !severityOf(row) ? 'bg-blue-50/60' : ''}`}>
                        <button onClick={() => toggleRow(row)} className="w-full text-right flex gap-3 px-4 py-3 hover:bg-black/[0.02] transition" aria-expanded={isOpen}>
                          <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${meta.tone}`}><Icon size={16} /></span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className={`text-sm truncate ${row.read_at ? 'font-semibold text-gray-700' : 'font-extrabold text-gray-900'}`}>{row.title}</span>
                              {!row.read_at && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />}
                            </span>
                            <span className={`block text-xs text-gray-600 mt-0.5 whitespace-pre-wrap ${isOpen ? '' : 'line-clamp-2'}`}>{row.message}</span>
                            <span className="block text-[10px] text-gray-400 mt-1">{meta.label} · {timeAgo(row.created_at)}</span>
                          </span>
                          {isOpen ? <ChevronDown size={14} className="mt-1 shrink-0 text-gray-400" /> : <ChevronLeft size={14} className="mt-1 shrink-0 text-gray-300" />}
                        </button>
                        {isOpen && (
                          <div className="px-4 pb-3 pr-16 space-y-2">
                            <p className="text-[11px] text-gray-400">{exactTime(row.created_at)}</p>
                            {(data.repeats || data.overdue) ? (
                              <p className="text-[11px] font-bold text-gray-600">
                                {data.repeats ? `🔁 رجعت ${data.repeats} مرة قبل كده` : ''}
                                {data.overdue ? `🔴 ${data.overdue} متأخرة` : ''}
                              </p>
                            ) : null}
                            <div className="flex flex-wrap gap-1.5">
                              {destinations.map(destination => (
                                <button key={destination.path + destination.label} onClick={() => go(row, destination)}
                                  className="rounded-lg bg-primary-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-primary-700">
                                  {destination.label} ←
                                </button>
                              ))}
                              {!row.read_at && (
                                <button onClick={() => void markOne(row)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-bold text-gray-600 hover:bg-gray-50">تمام، قريتها</button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationsBell;
