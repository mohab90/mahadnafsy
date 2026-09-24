// The create-a-round form, and the attendee picker that follows it.
//
// The draft, the step and the attendee selection stay in DaqqiScheduleTab:
// the dashboard can open this form through createRoundRef, which sets all
// three from outside.

import type { Course, Bundle, SubscriberItem, DaqqiRound, DaqqiDayOfWeek, DaqqiTimeSlot } from '../../../../types';
import { ChevronRight } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import { DAQQI_DAYS_OF_WEEK as daysOfWeek, DAQQI_TIME_SLOTS as timeSlotsList } from './daqqiScheduleConfig';
import type { DaqqiDraftType } from './daqqiScheduleUtils';
import { isEnrolledInCourse } from './daqqiScheduleUtils';
import { isCollected } from '../../../../lib/money';
import { cairoDay } from '../../../../../shared/cairoDate';


export function DaqqiNewRoundModal({
  daqqiDraft,
  enrolledLabels,
  assignedSubIds,
  bundles,
  daqqiShowAllClients,
  setDaqqiShowAllClients,
  handleInitCreateRound,
  instructorOptions,
  receptionOptions,
  daqqiRooms,
  setDaqqiDraft,
  daqqiStep,
  setDaqqiStep,
  daqqiPendingRound,
  daqqiSelectedAttendees,
  setDaqqiSelectedAttendees,
  setDaqqiFormOpen,
  courses,
  daqqiSubs,
  handleSaveNewRound,
}: {
  enrolledLabels: (courses: Course[], bundles: Bundle[], ids: string[]) => string[];
  assignedSubIds: Set<string>;
  bundles: Bundle[];
  daqqiShowAllClients: boolean;
  setDaqqiShowAllClients: (value: boolean) => void;
  handleInitCreateRound: () => void;
  instructorOptions: { id: string; name: string }[];
  receptionOptions: { id: string; name: string }[];
  daqqiRooms: { name: string; capacity?: number }[];
  daqqiDraft: DaqqiDraftType;
  setDaqqiDraft: React.Dispatch<React.SetStateAction<DaqqiDraftType>>;
  daqqiStep: 'form' | 'attendees';
  setDaqqiStep: (step: 'form' | 'attendees') => void;
  daqqiPendingRound: DaqqiRound | null;
  daqqiSelectedAttendees: Set<string>;
  setDaqqiSelectedAttendees: React.Dispatch<React.SetStateAction<Set<string>>>;
  setDaqqiFormOpen: (open: boolean) => void;
  courses: Course[];
  daqqiSubs: SubscriberItem[];
  handleSaveNewRound: () => void | Promise<void>;
}) {
  return (
      // No Modal footer: this is a two-step dialog and each step carries its
      // own buttons.
      <Modal open onClose={() => { setDaqqiFormOpen(false); setDaqqiStep('form'); }} title="إنشاء روند جديدة">
          {daqqiStep === 'form' ? (
            <>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-600 font-bold mb-1 block">الكورس <span className="text-red-500">*</span></label>
                  <select value={daqqiDraft.courseId} onChange={e => setDaqqiDraft({ ...daqqiDraft, courseId: e.target.value })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
                    <option value="">اختر الكورس...</option>
                    {courses.map(c => <option key={c.id} value={c.id}>{c.titleAr || c.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-bold mb-1 block">المحاضر <span className="text-red-500">*</span></label>
                  <select value={daqqiDraft.instructorId} onChange={e => setDaqqiDraft({ ...daqqiDraft, instructorId: e.target.value })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
                    <option value="">اختر المحاضر...</option>
                    {instructorOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-bold mb-1 block">مسؤول الريسبشن <span className="text-red-500">*</span></label>
                  <select value={daqqiDraft.receptionId} onChange={e => setDaqqiDraft({ ...daqqiDraft, receptionId: e.target.value })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
                    <option value="">اختر مسؤول الريسبشن...</option>
                    {receptionOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                {/* Always rendered, directly under مسؤول الريسبشن. This was a
                    <select> gated on the branch settings listing halls, so on
                    a branch that had never configured any the field simply was
                    not there — no room could be set and nothing said why. A
                    combobox suggests the configured halls when there are any
                    and still takes a name typed in when there are none. */}
                <div>
                  <label className="text-xs text-gray-600 font-bold mb-1 block">القاعة</label>
                  <input
                    list="daqqi-room-options"
                    value={daqqiDraft.roomId}
                    onChange={e => setDaqqiDraft({ ...daqqiDraft, roomId: e.target.value })}
                    placeholder={daqqiRooms.length ? 'اختر قاعة أو اكتب اسمها...' : 'اكتب اسم القاعة (اختياري)'}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
                  />
                  <datalist id="daqqi-room-options">
                    {daqqiRooms.map(r => <option key={r.name} value={r.name}>{r.capacity ? `${r.capacity} فرد` : ''}</option>)}
                  </datalist>
                  <p className="text-[10px] text-gray-400 mt-1">القاعة الواحدة لا تقبل روندين في نفس اليوم والتوقيت.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-600 font-bold mb-1 block">اليوم</label>
                    <select value={daqqiDraft.dayOfWeek} onChange={e => setDaqqiDraft({ ...daqqiDraft, dayOfWeek: e.target.value as DaqqiDayOfWeek })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
                      {daysOfWeek.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 font-bold mb-1 block">الموعد</label>
                    <select value={daqqiDraft.timeSlot} onChange={e => setDaqqiDraft({ ...daqqiDraft, timeSlot: e.target.value as DaqqiTimeSlot })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
                      {timeSlotsList.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-600 font-bold mb-1 block">تاريخ البدء <span className="text-red-500">*</span></label>
                  <input type="date" value={daqqiDraft.startDate} onChange={e => setDaqqiDraft({ ...daqqiDraft, startDate: e.target.value })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none" />
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={handleInitCreateRound} disabled={!daqqiDraft.courseId || !daqqiDraft.instructorId || !daqqiDraft.receptionId || !daqqiDraft.startDate} className="flex-1 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 disabled:opacity-40 transition">التالي: اختر الحاضرين</button>
                <button onClick={() => setDaqqiFormOpen(false)} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
              </div>
            </>
          ) : daqqiStep === 'attendees' && daqqiPendingRound ? (() => {
            const roundCourse = courses.find(c => c.id === daqqiPendingRound.courseId);
            return (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <button onClick={() => setDaqqiStep('form')} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronRight size={16} /></button>
                  <h4 className="font-extrabold text-gray-900 text-base flex-1">اختر الحاضرين — {roundCourse?.titleAr || roundCourse?.title}</h4>
                </div>
                {(() => {
                  const roundCourseId = daqqiPendingRound.courseId;
                  const candidatesFiltered = daqqiSubs.filter(s =>
                    !assignedSubIds.has(s.id) && isEnrolledInCourse(bundles, s.enrolledCourseIds || [], roundCourseId)
                  );
                  const candidatesAll = daqqiSubs.filter(s => !assignedSubIds.has(s.id));
                  const displayList = daqqiShowAllClients ? candidatesAll : candidatesFiltered;
                  return (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs text-gray-500">
                          {daqqiShowAllClients
                            ? `${candidatesAll.length} عميل غير مسكّن`
                            : `${candidatesFiltered.length} عميل حاجز على هذا الكورس وغير مسكّن`}
                        </p>
                        <label className="text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={daqqiShowAllClients} onChange={e => setDaqqiShowAllClients(e.target.checked)} />
                          عرض جميع الكورسات
                        </label>
                      </div>
                      {displayList.length === 0 ? (
                        <div className="border border-dashed border-gray-300 rounded-xl p-6 text-center text-gray-400 text-sm mb-2">
                          {daqqiShowAllClients ? 'لا يوجد عملاء غير مسكّنين في فرع الدقي.' : 'لا يوجد عملاء حاجزين على هذا الكورس وغير مسكّنين.'}
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto mb-2">
                          <label className="flex items-center gap-2 text-xs font-bold text-gray-600 mb-1 cursor-pointer">
                            <input type="checkbox" checked={daqqiSelectedAttendees.size === displayList.length && displayList.length > 0} onChange={e => setDaqqiSelectedAttendees(e.target.checked ? new Set(displayList.map(s => s.id)) : new Set())} />
                            تحديد الكل
                          </label>
                          {displayList.map(s => {
                            const paid = (s.paymentHistory || []).reduce((sum, p) => isCollected(p) && p.currency === 'EGP' ? sum + Number(p.amount) : sum, 0);
                            const cp = roundCourse?.price?.EGP ?? 0;
                            const enrolledNames = enrolledLabels(courses, bundles, s.enrolledCourseIds || []);
                            const bookingDate = cairoDay(s.createdAt);
                            return (
                              <label key={s.id} className="flex items-center gap-3 border border-gray-200 rounded-xl px-3 py-2.5 cursor-pointer hover:bg-gray-50">
                                <input type="checkbox" checked={daqqiSelectedAttendees.has(s.id)} onChange={e => setDaqqiSelectedAttendees(prev => { const next = new Set(prev); e.target.checked ? next.add(s.id) : next.delete(s.id); return next; })} />
                                <div className="flex-1 min-w-0">
                                  <div className="font-bold text-gray-800 text-sm">{s.name}</div>
                                  <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
                                    <span>{s.phone}</span>
                                    {bookingDate && <span className="text-gray-400">📅 {bookingDate}</span>}
                                    <span className="text-green-700 font-semibold">مدفوع: {paid.toLocaleString('ar-EG-u-nu-latn')} ج.م</span>
                                    {cp > 0 && <span className="text-gray-400">من {cp.toLocaleString('ar-EG-u-nu-latn')} ج.م</span>}
                                  </div>
                                  {enrolledNames.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {enrolledNames.map((n, i) => <span key={i} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded">🎓 {n}</span>)}
                                    </div>
                                  )}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
                <div className="flex gap-3 mt-5">
                  <button onClick={handleSaveNewRound} className="flex-1 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition">حفظ الجولة ({daqqiSelectedAttendees.size} حاضر)</button>
                  <button onClick={() => setDaqqiFormOpen(false)} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
                </div>
              </>
            );
          })() : null}
      </Modal>
  );
}
