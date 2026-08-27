// One round in the schedule table: its summary row, and the panel that opens
// under it with the attendees, their payments and the per-client actions.
//
// Presentational. Every handler here writes through DaqqiScheduleTab, which
// owns the rounds and the modals these buttons open, so the state stays there
// and this row receives it.

import React from 'react';
import { X, UserPlus, Pencil, CalendarDays, UserCheck, MessageCircle, CreditCard, Eye, ArrowLeftRight } from 'lucide-react';
import type { Course, Bundle, SubscriberItem, DaqqiRound } from '../../../../types';
import type { DaqqiDraftType } from './daqqiScheduleUtils';
import { toDialable } from '../../../../lib/whatsappLink';
import type { DaqqiPayModalState } from './useDaqqiPaymentState';
import type { DaqqiPayDraft } from './DaqqiPayModal';
import { calcCurrentLecture, getCurrentWeekKey, courseBundles } from './daqqiScheduleUtils';
import { DAQQI_TIME_SLOT_COLORS as timeSlotColors, DAQQI_STATUS_COLORS as statusColorsMap } from './daqqiScheduleConfig';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

export function DaqqiRoundRow({
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
  handleDaqqiTogglePostpone,
  handleRemoveAttendeeFromRound,
  doUpdateRound,
  notify,
}: {
  isAdmin: boolean;
  resetDaqqiPayDraft: (overrides?: Partial<DaqqiPayDraft>) => void;
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
  handleDaqqiTogglePostpone: (roundId: string) => void | Promise<void>;
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
                        <tr className="hover:bg-primary-50/30 cursor-pointer transition-colors border-b border-gray-100" onClick={() => setDaqqiExpandedId(isExpanded ? '' : round.id)}>
                          <td className="px-3 py-2.5 text-xs font-mono font-bold text-purple-700">{round.code || '—'}</td>
                          <td className="px-3 py-2.5 text-xs">
                            <span className="font-bold text-gray-800">{course?.titleAr || course?.title || round.courseId}</span>
                            {courseBundles(bundles, round.courseId).map(b => (
                              <div key={b.id} className="text-[10px] text-violet-600 font-semibold mt-0.5">مسار: {b.title}</div>
                            ))}
                          </td>
                          <td className="px-3 py-2.5 text-xs">
                            <span className="font-semibold text-gray-800">{round.dayOfWeek}</span>
                            {/* Rounds whose start date could not be recovered were
                                cleared to NULL by migration 205, and this rendered
                                them as "الأحد()" — an empty bracket that reads as a
                                broken page rather than as a field waiting to be set. */}
                            {round.startDate
                              ? <span className="text-gray-400 mr-1 text-[11px]">({round.startDate})</span>
                              : <span className="text-amber-600 mr-1 text-[11px] font-bold">بدون تاريخ — عدّل الروند</span>}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${timeSlotColors[round.timeSlot] || ''}`}>{round.timeSlot}</span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-700">{round.instructorName}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-700">{round.receptionName}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-700">{round.room || round.roomName || '—'}</td>
                          <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                            <select
                              value={status}
                              onChange={async e => {
                                if (!await doUpdateRound({ ...round, status: e.target.value as DaqqiRound['status'], ...(e.target.value === 'active' && { currentLecture: round.currentLecture || 1 }) })) {
                                  notify('error', 'تعذر تحديث حالة الروند.');
                                }
                              }}
                              className={`text-[11px] font-bold px-2 py-0.5 rounded-full border-0 cursor-pointer ${statusColorsMap[status] || ''}`}
                            >
                              <option value="new">جديد</option>
                              <option value="active">شغال</option>
                              <option value="finished">منتهي</option>
                            </select>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {status === 'active' ? (() => {
                              const lectureNum = calcCurrentLecture(round.startDate, round.postponedWeeks);
                              const postponeCount = (round.postponedWeeks || []).length;
                              return (
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className="text-sm font-extrabold text-blue-700 bg-blue-50 rounded-full px-2.5 py-0.5">م {lectureNum}</span>
                                  {postponeCount > 0 && <span className="text-[9px] text-amber-500 font-bold">({postponeCount} تأج)</span>}
                                </div>
                              );
                            })() : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-xs">
                            <div className="text-green-700 font-bold">{collected.toLocaleString()} ج.م</div>
                            {remaining > 0 && <div className="text-amber-600 text-[11px]">متبقي: {remaining.toLocaleString()}</div>}
                          </td>
                          <td className="px-3 py-2.5 text-xs">
                            <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-bold text-[11px]">{round.attendees.length} حاضر</span>
                          </td>
                          <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                            <div className="flex flex-col gap-0.5 min-w-[100px]">
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
                              {status === 'active' && (() => {
                                const thisWeek = getCurrentWeekKey();
                                const isPostponed = (round.postponedWeeks || []).includes(thisWeek);
                                return (
                                  <button onClick={() => handleDaqqiTogglePostpone(round.id)} className={`w-full h-7 rounded flex items-center justify-center text-xs font-bold transition ${isPostponed ? 'bg-green-50 text-green-600 hover:bg-green-100' : 'bg-orange-50 text-orange-500 hover:bg-orange-100'}`} title={isPostponed ? 'رجع الأسبوع' : 'تأجيل الأسبوع'}>{isPostponed ? '↩ رجع الأسبوع' : '⏸ تأجيل الأسبوع'}</button>
                                );
                              })()}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={12} className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                              <p className="text-xs font-bold text-gray-600 mb-2">قائمة الحاضرين ({round.attendees.length})</p>
                              {round.attendees.length === 0 ? (
                                <p className="text-xs text-gray-400 italic">لم يُسجَّل حاضرون في هذه الجولة.</p>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs min-w-[500px]">
                                    <thead>
                                      <tr className="text-gray-600">
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
                                        const aRem = coursePrice > 0 ? Math.max(0, coursePrice - a.amountPaid) : 0;
                                        const attSub = subscribers.find(s => s.id === a.subscriberId);
                                        return (
                                          <tr key={a.subscriberId} className="border-t border-gray-200">
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
                                            <td className="py-1.5 pr-4"><a href={`tel:${a.phone}`} className="text-blue-600 hover:underline">{a.phone}</a></td>
                                            <td className="py-1.5 pr-4 text-gray-500">{a.bookedAt}</td>
                                            <td className="py-1.5 pr-4 font-semibold text-green-700">{a.amountPaid.toLocaleString()} ج.م</td>
                                            <td className="py-1.5 pr-4 text-gray-600">{coursePrice > 0 ? `${coursePrice.toLocaleString()} ج.م` : '—'}</td>
                                            <td className="py-1.5 pr-4">
                                              {coursePrice > 0 ? aRem > 0 ? <span className="font-semibold text-amber-600">{aRem.toLocaleString()} ج.م</span> : <span className="text-green-500 text-[10px] font-bold">مكتمل ✓</span> : <span className="text-gray-300">—</span>}
                                            </td>
                                            <td className="py-1.5 pr-4">
                                              <div className="flex items-center gap-1.5">
                                                <div className="flex items-center gap-0.5">
                                                  <span className="font-extrabold text-blue-700 text-xs">{a.attendedLectures || 0}</span>
                                                  {status === 'active' && <span className="text-gray-400 text-xs">/{calcCurrentLecture(round.startDate, round.postponedWeeks)}</span>}
                                                </div>
                                                <button onClick={e => { e.stopPropagation(); handleDaqqiMarkAttendance(round.id, a.subscriberId); }} className="p-1 rounded-lg bg-teal-50 text-teal-600 hover:bg-teal-100 transition" title="تسجيل حضور"><UserCheck size={11} /></button>
                                              </div>
                                            </td>
                                            <td className="py-1.5 pr-4">
                                              <div className="grid grid-cols-5 gap-0.5">
                                                <button onClick={e => { e.stopPropagation(); window.open(`https://wa.me/${toDialable(a.phone)}`, '_blank'); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-teal-50 hover:text-teal-600 flex items-center justify-center transition" title="واتساب"><MessageCircle size={12} /></button>
                                                <button onClick={e => { e.stopPropagation(); setDaqqiPayModal({ subscriberId: a.subscriberId, subscriberName: a.name, roundId: round.id, attendeeAmountPaid: a.amountPaid }); resetDaqqiPayDraft({ courseId: round.courseId || '' }); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-green-50 hover:text-green-600 flex items-center justify-center transition" title="تسجيل دفعة"><CreditCard size={12} /></button>
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
