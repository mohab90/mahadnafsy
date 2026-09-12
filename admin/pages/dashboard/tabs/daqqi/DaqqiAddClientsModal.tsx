// Adds existing clients to a round, one course choice per client.
//
// The selection stays in DaqqiScheduleTab because handleAddClientsToRound
// reads it and writes through the parent.

import type { Course, Bundle, SubscriberItem, DaqqiRound } from '../../../../types';
import { isEnrolledInCourse } from './daqqiScheduleUtils';
import { isCollected } from '../../../../lib/money';

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
  daqqiShowAllClients,
  setDaqqiShowAllClients,
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
  daqqiShowAllClients: boolean;
  setDaqqiShowAllClients: (value: boolean) => void;
  handleAddClientsToRound: () => void | Promise<void>;
}) {
  if (!daqqiAddClientsRoundId) return null;
      const addRound = daqqiRounds.find(r => r.id === daqqiAddClientsRoundId);
      const addCourse = addRound ? courses.find(c => c.id === addRound.courseId) : null;
      const alreadyIn = new Set(addRound?.attendees.map(a => a.subscriberId) ?? []);
      const available = daqqiSubs.filter(s => {
        if (alreadyIn.has(s.id)) return false;
        if (daqqiShowAllClients) return true;
        return isEnrolledInCourse(bundles, s.enrolledCourseIds || [], addRound!.courseId);
      });
      return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setDaqqiAddClientsRoundId(''); setDaqqiAddClientsSel(new Set()); setDaqqiAddClientsCourseSel({}); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-auto p-6" dir="rtl" onClick={e => e.stopPropagation()}>
            <h4 className="font-extrabold text-gray-900 text-lg mb-1">إضافة عملاء للروند</h4>
            <p className="text-sm text-gray-500 mb-4">{addCourse?.titleAr || addCourse?.title || addRound?.courseId} — {addRound?.code}</p>
            <div className="flex items-center justify-between mb-3">
              <label className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer">
                <input type="checkbox" checked={daqqiAddClientsSel.size === available.length && available.length > 0} onChange={e => setDaqqiAddClientsSel(e.target.checked ? new Set(available.map(s => s.id)) : new Set())} />
                تحديد الكل ({available.length})
              </label>
              <label className="text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={daqqiShowAllClients} onChange={e => { setDaqqiShowAllClients(e.target.checked); setDaqqiAddClientsSel(new Set()); setDaqqiAddClientsCourseSel({}); }} />
                عرض جميع العملاء
              </label>
            </div>
            {available.length === 0 ? (
              <div className="border border-dashed border-gray-300 rounded-xl p-8 text-center text-gray-400 text-sm">
                {daqqiShowAllClients ? 'جميع عملاء الدقي مضافون لهذه الجولة بالفعل.' : 'لا يوجد عملاء حاجزين على هذا الكورس وغير مسكّنين.'}
              </div>
            ) : (
              <div className="border border-gray-200 rounded-xl overflow-hidden mb-4 max-h-[55vh] overflow-y-auto">
                {available.map(s => {
                  const enrolledIds = s.enrolledCourseIds || [];
                  // Determine which courseId to use for this client in this round
                  const chosenCourseId = daqqiAddClientsCourseSel[s.id] || (addRound?.courseId ?? '');
                  // isCollected, not a bare sum: lib/refunds.js flips the same
                  // payments row to 'refunded' and leaves its amount positive, so
                  // without it a refunded client reads as paid up and «متبقي»
                  // shows less than they owe — on the screen where the desk
                  // decides what to charge them.
                  const paidForCourse = (s.paymentHistory || []).filter(p => isCollected(p) && p.currency === 'EGP' && (!p.courseId || p.courseId === chosenCourseId)).reduce((sum, p) => sum + Number(p.amount), 0);
                  const cp = addCourse?.price?.EGP ?? 0;
                  const rem = cp > 0 ? Math.max(0, cp - paidForCourse) : 0;
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
                        <span className="text-green-700 text-[11px] font-semibold flex-shrink-0">💰 {paidForCourse.toLocaleString()}</span>
                        {cp > 0 && <span className={`text-[11px] font-semibold flex-shrink-0 ${rem > 0 ? 'text-amber-600' : 'text-green-600'}`}>{rem > 0 ? `⏳ ${rem.toLocaleString()}` : '✅'}</span>}
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
            <div className="flex gap-3">
              <button onClick={handleAddClientsToRound} disabled={daqqiAddClientsSel.size === 0} className="flex-1 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 disabled:opacity-40 transition">إضافة ({daqqiAddClientsSel.size})</button>
              <button onClick={() => { setDaqqiAddClientsRoundId(''); setDaqqiAddClientsSel(new Set()); setDaqqiAddClientsCourseSel({}); }} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
            </div>
          </div>
        </div>
      );
}
