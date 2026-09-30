import React, { useEffect, useState } from 'react';
import { ArrowLeftRight, CalendarClock, Check, Infinity as InfinityIcon, Loader2, Lock, Plus, RotateCcw, Trash2, Unlock } from 'lucide-react';

import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';
import { promptDialog } from '../../../../../shared/ui/promptDialog';
import { Modal } from '../../../../../shared/ui/Modal';
import { CAIRO_TIME_ZONE, cairoDateOnly } from '../../../../../shared/cairoDate';
import { useSiteData } from '../../../../context/SiteDataContext';
import { hasPermission, type PermissionKey, type RoleKey } from '../../../../constants/permissions';
import type { SubscriberItem } from '../../../../types';
import { isOnlineClient } from '../onlineClientsUtils';
import { AddRefundModal } from '../financial/AddRefundModal';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type CourseAccess = {
  enrollmentId: string;
  courseId: string;
  title: string;
  enrolledAt: string;
  expiresAt: string | null;
  courseDefaultMonths: number | null;
  accessType: string;
  status: string;
  lectureCount: number;
  watchedCount: number;
  totalMinutes: number;
  /** How many lectures they may reach when access is limited; null = all. */
  lectureLimit: number | null;
  /** What they bought it as: the course, or 'bundle:<id>' for a track. */
  item: string;
  itemTitle: string;
  currency: string;
  /** The price agreed for the item (api/lib/agreedPrice.js). */
  expected: number;
  /** Recorded here, and paid before the system. */
  paid: number;
  priorPaid: number;
  remaining: number;
};

/** «للمديرين» — the same roles api/lib/clientCourseActions.js admits. */
const MANAGER_ROLES = new Set(['admin', 'manager', 'online_manager', 'daqqi_manager', 'sales_collection_manager']);

const fmt = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('ar-EG-u-nu-latn', { timeZone: CAIRO_TIME_ZONE }) : null;
const num = (value: number) => value.toLocaleString('ar-EG-u-nu-latn');

const daysLeft = (value: string | null) => {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
};

