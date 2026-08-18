import React, { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Infinity as InfinityIcon, Plus, Check } from 'lucide-react';

import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';

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
};

const fmt = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('ar-EG') : null;

const daysLeft = (value: string | null) => {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
};

/**
 * How long this customer keeps each course they own.
 *
 * The course sets the default length; this is where it is overridden for one
 * person — extend someone who asked for more time, shorten one who should not
 * still have it, or make their copy permanent. Without it the duration would be
 * a policy with no exceptions, which is not how the institute works.
 */
export const ClientCourseAccessPanel: React.FC<{ subscriberId: string; notify: NotifyFn }> = ({
  subscriberId, notify,
}) => {
  const [rows, setRows] = useState<CourseAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [dateDraft, setDateDraft] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/subscribers/${encodeURIComponent(subscriberId)}/course-access`, {
        credentials: 'include', headers: adminAuthHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows(await res.json());
    } catch (error) {
      notify('error', error instanceof Error ? `تعذر تحميل صلاحيات الكورسات: ${error.message}` : 'تعذر التحميل');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriberId]);

  const save = async (row: CourseAccess, body: Record<string, unknown>, okMessage: string) => {
    setBusyId(row.enrollmentId);
    try {
      const res = await fetch(
        `/api/admin/subscribers/${encodeURIComponent(subscriberId)}/course-access/${encodeURIComponent(row.enrollmentId)}`,
        {
          method: 'PUT', credentials: 'include',
          headers: { ...adminAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      notify('success', okMessage);
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الحفظ');
    } finally { setBusyId(''); }
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

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
        <CalendarClock size={16} className="text-indigo-600" />
        مدة صلاحية الكورسات والفيديوهات
      </div>
      <p className="text-[11px] text-gray-500">
        المدة الافتراضية بتتحدد من صفحة الكورس. هنا بتغيّرها للعميل ده لوحده.
      </p>

      {rows.map(row => {
        const left = daysLeft(row.expiresAt);
        const expired = left !== null && left < 0;
        const busy = busyId === row.enrollmentId;
        return (
          <div key={row.enrollmentId} className="border border-gray-200 rounded-xl p-3 bg-white space-y-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="font-bold text-gray-800 text-sm truncate">{row.title}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  اشترك في {fmt(row.enrolledAt)}
                  {row.courseDefaultMonths ? ` · الافتراضي ${row.courseDefaultMonths} شهر` : ' · الافتراضي مفتوح'}
                </div>
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

            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100">
              {[1, 3, 6, 12].map(months => (
                <button
                  key={months}
                  disabled={busy}
                  onClick={() => save(row, { addMonths: months }, `تمت إضافة ${months} شهر`)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-[11px] font-bold hover:bg-indigo-100 transition disabled:opacity-40"
                >
                  <Plus size={11} />{months} شهر
                </button>
              ))}
              <button
                disabled={busy}
                onClick={() => save(row, { addMonths: -1 }, 'تم تقليل شهر')}
                className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg text-[11px] font-bold hover:bg-amber-100 transition disabled:opacity-40"
              >
                − شهر
              </button>
              <button
                disabled={busy}
                onClick={() => save(row, { expiresAt: null }, 'الوصول بقى مفتوح بدون نهاية')}
                className="flex items-center gap-1 px-2.5 py-1 bg-sky-50 text-sky-700 rounded-lg text-[11px] font-bold hover:bg-sky-100 transition disabled:opacity-40"
              >
                <InfinityIcon size={11} /> افتح بدون نهاية
              </button>
              <span className="flex items-center gap-1">
                <input
                  type="date"
                  value={dateDraft[row.enrollmentId] || ''}
                  onChange={e => setDateDraft(d => ({ ...d, [row.enrollmentId]: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-[11px]"
                />
                <button
                  disabled={busy || !dateDraft[row.enrollmentId]}
                  onClick={() => save(row, { expiresAt: dateDraft[row.enrollmentId] }, 'اتحدد تاريخ نهاية جديد')}
                  className="flex items-center gap-1 px-2 py-1 bg-gray-800 text-white rounded-lg text-[11px] font-bold hover:bg-gray-900 transition disabled:opacity-40"
                >
                  {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} حدد
                </button>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ClientCourseAccessPanel;
