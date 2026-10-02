// One round in the schedule table: its summary row, and the panel that opens
// under it with the attendees, their payments and the per-client actions.
//
// Presentational. Every handler here writes through DaqqiScheduleTab, which
// owns the rounds and the modals these buttons open, so the state stays there
// and this row receives it.

import React from 'react';
import { X, UserPlus, Pencil, CalendarDays, UserCheck, MessageCircle, CreditCard, Eye, ArrowLeftRight, Undo2 } from 'lucide-react';
import type { Course, Bundle, SubscriberItem, DaqqiRound } from '../../../../types';
import type { DaqqiDraftType } from './daqqiScheduleUtils';
import { toDialable } from '../../../../lib/whatsappLink';
import type { DaqqiPayModalState } from './useDaqqiPaymentState';
import type { PaymentDraft } from '../../../../components/PaymentModal';
import { calcCurrentLecture, getCurrentWeekKey, courseBundles } from './daqqiScheduleUtils';
import { DAQQI_TIME_SLOT_COLORS as timeSlotColors, DAQQI_STATUS_COLORS as statusColorsMap } from './daqqiScheduleConfig';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

export function DaqqiRoundRow({
  index,
  coursePath,
  canChoosePath,
  onChoosePath,
  round,
  isAdmin,
  resetDaqqiPayDraft,
  deleteDaqqiRound,
  navigate,
  courses,
  subscribers,
  bundles,
  daqqiExpandedId,
  setDaqqiExpandedId,
  setDaqqiEditRoundId,
  setDaqqiEditDraft,
  setDaqqiAddClientsRoundId,
  setDaqqiAddClientsSel,
  setDaqqiPayModal,
  setDaqqiPostponeModal,
  setDaqqiTransferModal,
  handleDaqqiMarkAttendance,
  handleDaqqiUnmarkAttendance,
  handleDaqqiMarkWeek,
  handleRemoveAttendeeFromRound,
  doUpdateRound,
  notify,
}: {
  /** Its place in the table, for the alternating rows. */
  index: number;
  /** The path chosen to show under this course, '' when none is. */
  coursePath: string;
  canChoosePath: boolean;
  onChoosePath: (bundleId: string) => void;
  isAdmin: boolean;
  resetDaqqiPayDraft: (overrides?: Partial<PaymentDraft>) => void;
  setDaqqiCommModal: (value: { subscriberId: string; subscriberName: string; phone: string } | null) => void;
  setDaqqiToskeenSubId: (id: string | null) => void;
  deleteDaqqiRound: (id: string) => Promise<boolean>;
  attendanceCounts: Record<string, number>;
  navigate: (to: string) => void;
  round: DaqqiRound;
  courses: Course[];
  subscribers: SubscriberItem[];
  bundles: Bundle[];
  daqqiRounds: DaqqiRound[];
  daqqiExpandedId: string;
  setDaqqiExpandedId: (id: string) => void;
  setDaqqiEditRoundId: (id: string) => void;
  setDaqqiEditDraft: React.Dispatch<React.SetStateAction<DaqqiDraftType>>;
  setDaqqiAddClientsRoundId: (id: string) => void;
  setDaqqiAddClientsSel: React.Dispatch<React.SetStateAction<Set<string>>>;
  setDaqqiPayModal: (value: DaqqiPayModalState) => void;
  setDaqqiPostponeModal: (value: { roundId: string; newDate: string } | null) => void;
  setDaqqiTransferModal: (value: { subscriberId: string; fromRoundId: string } | null) => void;
  handleDaqqiMarkAttendance: (roundId: string, subscriberId: string) => void | Promise<void>;
  /** Takes back the current lecture's mark, for a tap on the wrong person. */
  handleDaqqiUnmarkAttendance: (roundId: string, subscriberId: string) => void | Promise<void>;
  handleDaqqiMarkWeek: (roundId: string, held: boolean) => void | Promise<void>;
  handleRemoveAttendeeFromRound: (roundId: string, subscriberId: string) => void | Promise<void>;
  doUpdateRound: (round: DaqqiRound) => Promise<boolean>;
  notify: NotifyFn;
}) {
                    const course = courses.find(c => c.id === round.courseId);
                    const isExpanded = daqqiExpandedId === round.id;
                    const coursePrice = course?.price?.EGP ?? 0;
                    const collected = round.attendees.reduce((sum, a) => sum + a.amountPaid, 0);
                    const expected = coursePrice * round.attendees.length;
                    const remaining = Math.max(0, expected - collected);
                    const status = round.status || 'new';
                    return (
                      <React.Fragment key={round.id}>
                        {/* «سطر خلفيه ابيض وسطر خلفيه رمادي»; the open round is tinted,
                            with the panel under it, so the two read as one. */}
                        <tr className={`${isExpanded ? 'bg-sky-100/70' : index % 2 ? 'bg-gray-50' : 'bg-white'} hover:bg-primary-50/40 cursor-pointer transition-colors border-b border-gray-100 align-top`} onClick={() => setDaqqiExpandedId(isExpanded ? '' : round.id)}>
                          <td className="px-2 py-2.5 text-xs font-mono font-bold text-purple-700 break-words">{round.code || '—'}</td>
                          <td className="px-2 py-2.5 text-xs">
                            <span className="font-bold text-gray-800 break-words">{course?.titleAr || course?.title || round.courseId}</span>
                            {/* One path, the one chosen for the course (the
                                first until one is), not every path it is in. */}
                            {(() => {
                              const paths = courseBundles(bundles, round.courseId);
                              const shown = paths.find(bundle => bundle.id === coursePath) || paths[0];
                              if (!shown) return null;
                              return canChoosePath && paths.length > 1 ? (
                                <select value={shown.id} title="المسار اللي يظهر تحت الكورس ده"
                                  onClick={event => event.stopPropagation()} onChange={event => onChoosePath(event.target.value)}
                                  className="mt-0.5 block w-full max-w-full cursor-pointer truncate rounded border border-dashed border-violet-200 bg-transparent px-1 text-[10px] font-semibold text-violet-600 hover:border-violet-400">
                                  {paths.map(bundle => <option key={bundle.id} value={bundle.id}>مسار: {bundle.title}</option>)}
                                </select>
                              ) : <div className="text-[10px] text-violet-600 font-semibold mt-0.5 break-words">مسار: {shown.title}</div>;
                            })()}
                          </td>
                          {/* Day, slot, start date and hall: one cell. */}
                          <td className="px-2 py-2.5 text-xs">
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="font-semibold text-gray-800">{round.dayOfWeek}</span>
                              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${timeSlotColors[round.timeSlot] || ''}`}>{round.timeSlot}</span>
                            </div>
                            {/* Rounds whose start date could not be recovered were
                                cleared to NULL by migration 205, and this rendered
                                them as "الأحد()" — an empty bracket that reads as a
                                broken page rather than as a field waiting to be set. */}
                            {round.startDate
                              ? <div className="text-gray-400 text-[11px] mt-0.5">من {round.startDate}</div>
                              : <div className="text-amber-600 text-[11px] font-bold mt-0.5">بدون تاريخ — عدّل الروند</div>}
                            {(round.room || round.roomName) && <div className="text-gray-500 text-[11px] break-words">{round.room || round.roomName}</div>}
                          </td>
                          <td className="px-2 py-2.5 text-xs">
                            <div className="text-gray-800 break-words">{round.instructorName || '—'}</div>
                            {round.receptionName && <div className="text-gray-500 text-[11px] break-words">ريسبشن: {round.receptionName}</div>}
                          </td>
                          <td className="px-2 py-2.5" onClick={e => e.stopPropagation()}>
                            <select
                              value={status}
                              onChange={async e => {
                                if (!await doUpdateRound({ ...round, status: e.target.value as DaqqiRound['status'], ...(e.target.value === 'active' && { currentLecture: round.currentLecture || 1 }) })) {
                                  notify('error', 'تعذر تحديث حالة الروند.');
                                }
                              }}
                              className={`max-w-full text-[11px] font-bold px-2 py-0.5 rounded-full border-0 cursor-pointer ${statusColorsMap[status] || ''}`}
                            >
                              <option value="new">جديد</option>
                              <option value="active">شغال</option>
                              <option value="finished">منتهي</option>
                            </select>
                          </td>
                          <td className="px-1 py-2.5 text-center">
                            {status === 'active' ? (() => {
                              const lectureNum = calcCurrentLecture(round.startDate, round.postponedWeeks);
                              const postponeCount = (round.postponedWeeks || []).length;
                              return (
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className="text-sm font-extrabold text-blue-700 bg-blue-50 rounded-full px-2 py-0.5 whitespace-nowrap">م {lectureNum}</span>
                                  {postponeCount > 0 && <span className="text-[9px] text-amber-500 font-bold">({postponeCount} تأج)</span>}
                                </div>
                              );
                            })() : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className="px-2 py-2.5 text-xs font-bold text-green-700">{collected.toLocaleString('ar-EG-u-nu-latn')} ج.م</td>
                          <td className="px-2 py-2.5 text-xs">
                            {remaining > 0
                              ? <span className="font-bold text-amber-600">{remaining.toLocaleString('ar-EG-u-nu-latn')} ج.م</span>
                              : <span className="text-green-600 text-[11px] font-bold">مكتمل</span>}
                          </td>
                          <td className="px-2 py-2.5 text-xs">
                            <span className="inline-block px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-bold text-[11px] whitespace-nowrap">{round.attendees.length} حاضر</span>
                          </td>
                          <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                            <div className="flex flex-col gap-0.5">
                              <div className={`grid ${isAdmin ? 'grid-cols-4' : 'grid-cols-3'} gap-0.5`}>
                                <button onClick={() => { setDaqqiAddClientsRoundId(round.id); setDaqqiAddClientsSel(new Set()); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-center transition" title="+ عملاء"><UserPlus size={12} /></button>
                                <button onClick={() => { setDaqqiEditRoundId(round.id); setDaqqiEditDraft({ courseId: round.courseId, instructorId: round.instructorId, receptionId: round.receptionId, roomId: round.room || round.roomName || round.roomId || '', dayOfWeek: round.dayOfWeek, startDate: round.startDate, timeSlot: round.timeSlot }); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-amber-50 hover:text-amber-600 flex items-center justify-center transition" title="تعديل"><Pencil size={12} /></button>
                                <button onClick={() => setDaqqiPostponeModal({ roundId: round.id, newDate: round.startDate })} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-orange-50 hover:text-orange-600 flex items-center justify-center transition" title="تأجيل موعد"><CalendarDays size={12} /></button>
                                {isAdmin && <button onClick={async () => {
                                  if (!confirm(`حذف روند ${course?.titleAr || round.code}؟`)) return;
                                  const deleted = await deleteDaqqiRound(round.id);
                                  // Only the success case is announced here. A refusal
                                  // already raises site-persist-error carrying the actual
                                  // reason, and saying "تعذر حذف الروند" next to it put two
                                  // toasts on screen, the vaguer one on top.
                                  if (deleted) notify('success', 'تم حذف الروند.');
                                }} className="h-7 rounded bg-gray-50 text-red-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition" title="حذف الروند"><X size={12} /></button>}
                              </div>
                              {/* «هل المحاضرة اشتغلت في موعدها او لاء»: this
                                  week's lecture, answered either way. */}
                              {status === 'active' && (() => {
                                const thisWeek = getCurrentWeekKey();
                                const postponed = (round.postponedWeeks || []).includes(thisWeek);
                                const held = (round.heldWeeks || []).includes(thisWeek);
                                return (
                                  <div className="grid grid-cols-2 gap-0.5" title="محاضرة الأسبوع ده اشتغلت في ميعادها؟">
                                    <button onClick={() => handleDaqqiMarkWeek(round.id, true)}
                                      className={`h-6 min-w-0 truncate rounded px-0.5 text-[9px] xl:text-[10px] font-bold transition ${held ? 'bg-green-600 text-white' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>✓ اشتغلت</button>
                                    <button onClick={() => handleDaqqiMarkWeek(round.id, false)} title="ماشتغلتش — تتأجل للأسبوع الجاي"
                                      className={`h-6 min-w-0 truncate rounded px-0.5 text-[9px] xl:text-[10px] font-bold transition ${postponed ? 'bg-orange-500 text-white' : 'bg-orange-50 text-orange-600 hover:bg-orange-100'}`}>✗ ماشتغلتش</button>
                                  </div>
                                );
                              })()}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            {/* «خلي لون العملاء داخل الروند … خلفيتهم مختلفه»: it was
                                the same grey as every other row, so the list read as
                                part of the course under it. Sky, with a bar down the
                                side, and the list itself on white. */}
                            <td colSpan={10} className="border-b border-sky-200 border-r-4 border-r-sky-400 bg-sky-50 px-4 py-3">
                              <p className="text-xs font-bold text-sky-900 mb-2">قائمة الحاضرين ({round.attendees.length})</p>
                              {round.attendees.length === 0 ? (
                                <p className="text-xs text-sky-800/70">لسه محدش اتسكّن في الروند ده.</p>
                              ) : (
                                <div className="overflow-x-auto rounded-xl border border-sky-200 bg-white px-3 py-2">
                                  <table className="w-full text-xs min-w-[500px]">
                                    <thead>
                                      <tr className="text-sky-900">
                                        <th className="text-right pb-1 pr-1 font-semibold">الاسم</th>
                                        <th className="text-right pb-1 pr-4 font-semibold">الهاتف</th>
                                        <th className="text-right pb-1 pr-4 font-semibold">تاريخ الحجز</th>
                                        <th className="text-right pb-1 pr-4 font-semibold">المدفوع</th>
                                        <th className="text-right pb-1 pr-4 font-semibold">سعر الكورس</th>
                                        <th className="text-right pb-1 pr-4 font-semibold">المتبقي</th>
                                        <th className="text-right pb-1 pr-4 font-semibold">الحضور</th>
                                        <th className="text-right pb-1 pr-4 font-semibold">إجراءات</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {round.attendees.map(a => {
                                        // What the client has paid toward this course: collected here, plus what
                                        // they paid before the system (a column of its own — it was never a payment
                                        // row, and the revenue sums above must not count it).
                                        const aPrior = a.amountPrior ?? 0;
                                        const aPaid = a.amountPaid + aPrior;
                                        const aRem = coursePrice > 0 ? Math.max(0, coursePrice - aPaid) : 0;
                                        const attSub = subscribers.find(s => s.id === a.subscriberId);
                                        return (
                                          <tr key={a.subscriberId} className="border-t border-sky-100">
                                            <td className="py-1.5 pr-1">
                                              <div className="flex items-center gap-1.5">
                                                <span className="font-bold text-gray-800">{a.name}</span>
                                                {a.archived && (
                                                  <span className="text-[9px] font-bold text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded-full whitespace-nowrap" title="عميل مؤرشف — يظل محفوظاً في سجل الروند">مؤرشف</span>
                                                )}
                                              </div>
                                              {attSub?.clientCode && (
                                                <button onClick={e => { e.stopPropagation(); navigate(`/client/${attSub.clientCode}`); }} className="text-[10px] font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded hover:bg-indigo-100 mt-0.5 inline-block">#{attSub.clientCode}</button>
                                              )}
                                            </td>
                                            <td className="py-1.5 pr-4">{a.phone
                                              ? <a href={`tel:${a.phone}`} className="text-blue-600 hover:underline">{a.phone}</a>
                                              : <span className="text-gray-400">من غير رقم</span>}</td>
                                            <td className="py-1.5 pr-4 text-gray-500">{a.bookedAt}</td>
                                            <td className="py-1.5 pr-4 font-semibold text-green-700">
                                              {aPaid.toLocaleString('ar-EG-u-nu-latn')} ج.م
                                              {aPrior > 0 && (
                                                <div className="text-[10px] font-semibold text-gray-500" title="مدفوع للكورس ده قبل السيستم — محسوب في المدفوع والمتبقي، ومش داخل في إيراد الفترة">
                                                  منها {aPrior.toLocaleString('ar-EG-u-nu-latn')} ج.م قبل السيستم
                                                </div>
                                              )}
                                              {(a.amountPending ?? 0) > 0 && (
                                                <div className="text-[10px] font-semibold text-amber-600" title="مبلغ مسجّل ومستلم لكن لسه ما اتعتمدش من الحسابات — مش محسوب في المدفوع لحد الاعتماد">
                                                  ⏳ {(a.amountPending ?? 0).toLocaleString('ar-EG-u-nu-latn')} ج.م بانتظار الاعتماد
                                                </div>
                                              )}
                                              {(a.amountUnlinked ?? 0) > 0 && (
                                                <div className="text-[10px] font-semibold text-sky-600" title="دفعات اتحصّلت للعميل من غير ما تتربط بكورس أو مسار — ما اتحسبتش على الروند ده تلقائي. اربطها من ملف العميل">
                                                  + {(a.amountUnlinked ?? 0).toLocaleString('ar-EG-u-nu-latn')} ج.م غير مربوطة بكورس
                                                </div>
                                              )}
                                            </td>
                                            <td className="py-1.5 pr-4 text-gray-600">{coursePrice > 0 ? `${coursePrice.toLocaleString('ar-EG-u-nu-latn')} ج.م` : '—'}</td>
                                            <td className="py-1.5 pr-4">
                                              {coursePrice > 0 ? aRem > 0 ? <span className="font-semibold text-amber-600">{aRem.toLocaleString('ar-EG-u-nu-latn')} ج.م</span> : <span className="text-green-500 text-[10px] font-bold">مكتمل ✓</span> : <span className="text-gray-300">—</span>}
                                            </td>
                                            <td className="py-1.5 pr-4">
                                              <div className="flex items-center gap-1.5">
                                                <div className="flex items-center gap-0.5">
                                                  <span className="font-extrabold text-blue-700 text-xs">{a.attendedLectures || 0}</span>
                                                  {status === 'active' && <span className="text-gray-400 text-xs">/{calcCurrentLecture(round.startDate, round.postponedWeeks)}</span>}
                                                </div>
                                                <button onClick={e => { e.stopPropagation(); handleDaqqiMarkAttendance(round.id, a.subscriberId); }} className="p-1 rounded-lg bg-teal-50 text-teal-600 hover:bg-teal-100 transition" title="تسجيل حضور"><UserCheck size={11} /></button>
                                                <button onClick={e => { e.stopPropagation(); handleDaqqiUnmarkAttendance(round.id, a.subscriberId); }} className="p-1 rounded-lg bg-gray-50 text-gray-500 hover:bg-amber-50 hover:text-amber-600 transition" title="تراجع عن تسجيل الحضور (للمحاضرة الحالية)"><Undo2 size={11} /></button>
                                              </div>
                                            </td>
                                            <td className="py-1.5 pr-4">
                                              <div className="grid grid-cols-5 gap-0.5">
                                                <button disabled={!a.phone} onClick={e => { e.stopPropagation(); window.open(`https://wa.me/${toDialable(a.phone)}`, '_blank'); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-teal-50 hover:text-teal-600 flex items-center justify-center transition disabled:opacity-40 disabled:hover:bg-gray-50 disabled:hover:text-gray-500" title={a.phone ? 'واتساب' : 'العميل من غير رقم'}><MessageCircle size={12} /></button>
                                                <button onClick={e => { e.stopPropagation(); setDaqqiPayModal({ subscriberId: a.subscriberId, subscriberName: a.name, roundId: round.id, attendeeAmountPaid: aPaid }); resetDaqqiPayDraft({ courseId: round.courseId || '' }); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-green-50 hover:text-green-600 flex items-center justify-center transition" title="تسجيل دفعة"><CreditCard size={12} /></button>
                                                <button onClick={e => { e.stopPropagation(); const s = subscribers.find(x => x.id === a.subscriberId); navigate(`/client/${s?.clientCode || a.subscriberId}`); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-center transition" title="عرض الملف"><Eye size={12} /></button>
                                                <button onClick={e => { e.stopPropagation(); setDaqqiTransferModal({ subscriberId: a.subscriberId, fromRoundId: round.id }); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-amber-50 hover:text-amber-600 flex items-center justify-center transition" title="نقل لروند أخرى"><ArrowLeftRight size={12} /></button>
                                                <button onClick={e => { e.stopPropagation(); handleRemoveAttendeeFromRound(round.id, a.subscriberId); }} className="h-7 rounded bg-gray-50 text-red-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition" title="حذف من الروند"><X size={12} /></button>
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
}