const api = async (url: string, method: string, body?: unknown) => {
  const res = await fetch(url, {
    method, credentials: 'include',
    headers: { ...adminAuthHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

/**
 * Everything about what one client bought, in one place: its price and what
 * they paid, how many lectures of each course they may watch, since when and
 * until when — and closing a course on a client who stopped paying.
 *
 * «زرار صلاحية الكورسات … متكامل التعديلات». It could extend the dates and
 * lock a course; the price, the money paid, the lecture count and the
 * subscription date were read-only, or not shown.
 */
export const ClientCourseAccessPanel: React.FC<{ subscriber: SubscriberItem; notify: NotifyFn; onChanged?: () => void }> = ({
  subscriber, notify, onChanged,
}) => {
  const subscriberId = subscriber.id;
  const { isAdmin, currentStaff, courses: catalogCourses, bundles: catalogBundles, reloadSubscribers } = useSiteData();
  const [rows, setRows] = useState<CourseAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [refundItem, setRefundItem] = useState<CourseAccess | null>(null);
  const [transfer, setTransfer] = useState<{ head: CourseAccess; to: string; price: string; reason: string } | null>(null);
  const base = `/api/admin/subscribers/${encodeURIComponent(subscriberId)}`;

  // «عميل الدقي ليه بيظهرله تفاصيل الكورسات … اصلا هو مش اونلاين»: a client in
  // a branch sees what they bought and what it cost, not lectures watched,
  // months left and a lock for an online course they do not have.
  const inBranch = !isOnlineClient(subscriber);
  const role = String(currentStaff?.role || '').toLowerCase();
  const canManage = isAdmin || MANAGER_ROLES.has(role);
  const canTransfer = canManage || role === 'accountant';
  const canRefund = isAdmin || hasPermission(currentStaff ? {
    role: currentStaff.role as RoleKey, permissions: currentStaff.permissions as PermissionKey[] | undefined,
  } : null, 'approve_refunds');

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api(`${base}/course-access`, 'GET'));
      setDraft({});
    } catch (error) {
      notify('error', error instanceof Error ? `تعذر تحميل صلاحيات الكورسات: ${error.message}` : 'تعذر التحميل');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriberId]);

  const run = async (busy: string, action: () => Promise<unknown>, okMessage: string) => {
    setBusyId(busy);
    try {
      await action();
      notify('success', okMessage);
      await load();
      onChanged?.();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الحفظ');
    } finally { setBusyId(''); }
  };
  const save = (row: CourseAccess, body: Record<string, unknown>, okMessage: string) =>
    run(row.enrollmentId, () => api(`${base}/course-access/${encodeURIComponent(row.enrollmentId)}`, 'PUT', body), okMessage);

  // Closing a course on a client who stopped paying, and opening it again.
  // The reason is not optional: it is what the client's timeline will say.
  const setAccess = async (row: CourseAccess, action: 'close' | 'open') => {
    const reason = await promptDialog(action === 'close'
      ? {
        title: 'قفل الكورس على العميل',
        message: 'العميل مش هيقدر يفتح محاضرات الكورس ده لحد ما يتفتح تاني. السبب بيتسجل في ملفه.',
        defaultValue: 'توقف عن سداد الأقساط',
        placeholder: 'سبب القفل',
        confirmLabel: 'اقفل الكورس',
      }
      : {
        title: 'فتح الكورس تاني',
        message: 'العميل هيرجع يشوف نفس المحاضرات اللي كانت مفتوحة له قبل القفل.',
        defaultValue: 'استكمل السداد',
        placeholder: 'السبب (اختياري)',
        confirmLabel: 'افتح الكورس',
      });
    if (reason === null) return;
    if (action === 'close' && !reason.trim()) return;
    await run(row.enrollmentId, () => api(`${base}/course-access`, 'POST', { courseId: row.courseId, action, reason: reason.trim() }),
      action === 'close' ? 'تم قفل الكورس على العميل' : 'تم فتح الكورس للعميل');
  };

  // «مسح كورس لعميل مش العميل كله». The reason is what the history says.
  const removeItem = async (head: CourseAccess) => {
    const reason = await promptDialog({
      title: `مسح «${head.itemTitle}» من العميل`,
      message: 'الكورس بيتشال من العميل ومن رواند الدقي اللي لسه شغالة. الفلوس المدفوعة مش بتتمسح — لو هترجعها استخدم «استرداد»، ولو هتنقلها استخدم «تحويل». بيتسجل في هيستوري العميل باسمك.',
      placeholder: 'سبب المسح',
      confirmLabel: 'امسح الكورس',
    });
    if (reason === null || !reason.trim()) return;
    await run(head.item, () => api(`${base}/course-remove`, 'POST', { item: head.item, reason: reason.trim() }), 'اتمسح الكورس من العميل');
    refreshClient();
  };

  // The client's course list and count on the rest of the page come from the
  // client record, not from this panel.
  const refreshClient = () => { if (!onChanged) void reloadSubscribers(); };

  const submitTransfer = async () => {
    if (!transfer?.to) return;
    const { head, to, price, reason } = transfer;
    await run(head.item, () => api(`${base}/course-transfer`, 'POST', {
      item: head.item, toItem: to, price: Number(price) > 0 ? Number(price) : null, reason: reason.trim(),
    }), 'اتحوّل الكورس');
    setTransfer(null);
    refreshClient();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400" dir="rtl">
        <Loader2 size={20} className="animate-spin ml-2" /> جاري التحميل...
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="text-center py-10 text-gray-400 text-sm border border-dashed border-gray-200 rounded-2xl" dir="rtl">
        العميل ده مش مشترك في أي كورس
      </div>
    );
  }

  // One card per thing they bought; a track holds its courses.
  const items = [...new Map(rows.map(row => [row.item, row])).values()];
  const field = 'border border-gray-200 rounded-lg px-2 py-1 text-xs';
  const btn = 'flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition disabled:opacity-40';

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
        <CalendarClock size={16} className="text-indigo-600" />
        كورسات العميل — السعر والمدفوع والصلاحية
      </div>

      {refundItem && (
        <AddRefundModal subscriber={subscriber} item={refundItem.item} itemTitle={refundItem.itemTitle} notify={notify}
          onClose={() => setRefundItem(null)} onCreated={() => { void load(); onChanged?.(); }} />
      )}
      {transfer && (
        <Modal open layer="top" size="sm" onClose={() => setTransfer(null)}
          title={`تحويل «${transfer.head.itemTitle}» لكورس تاني`}
          icon={<ArrowLeftRight size={16} className="text-indigo-600" />}
          footer={(
            <>
              <button onClick={() => setTransfer(null)} className="px-4 py-2 rounded-xl text-sm font-bold border border-gray-200 text-gray-600">إلغاء</button>
              <button disabled={!transfer.to || busyId === transfer.head.item} onClick={() => void submitTransfer()}
                className="px-5 py-2 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">حوّل</button>
            </>
          )}>
          <div className="space-y-3 text-sm">
            <label className="block text-xs font-bold text-gray-600">يتحوّل إلى
              <select value={transfer.to} onChange={event => setTransfer({ ...transfer, to: event.target.value })}
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm">
                <option value="">اختار الكورس أو المسار...</option>
                {catalogBundles.filter(bundle => `bundle:${bundle.id}` !== transfer.head.item).map(bundle => (
                  <option key={bundle.id} value={`bundle:${bundle.id}`}>📌 {bundle.title}</option>
                ))}
                {catalogCourses.filter(course => course.id !== transfer.head.item).map(course => (
                  <option key={course.id} value={course.id}>{course.titleAr || course.title}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-bold text-gray-600">السعر المتفق عليه للكورس الجديد (اختياري)
              <input type="number" min="1" value={transfer.price} placeholder="فاضي = سعر الكتالوج"
                onChange={event => setTransfer({ ...transfer, price: event.target.value })}
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs font-bold text-gray-600">السبب
              <input value={transfer.reason} onChange={event => setTransfer({ ...transfer, reason: event.target.value })}
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <p className="text-[11px] leading-5 text-gray-500">
              المدفوع للكورس ده ({num(transfer.head.paid)} {transfer.head.currency}{transfer.head.priorPaid ? ` + ${num(transfer.head.priorPaid)} قبل السيستم` : ''}) بيتنقل للكورس الجديد، والعميل بيطلع من رواند الدقي بتاعة الكورس القديم. بيتسجل في هيستوري العميل باسمك.
            </p>
          </div>
        </Modal>
      )}

      {items.map(head => {
        const courses = rows.filter(row => row.item === head.item);
        const moneyBusy = busyId === head.item;
        const priceKey = `${head.item}:expected`;
        const priorKey = `${head.item}:prior`;
        const price = draft[priceKey] ?? String(head.expected || '');
        const prior = draft[priorKey] ?? String(head.priorPaid || '');
        const remaining = Math.max(0, (Number(price) || 0) - head.paid - (Number(prior) || 0));
        return (
          <div key={head.item} className="rounded-2xl border border-gray-200 bg-gray-50/60 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-extrabold text-gray-900 text-sm">
                {head.item.startsWith('bundle:') ? '📌 ' : '🎓 '}{head.itemTitle}
              </div>
              {/* On one course, not the whole client. */}
              <div className="flex flex-wrap gap-1.5">
                {canRefund && (
                  <button disabled={moneyBusy} onClick={() => setRefundItem(head)}
                    className={`${btn} bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100`}><RotateCcw size={11} /> استرداد</button>
                )}
                {canTransfer && (
                  <button disabled={moneyBusy} onClick={() => setTransfer({ head, to: '', price: '', reason: '' })}
                    className={`${btn} bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100`}><ArrowLeftRight size={11} /> تحويل لكورس تاني</button>
                )}
                {canManage && (
                  <button disabled={moneyBusy} onClick={() => void removeItem(head)}
                    className={`${btn} bg-red-50 text-red-700 border border-red-200 hover:bg-red-100`}><Trash2 size={11} /> حذف الكورس</button>
                )}
              </div>
            </div>

            {/* The money for it. The price is written on every payment for it
                and on the client, so every screen reads the same number. */}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5 items-end rounded-xl bg-white border border-gray-200 p-2.5">
              <label className="text-[11px] text-gray-500">السعر الإجمالي ({head.currency})
                <input type="number" min="1" value={price} onChange={e => setDraft(d => ({ ...d, [priceKey]: e.target.value }))} className={`${field} mt-1 w-full`} />
              </label>
              <div className="text-[11px] text-gray-500">مدفوع في السيستم
                <div className="mt-1 text-sm font-bold text-emerald-700">{num(head.paid)}</div>
              </div>
              <label className="text-[11px] text-gray-500">مدفوع قبل السيستم
                <input type="number" min="0" value={prior} placeholder="0" onChange={e => setDraft(d => ({ ...d, [priorKey]: e.target.value }))} className={`${field} mt-1 w-full`} />
              </label>
              <div className="text-[11px] text-gray-500">المتبقي
                <div className={`mt-1 text-sm font-bold ${remaining > 0 ? 'text-red-600' : 'text-emerald-700'}`}>{remaining > 0 ? num(remaining) : 'مسدّد بالكامل'}</div>
              </div>
              <button
                disabled={moneyBusy || !(Number(price) > 0)}
                onClick={() => run(head.item, () => api(`${base}/item-money`, 'PUT', {
                  item: head.item, expected: Number(price), priorPaid: Number(prior) || 0,
                }), 'اتحفظ السعر والمدفوع')}
                className={`${btn} justify-center bg-indigo-600 text-white hover:bg-indigo-700 py-1.5`}
              >
                {moneyBusy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} حفظ السعر والمدفوع
              </button>
            </div>
            <p className="text-[10px] text-gray-400">«مدفوع قبل السيستم» فلوس اتدفعت قبل ما دفعاته تتسجل هنا — بتتحسب في المتبقي ومش بتتحسب إيراد.</p>

            {inBranch ? (
              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 space-y-1">
                {head.item.startsWith('bundle:') && courses.map(row => (
                  <div key={row.enrollmentId} className="flex items-center gap-2">
                    🎓 {row.title}
                    {row.status !== 'active' && <span className="rounded bg-red-100 px-1.5 text-[10px] font-bold text-red-700">مقفول</span>}
                  </div>
                ))}
                <p className="text-[11px] text-gray-400">كورس حضوري في الفرع — مفيش محاضرات أونلاين ولا مدة اشتراك. الحضور في «جدول الدقي».</p>
              </div>
            ) : courses.map(row => {
              const left = daysLeft(row.expiresAt);
              const expired = left !== null && left < 0;
              const busy = busyId === row.enrollmentId;
              const closed = row.status !== 'active';
              const lecturesKey = `${row.enrollmentId}:lectures`;
              const startKey = `${row.enrollmentId}:start`;
              const endKey = `${row.enrollmentId}:end`;
              return (
                <div key={row.enrollmentId} className={`border rounded-xl p-3 space-y-2 ${
                  closed ? 'border-red-200 bg-red-50/60' : 'border-gray-200 bg-white'}`}
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="font-bold text-gray-800 text-sm truncate">{row.title}</div>
                      {closed && (
                        <span className="shrink-0 text-[11px] bg-red-100 text-red-700 px-2 py-0.5 rounded font-bold flex items-center gap-1">
                          <Lock size={10} /> مقفول
                        </span>
                      )}
                      {row.lectureCount > 0 && (
                        <span className="text-[11px] bg-sky-100 text-sky-700 px-2 py-0.5 rounded font-bold">
                          شاهد {row.watchedCount} من {row.lectureCount}
                        </span>
                      )}
                      {row.totalMinutes > 0 && (
                        <span className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                          {row.totalMinutes >= 60 ? `${Math.floor(row.totalMinutes / 60)} س ${row.totalMinutes % 60} د` : `${row.totalMinutes} دقيقة`}
                        </span>
                      )}
                    </div>
                    {row.expiresAt ? (
                      <span className={`text-[11px] font-bold px-2 py-1 rounded whitespace-nowrap ${
                        expired ? 'bg-red-100 text-red-700'
                          : left !== null && left <= 14 ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700'}`}
                      >
                        {expired ? `انتهت من ${Math.abs(left as number)} يوم` : `فاضل ${left} يوم — لحد ${fmt(row.expiresAt)}`}
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold px-2 py-1 rounded bg-sky-100 text-sky-700 whitespace-nowrap flex items-center gap-1">
                        <InfinityIcon size={11} /> مفتوح بدون نهاية
                      </span>
                    )}
                  </div>

                  {/* Lectures they may watch, and since when they subscribed. */}
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
                    <span className="flex items-center gap-1">
                      المحاضرات المفتوحة
                      <input type="number" min="1" max={row.lectureCount || undefined}
                        value={draft[lecturesKey] ?? String(row.lectureLimit ?? row.lectureCount)}
                        onChange={e => setDraft(d => ({ ...d, [lecturesKey]: e.target.value }))} className={`${field} w-16`} />
                      من {row.lectureCount}
                      <button disabled={busy || !(Number(draft[lecturesKey]) >= 1)}
                        onClick={() => save(row, { lectureLimit: Number(draft[lecturesKey]) }, 'اتحدد عدد المحاضرات')}
                        className={`${btn} bg-gray-800 text-white hover:bg-gray-900`}><Check size={11} /> حفظ</button>
                      <button disabled={busy || row.lectureLimit === null}
                        onClick={() => save(row, { fullAccess: true }, 'الكورس اتفتح بالكامل')}
                        className={`${btn} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}>كل المحاضرات</button>
                    </span>
                    <span className="flex items-center gap-1">
                      تاريخ الاشتراك
                      <input type="date" value={draft[startKey] ?? cairoDateOnly(row.enrolledAt)}
                        onChange={e => setDraft(d => ({ ...d, [startKey]: e.target.value }))} className={field} />
                      <button disabled={busy || !draft[startKey]}
                        onClick={() => save(row, { enrolledAt: draft[startKey] }, 'اتغير تاريخ الاشتراك')}
                        className={`${btn} bg-gray-800 text-white hover:bg-gray-900`}><Check size={11} /> حفظ</button>
                      {row.courseDefaultMonths ? <span className="text-gray-400">· المدة الافتراضية {row.courseDefaultMonths} شهر</span> : null}
                    </span>
                  </div>

                  {/* How long they keep it. */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100">
                    {[1, 3, 6, 12].map(months => (
                      <button key={months} disabled={busy}
                        onClick={() => save(row, { addMonths: months }, `تمت إضافة ${months} شهر`)}
                        className={`${btn} bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}>
                        <Plus size={11} />{months} شهر
                      </button>
                    ))}
                    <button disabled={busy} onClick={() => save(row, { addMonths: -1 }, 'تم تقليل شهر')}
                      className={`${btn} bg-amber-50 text-amber-700 hover:bg-amber-100`}>− شهر</button>
                    <button disabled={busy} onClick={() => save(row, { expiresAt: null }, 'الوصول بقى مفتوح بدون نهاية')}
                      className={`${btn} bg-sky-50 text-sky-700 hover:bg-sky-100`}><InfinityIcon size={11} /> بدون نهاية</button>
                    <span className="flex items-center gap-1">
                      <input type="date" value={draft[endKey] || ''}
                        onChange={e => setDraft(d => ({ ...d, [endKey]: e.target.value }))} className={field} />
                      <button disabled={busy || !draft[endKey]}
                        onClick={() => save(row, { expiresAt: draft[endKey] }, 'اتحدد تاريخ نهاية جديد')}
                        className={`${btn} bg-gray-800 text-white hover:bg-gray-900`}>
                        {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} حدد النهاية
                      </button>
                    </span>
                    {/* Last, and separated: the rest extend access, this takes it away. */}
                    <span className="mr-auto">
                      {closed ? (
                        <button disabled={busy} onClick={() => setAccess(row, 'open')}
                          className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}><Unlock size={11} /> افتح الكورس تاني</button>
                      ) : (
                        <button disabled={busy} onClick={() => setAccess(row, 'close')}
                          className={`${btn} bg-red-50 text-red-700 border border-red-200 hover:bg-red-100`}><Lock size={11} /> اقفل الكورس</button>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

export default ClientCourseAccessPanel;
