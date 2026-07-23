import React, { useCallback, useEffect, useState } from 'react';
import { Clock, Mail, Phone, Send, XCircle, Users, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { useSiteData } from '../../../context/SiteDataContext';

type Notify = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
interface Props { notify: Notify; }

type WaitlistStatus = 'waiting' | 'notified' | 'enrolled' | 'cancelled';

interface WaitlistEntry {
  id: string;
  subscriber_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  position: number;
  status: WaitlistStatus;
  notified_at: string | null;
  client_code: string | null;
  created_at: string;
}

const STATUS_LABELS: Record<WaitlistStatus, string> = {
  waiting: 'في الانتظار', notified: 'تم الإشعار', enrolled: 'مُسجَّل', cancelled: 'ملغى',
};
const STATUS_COLORS: Record<WaitlistStatus, string> = {
  waiting: 'bg-amber-100 text-amber-800', notified: 'bg-blue-100 text-blue-800',
  enrolled: 'bg-emerald-100 text-emerald-800', cancelled: 'bg-gray-100 text-gray-500',
};

// SUB-01: course_waitlist has a full working backend (list/add/notify) — it just
// never had an admin screen. Seats that free up (unenrollment or refund) now
// auto-notify the top of the queue (SUB-02); this screen covers the rest —
// browsing the queue per course and manually adding/notifying/cancelling entries.
export default function CourseWaitlistTab({ notify }: Props) {
  const { courses } = useSiteData();
  const [courseId, setCourseId] = useState('');
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [enrolled, setEnrolled] = useState(0);
  const [maxStudents, setMaxStudents] = useState<number | null>(null);
  const [availableSpots, setAvailableSpots] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState({ name: '', email: '', phone: '' });

  useEffect(() => {
    if (!courseId && courses.length > 0) setCourseId(courses[0].id);
  }, [courses, courseId]);

  const load = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    try {
      const data = await mysqlAdmin.adminGet<{ waitlist: WaitlistEntry[]; enrolled: number; max_students: number | null; available_spots: number | null }>(
        `/admin/courses/${encodeURIComponent(courseId)}/waitlist`
      );
      setEntries(Array.isArray(data?.waitlist) ? data.waitlist : []);
      setEnrolled(data?.enrolled ?? 0);
      setMaxStudents(data?.max_students ?? null);
      setAvailableSpots(data?.available_spots ?? null);
    } catch { notify('error', 'فشل تحميل قائمة الانتظار'); }
    finally { setLoading(false); }
  }, [courseId, notify]);

  useEffect(() => { load(); }, [load]);

  const addEntry = async () => {
    if (!addDraft.name.trim() || (!addDraft.email.trim() && !addDraft.phone.trim())) {
      notify('error', 'أدخل الاسم وبريد إلكتروني أو رقم هاتف'); return;
    }
    try {
      await mysqlAdmin.adminPost(`/admin/courses/${encodeURIComponent(courseId)}/waitlist`, {
        name: addDraft.name.trim(), email: addDraft.email.trim() || null, phone: addDraft.phone.trim() || null,
      });
      notify('success', 'تمت الإضافة لقائمة الانتظار');
      setAddDraft({ name: '', email: '', phone: '' });
      setShowAdd(false);
      load();
    } catch { notify('error', 'فشلت الإضافة'); }
  };

  const updateStatus = async (id: string, status: WaitlistStatus, alsoNotify = false) => {
    setBusyId(id);
    try {
      await mysqlAdmin.adminPatch(`/admin/courses/${encodeURIComponent(courseId)}/waitlist/${id}`, { status, notify: alsoNotify });
      notify('success', alsoNotify ? 'تم إرسال إشعار توفر مقعد' : `تم تحديث الحالة إلى: ${STATUS_LABELS[status]}`);
      load();
    } catch { notify('error', 'فشل التحديث'); }
    finally { setBusyId(null); }
  };

  const selectedCourse = courses.find(c => c.id === courseId);

  return (
    <div className="space-y-5" dir="rtl">
      <div className="bg-gradient-to-l from-indigo-700 to-blue-600 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><Clock size={22} /> قوائم انتظار الكورسات</h2>
            <p className="text-indigo-200 text-sm mt-0.5">إدارة الراغبين في الانضمام عند اكتمال العدد</p>
          </div>
          <div className="flex gap-2">
            <select value={courseId} onChange={e => setCourseId(e.target.value)}
              className="bg-white/15 border border-white/30 rounded-xl px-3 py-2 text-sm text-white focus:outline-none">
              {courses.map(c => <option key={c.id} value={c.id} className="text-gray-900">{c.title}</option>)}
            </select>
            <button onClick={load} className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white px-3 py-2 rounded-xl text-sm">
              <RefreshCw size={14} />
            </button>
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 bg-white text-indigo-700 font-bold px-3 py-2 rounded-xl text-sm hover:bg-indigo-50">
              <Users size={14} /> إضافة يدوي
            </button>
          </div>
        </div>
        {selectedCourse && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
            <div className="bg-white/15 rounded-xl p-3 text-center">
              <div className="text-xl font-black">{enrolled}{maxStudents != null ? ` / ${maxStudents}` : ''}</div>
              <div className="text-xs text-indigo-200 mt-0.5">المسجَّلون</div>
            </div>
            <div className="bg-white/15 rounded-xl p-3 text-center">
              <div className="text-xl font-black">{availableSpots ?? '—'}</div>
              <div className="text-xs text-indigo-200 mt-0.5">مقاعد متاحة</div>
            </div>
            <div className="bg-white/15 rounded-xl p-3 text-center">
              <div className="text-xl font-black">{entries.filter(e => e.status === 'waiting').length}</div>
              <div className="text-xs text-indigo-200 mt-0.5">في قائمة الانتظار</div>
            </div>
          </div>
        )}
      </div>

      {showAdd && (
        <div className="bg-white border border-indigo-200 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-3">إضافة يدوية لقائمة الانتظار</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input value={addDraft.name} onChange={e => setAddDraft(p => ({ ...p, name: e.target.value }))}
              placeholder="الاسم *" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            <input value={addDraft.email} onChange={e => setAddDraft(p => ({ ...p, email: e.target.value }))}
              placeholder="البريد الإلكتروني" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            <input value={addDraft.phone} onChange={e => setAddDraft(p => ({ ...p, phone: e.target.value }))}
              placeholder="رقم الهاتف" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div className="flex gap-3 mt-3">
            <button onClick={addEntry} className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-bold text-sm hover:bg-indigo-700">إضافة</button>
            <button onClick={() => setShowAdd(false)} className="bg-gray-100 text-gray-600 px-6 py-2 rounded-xl font-bold text-sm hover:bg-gray-200">إلغاء</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><RefreshCw size={24} className="animate-spin text-indigo-400" /></div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Clock size={36} className="mb-2 opacity-30" />
            <p className="text-sm">لا يوجد أحد في قائمة الانتظار لهذا الكورس</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs font-semibold">
                  <th className="px-4 py-3 text-right">#</th>
                  <th className="px-4 py-3 text-right">الاسم</th>
                  <th className="px-4 py-3 text-right">التواصل</th>
                  <th className="px-4 py-3 text-right">الحالة</th>
                  <th className="px-4 py-3 text-right">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 text-gray-400">{e.position}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{e.name || '—'}{e.client_code && <span className="text-xs text-gray-400 mr-1">({e.client_code})</span>}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-0.5">
                        {e.email && <div className="flex items-center gap-1 text-gray-600 text-xs"><Mail size={11} />{e.email}</div>}
                        {e.phone && <div className="flex items-center gap-1 text-gray-600 text-xs"><Phone size={11} />{e.phone}</div>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_COLORS[e.status]}`}>{STATUS_LABELS[e.status]}</span>
                    </td>
                    <td className="px-4 py-3">
                      {busyId === e.id ? (
                        <RefreshCw size={14} className="animate-spin text-gray-400" />
                      ) : (
                        <div className="flex gap-1">
                          {(e.status === 'waiting' || e.status === 'notified') && (
                            <button onClick={() => updateStatus(e.id, 'notified', true)}
                              className="p-1 rounded-lg hover:bg-blue-50 text-blue-600 transition" title="إشعار بتوفر مقعد">
                              <Send size={14} />
                            </button>
                          )}
                          {e.status !== 'enrolled' && (
                            <button onClick={() => updateStatus(e.id, 'enrolled')}
                              className="p-1 rounded-lg hover:bg-emerald-50 text-emerald-600 transition" title="تسجيل">
                              <Users size={14} />
                            </button>
                          )}
                          {e.status !== 'cancelled' && (
                            <button onClick={() => updateStatus(e.id, 'cancelled')}
                              className="p-1 rounded-lg hover:bg-red-50 text-red-400 transition" title="إلغاء">
                              <XCircle size={14} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
