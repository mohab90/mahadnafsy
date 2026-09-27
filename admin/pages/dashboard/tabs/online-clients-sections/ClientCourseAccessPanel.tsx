import React, { useEffect, useState } from 'react';
import { CalendarClock, Check, Infinity as InfinityIcon, Loader2, Lock, Plus, Unlock } from 'lucide-react';

import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';
import { promptDialog } from '../../../../../shared/ui/promptDialog';
import { CAIRO_TIME_ZONE, cairoDateOnly } from '../../../../../shared/cairoDate';

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
export const ClientCourseAccessPanel: React.FC<{ subscriberId: string; notify: NotifyFn; onChanged?: () => void }> = ({
  subscriberId, notify, onChanged,
}) => {
  const [rows, setRows] = useState<CourseAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const base = `/api/admin/subscribers/${encodeURIComponent(subscriberId)}`;

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
            <div className="font-extrabold text-gray-900 text-sm">
              {head.item.startsWith('bundle:') ? '📌 ' : '🎓 '}{head.itemTitle}
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

            {courses.map(row => {
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
