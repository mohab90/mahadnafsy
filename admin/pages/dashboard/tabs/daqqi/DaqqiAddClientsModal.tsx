// Adds existing clients to a round, one course choice per client.
//
// The selection stays in DaqqiScheduleTab because handleAddClientsToRound
// reads it and writes through the parent.

import { useState } from 'react';
import { Search } from 'lucide-react';
import type { Course, Bundle, SubscriberItem, DaqqiRound } from '../../../../types';
import { isEnrolledInCourse } from './daqqiScheduleUtils';
import { courseMoneyFor } from '../../../../lib/agreedPrice';
import { Modal } from '../../../../../shared/ui/Modal';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

export function DaqqiAddClientsModal({
  daqqiAddClientsRoundId,
  enrolledLabels,
  setDaqqiAddClientsRoundId,
  daqqiRounds,
  courses,
  bundles,
  daqqiSubs,
  daqqiAddClientsSel,
  setDaqqiAddClientsSel,
  daqqiAddClientsCourseSel,
  setDaqqiAddClientsCourseSel,
  assignedSubIds,
  handleAddClientsToRound,
}: {
  enrolledLabels: (courses: Course[], bundles: Bundle[], ids: string[]) => string[];
  daqqiAddClientsRoundId: string;
  setDaqqiAddClientsRoundId: (id: string) => void;
  daqqiRounds: DaqqiRound[];
  courses: Course[];
  bundles: Bundle[];
  daqqiSubs: SubscriberItem[];
  daqqiAddClientsSel: Set<string>;
  setDaqqiAddClientsSel: React.Dispatch<React.SetStateAction<Set<string>>>;
  daqqiAddClientsCourseSel: Record<string, string>;
  setDaqqiAddClientsCourseSel: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** Clients already placed in a round (مسكّنين). */
  assignedSubIds: Set<string>;
  handleAddClientsToRound: () => void | Promise<void>;
}) {
  // «زر بحث بالاسم او برقم التليفون … وفلتر بالكورسات وفلتر بالمسكنين والغير
  // مسكنين». The course filter starts on this round's course; «كل العملاء»
  // is what the old «عرض جميع العملاء» box did.
  const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [housing, setHousing] = useState<'all' | 'unhoused' | 'housed'>('unhoused');
  if (!daqqiAddClientsRoundId) return null;
      const addRound = daqqiRounds.find(r => r.id === daqqiAddClientsRoundId);
      const addCourse = addRound ? courses.find(c => c.id === addRound.courseId) : null;
      const alreadyIn = new Set(addRound?.attendees.map(a => a.subscriberId) ?? []);
      const term = search.trim().toLowerCase();
      const digits = term.replace(/\D/g, '');
      const wantedCourse = courseFilter === '' ? addRound?.courseId || '' : courseFilter;
      const available = daqqiSubs.filter(s => {
        if (alreadyIn.has(s.id)) return false;
        if (wantedCourse !== 'all' && !isEnrolledInCourse(bundles, s.enrolledCourseIds || [], wantedCourse)) return false;
        if (housing === 'housed' && !assignedSubIds.has(s.id)) return false;
        if (housing === 'unhoused' && assignedSubIds.has(s.id)) return false;
        if (term) {
          const byName = String(s.name || '').toLowerCase().includes(term) || String(s.clientCode || '').toLowerCase().includes(term);
          const byPhone = digits.length >= 3 && String(s.phone || '').replace(/\D/g, '').includes(digits);
          if (!byName && !byPhone) return false;
        }
        return true;
      });
      const closeModal = () => {
        setDaqqiAddClientsRoundId(''); setDaqqiAddClientsSel(new Set()); setDaqqiAddClientsCourseSel({});
        setSearch(''); setCourseFilter(''); setHousing('unhoused');
      };
      return (
        <Modal
          open
          onClose={closeModal}
          title="إضافة عملاء للروند"
          subtitle={`${addCourse?.titleAr || addCourse?.title || addRound?.courseId} — ${addRound?.code}`}
          size="xl"
          footer={(
            <>
              <button onClick={closeModal} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
              <button onClick={handleAddClientsToRound} disabled={daqqiAddClientsSel.size === 0} className="px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 disabled:opacity-40 transition">إضافة ({daqqiAddClientsSel.size})</button>
            </>
          )}
        >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="بحث بالاسم أو رقم التليفون أو الكود"
                  className="w-full rounded-lg border border-gray-200 py-1.5 pl-3 pr-8 text-xs focus:border-primary-400 focus:outline-none" />
              </div>
              <select value={courseFilter} onChange={event => setCourseFilter(event.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs" aria-label="فلتر بالكورس">
                <option value="">حاجزين كورس الروند ده</option>
                <option value="all">كل العملاء</option>
                {courses.map(course => <option key={course.id} value={course.id}>{course.titleAr || course.title}</option>)}
              </select>
              <select value={housing} onChange={event => setHousing(event.target.value as typeof housing)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs" aria-label="فلتر بالتسكين">
                <option value="unhoused">غير مسكّنين</option>
                <option value="housed">مسكّنين في روند</option>
                <option value="all">الكل</option>
              </select>
            </div>
            <div className="flex items-center justify-between mb-3">
              <label className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer">
                <input type="checkbox" checked={daqqiAddClientsSel.size === available.length && available.length > 0} onChange={e => setDaqqiAddClientsSel(e.target.checked ? new Set(available.map(s => s.id)) : new Set())} />
                تحديد الكل ({available.length})
              </label>
            </div>
            {available.length === 0 ? (
              <div className="border border-dashed border-gray-300 rounded-xl p-8 text-center text-gray-400 text-sm">
                مفيش عملاء بالبحث والفلاتر دي.
              </div>
            ) : (
              <div className="border border-gray-200 rounded-xl overflow-hidden mb-4 max-h-[55vh] overflow-y-auto">
                {available.map(s => {
                  const enrolledIds = s.enrolledCourseIds || [];
                  // Determine which courseId to use for this client in this round
                  const chosenCourseId = daqqiAddClientsCourseSel[s.id] || (addRound?.courseId ?? '');
                  // The course's own line, or its track's: its price agreed, its
                  // payments and «مدفوع قبل السيستم» (lib/agreedPrice.ts).
                  const money = courseMoneyFor(s, chosenCourseId, courses, bundles, 'EGP');
                  const paidForCourse = money?.paid ?? 0;
                  const cp = money?.expected || (addCourse?.price?.EGP ?? 0);
                  const rem = money ? money.remaining : cp;
                  const enrolled = enrolledLabels(courses, bundles, enrolledIds);
                  // Multi-course: show selector when client has >1 enrollment AND we need to pick
                  const hasMultiCourse = enrolledIds.length > 1;
                  const isSelected = daqqiAddClientsSel.has(s.id);
                  return (
                    <div key={s.id} className={`border-b border-gray-100 last:border-0 px-3 py-2.5 transition ${isSelected ? 'bg-blue-50/60' : 'hover:bg-gray-50'}`}>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={isSelected} onChange={e => setDaqqiAddClientsSel(prev => { const next = new Set(prev); e.target.checked ? next.add(s.id) : next.delete(s.id); return next; })} className="flex-shrink-0" />
                        <span className="font-bold text-gray-800 text-sm w-36 truncate flex-shrink-0">{s.name}</span>
                        {s.clientCode && <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-mono flex-shrink-0">#{s.clientCode}</span>}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0 ${s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{s.status === 'active' ? 'نشط' : 'متوقف'}</span>
                        <a href={`tel:${s.phone}`} onClick={e => e.stopPropagation()} className="text-blue-600 text-[11px] w-28 flex-shrink-0 hover:underline">{s.phone || '—'}</a>
                        <span className="text-green-700 text-[11px] font-semibold flex-shrink-0">💰 {paidForCourse.toLocaleString('ar-EG-u-nu-latn')}</span>
                        {cp > 0 && <span className={`text-[11px] font-semibold flex-shrink-0 ${rem > 0 ? 'text-amber-600' : 'text-green-600'}`}>{rem > 0 ? `⏳ ${rem.toLocaleString('ar-EG-u-nu-latn')}` : '✅'}</span>}
                        {!hasMultiCourse && enrolled.length > 0 && (
                          <div className="flex gap-0.5 flex-wrap min-w-0">{enrolled.map((t, i) => <span key={i} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded whitespace-nowrap">🎓 {t}</span>)}</div>
                        )}
                      </label>
                      {/* Multi-course selector */}
                      {hasMultiCourse && (
                        <div className="mt-1.5 mr-6 flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-bold text-amber-700">⚠️ متعدد الكورسات — اختر الكورس لهذه الروند:</span>
                          <select
                            value={chosenCourseId}
                            onClick={e => e.stopPropagation()}
                            onChange={e => {
                              setDaqqiAddClientsCourseSel(prev => ({ ...prev, [s.id]: e.target.value }));
                              if (!isSelected) setDaqqiAddClientsSel(prev => { const next = new Set(prev); next.add(s.id); return next; });
                            }}
                            className="border border-amber-300 bg-amber-50 text-amber-900 rounded-lg px-2 py-1 text-xs font-semibold focus:outline-none focus:border-amber-500 max-w-xs"
                          >
                            {enrolledIds.map(cid => {
                              const isBnd = cid.startsWith('bundle:');
                              const lb = isBnd
                                ? bundles.find(b => b.id === cid.replace('bundle:', ''))?.title || cid
                                : courses.find(c => c.id === cid)?.titleAr || courses.find(c => c.id === cid)?.title || cid;
                              return <option key={cid} value={cid}>{isBnd ? '📌' : '🎓'} {lb}</option>;
                            })}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
        </Modal>
      );
}
