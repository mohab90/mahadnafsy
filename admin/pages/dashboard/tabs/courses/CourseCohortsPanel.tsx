import React, { useEffect, useState } from 'react';
import { Plus, UserMinus, UserPlus } from 'lucide-react';
import type { Course, SubscriberItem } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { CoursePrerequisitesPanel } from './CoursePrerequisitesPanel';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type Cohort = {
  id: string; courseId: string; title: string; startsAt?: string; endsAt?: string;
  maxStudents?: number; status: string; memberCount: number;
};
type Member = { subscriberId: string; name: string; email: string; status: string };

interface Props {
  courseId: string;
  courses: Course[];
  subscribers: SubscriberItem[];
  notify: Notify;
}

const emptyDraft = { title: '', startsAt: '', endsAt: '', maxStudents: '' };

export function CourseCohortsPanel({ courseId, courses, subscribers, notify }: Props) {
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [subscriberId, setSubscriberId] = useState('');
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);

  const loadCohorts = async () => {
    const rows = await mysqlAdmin.adminGet<Cohort[]>(`/admin/lms/cohorts?course_id=${encodeURIComponent(courseId)}`);
    setCohorts(rows);
    setSelectedId(current => rows.some(row => row.id === current) ? current : (rows[0]?.id || ''));
  };

  const loadMembers = async (cohortId: string) => {
    setMembers(cohortId
      ? await mysqlAdmin.adminGet<Member[]>(`/admin/lms/cohorts/${encodeURIComponent(cohortId)}/members`)
      : []);
  };

  useEffect(() => { void loadCohorts().catch(() => setCohorts([])); }, [courseId]);
  useEffect(() => { void loadMembers(selectedId).catch(() => setMembers([])); }, [selectedId]);

  const create = async () => {
    if (!draft.title.trim()) return notify('error', 'اكتب اسم المجموعة.');
    setBusy(true);
    try {
      await mysqlAdmin.adminPost('/admin/lms/cohorts', {
        courseId, title: draft.title, startsAt: draft.startsAt || null, endsAt: draft.endsAt || null,
        maxStudents: Number(draft.maxStudents) || null, status: 'active',
      });
      setDraft(emptyDraft);
      await loadCohorts();
      notify('success', 'تم إنشاء المجموعة وربطها بالكورس.');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر إنشاء المجموعة.');
    } finally {
      setBusy(false);
    }
  };

  const addMember = async () => {
    if (!selectedId || !subscriberId) return;
    setBusy(true);
    try {
      await mysqlAdmin.adminPost(`/admin/lms/cohorts/${encodeURIComponent(selectedId)}/members`, { subscriberId });
      setSubscriberId('');
      await Promise.all([loadMembers(selectedId), loadCohorts()]);
      notify('success', 'تمت إضافة العميل ومنحه استحقاق الكورس.');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذرت إضافة العميل.');
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (id: string) => {
    setBusy(true);
    try {
      await mysqlAdmin.adminDelete(`/admin/lms/cohorts/${encodeURIComponent(selectedId)}/members/${encodeURIComponent(id)}`);
      await Promise.all([loadMembers(selectedId), loadCohorts()]);
      notify('success', 'تم إنهاء عضوية العميل مع الحفاظ على أي استحقاق مدفوع مستقل.');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذرت إزالة العميل.');
    } finally {
      setBusy(false);
    }
  };

  const memberIds = new Set(members.filter(member => member.status === 'active').map(member => member.subscriberId));
  return (
    <section className="border border-emerald-200 bg-emerald-50 rounded-2xl p-4 mb-4" dir="rtl">
      <div className="mb-3">
        <h4 className="font-bold text-emerald-900">المجموعات التعليمية (Cohorts)</h4>
        <p className="text-xs text-emerald-700 mt-1">العضوية تمنح الاستحقاق من الخادم، والسعة والمتطلبات تُفحص داخل نفس المعاملة.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4">
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="اسم المجموعة" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
        <input type="datetime-local" className="border rounded-lg px-3 py-2 text-sm" value={draft.startsAt} onChange={event => setDraft({ ...draft, startsAt: event.target.value })} />
        <input type="datetime-local" className="border rounded-lg px-3 py-2 text-sm" value={draft.endsAt} onChange={event => setDraft({ ...draft, endsAt: event.target.value })} />
        <input type="number" min="1" className="border rounded-lg px-3 py-2 text-sm" placeholder="السعة (اختياري)" value={draft.maxStudents} onChange={event => setDraft({ ...draft, maxStudents: event.target.value })} />
        <button type="button" disabled={busy} onClick={() => void create()} className="rounded-lg bg-emerald-600 text-white text-sm font-bold px-3 py-2 disabled:opacity-50"><Plus size={14} className="inline ml-1" />إنشاء</button>
      </div>
      {cohorts.length === 0 ? <p className="text-sm text-emerald-700">لا توجد مجموعات لهذا الكورس.</p> : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            {cohorts.map(cohort => (
              <button key={cohort.id} type="button" onClick={() => setSelectedId(cohort.id)}
                className={`rounded-lg px-3 py-2 text-xs font-bold border ${selectedId === cohort.id ? 'bg-emerald-600 text-white' : 'bg-white text-emerald-800'}`}>
                {cohort.title} ({cohort.memberCount}{cohort.maxStudents ? `/${cohort.maxStudents}` : ''})
              </button>
            ))}
          </div>
          {selectedId && (
            <>
              <CoursePrerequisitesPanel subjectType="cohort" subjectId={selectedId} courses={courses} notify={notify} compact />
              <div className="flex flex-col md:flex-row gap-2 mb-3">
                <select className="flex-1 border rounded-lg px-3 py-2 text-sm" value={subscriberId} onChange={event => setSubscriberId(event.target.value)}>
                  <option value="">اختر عميلًا لإضافته</option>
                  {subscribers.filter(subscriber => !memberIds.has(subscriber.id)).map(subscriber => (
                    <option key={subscriber.id} value={subscriber.id}>{subscriber.name} — {subscriber.email}</option>
                  ))}
                </select>
                <button type="button" disabled={busy || !subscriberId} onClick={() => void addMember()} className="rounded-lg bg-blue-600 text-white text-sm font-bold px-4 py-2 disabled:opacity-50"><UserPlus size={14} className="inline ml-1" />إضافة</button>
              </div>
              <div className="space-y-2">
                {members.filter(member => member.status === 'active').map(member => (
                  <div key={member.subscriberId} className="flex items-center justify-between gap-3 bg-white border border-emerald-100 rounded-xl px-3 py-2">
                    <div><p className="text-sm font-bold">{member.name}</p><p className="text-xs text-gray-500">{member.email}</p></div>
                    <button type="button" disabled={busy} onClick={() => void removeMember(member.subscriberId)} className="text-xs font-bold text-red-700 bg-red-50 rounded-lg px-3 py-2"><UserMinus size={13} className="inline ml-1" />إزالة</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
