// One round in the schedule table: its summary row, and the panel that opens
// under it with the attendees, their payments and the per-client actions.
//
// Presentational. Every handler here writes through DaqqiScheduleTab, which
// owns the rounds and the modals these buttons open, so the state stays there
// and this row receives it.

import React from 'react';
import { X, UserPlus, Pencil, CalendarDays, UserCheck, ExternalLink, Wallet, Phone, ArrowLeftRight, Undo2 } from 'lucide-react';
import type { Course, Bundle, CommunicationRecord, SubscriberItem, DaqqiRound } from '../../../../types';
import type { DaqqiDraftType } from './daqqiScheduleUtils';
import { waLink } from '../../../../lib/whatsappLink';
import { WhatsAppIcon } from '../../../../components/WhatsAppIcon';
import { cairoDay } from '../../../../../shared/cairoDate';
import type { DaqqiPayModalState } from './useDaqqiPaymentState';
import type { PaymentDraft } from '../../../../components/PaymentModal';
import { attendeeMoney, lastContactOf, roundMoney, calcCurrentLecture, getCurrentWeekKey, courseBundles } from './daqqiScheduleUtils';
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
  setDaqqiCommModal,
  localComms,
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
  /** Opens the contact log for a client: the kind already picked (call or WhatsApp). */
  setDaqqiCommModal: (value: { subscriberId: string; subscriberName: string; phone: string; type: 'call' | 'whatsapp' } | null) => void;
  /** Contacts logged since the list was loaded, by client, so the column answers at once. */
  localComms: Record<string, CommunicationRecord[]>;
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
                    // «في الكورس نفسه قاري 0»: the round's figure left out what clients paid before
                    // the system, which is most of what Dokki's clients have paid. It is the sum of
                    // the clients' own figures below, so the two always agree.
                    const money = roundMoney(round, coursePrice);
                    const collected = money.paid;
                    const priorTotal = money.prior + money.applied;
                    const remaining = money.remaining;
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
                          {/* Day, slot and start date: one cell. The hall has its own column. */}
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
                          </td>
                          {/* «خلي عمود القاعه عمود لوحده». */}
                          <td className="px-1 py-2.5 text-[11px]">
                            {(round.room || round.roomName)
                              ? <span className="inline-block max-w-full break-words rounded-md bg-slate-100 px-1 py-0.5 text-[10px] font-semibold leading-tight text-slate-700">{round.room || round.roomName}</span>
                              : <span className="text-gray-300">—</span>}
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
                          <td className="px-2 py-2.5 text-xs font-bold text-green-700">
                            {collected.toLocaleString('ar-EG-u-nu-latn')} ج.م
                            {priorTotal > 0 && <div className="text-[10px] font-semibold text-gray-500" title="مدفوع قبل السيستم — محسوب هنا، ومش داخل في إيراد الفترة">منها {priorTotal.toLocaleString('ar-EG-u-nu-latn')} قبل السيستم</div>}
                          </td>
                          <td className="px-2 py-2.5 text-xs">
                            {remaining > 0
                              ? <span className="font-bold text-amber-600">{remaining.toLocaleString('ar-EG-u-nu-latn')} ج.م</span>
                              : <span className="text-green-600 text-[11px] font-bold">مكتمل</span>}
                          </td>
                          <td className="px-2 py-2.5 text-xs">
                            <span className="inline-block px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-bold text-[11px] whitespace-nowrap">{round.attendees.length} حاضر</span>
                          </td>
                          {/* Small icon buttons on one line; the week's two answers sit in the
                              same line as tiny ✓ / ✗ instead of a second full-width row. */}
                          <td className="px-1 py-2" onClick={e => e.stopPropagation()}>
                            <div className="flex flex-wrap items-center justify-center gap-0.5">
                              <button onClick={() => { setDaqqiAddClientsRoundId(round.id); setDaqqiAddClientsSel(new Set()); }} className="h-6 w-6 shrink-0 rounded bg-gray-50 text-gray-500 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-center transition" title="+ عملاء"><UserPlus size={11} /></button>
                              <button onClick={() => { setDaqqiEditRoundId(round.id); setDaqqiEditDraft({ courseId: round.courseId, instructorId: round.instructorId, receptionId: round.receptionId, roomId: round.room || round.roomName || round.roomId || '', dayOfWeek: round.dayOfWeek, startDate: round.startDate, timeSlot: round.timeSlot }); }} className="h-6 w-6 shrink-0 rounded bg-gray-50 text-gray-500 hover:bg-amber-50 hover:text-amber-600 flex items-center justify-center transition" title="تعديل"><Pencil size={11} /></button>
                              <button onClick={() => setDaqqiPostponeModal({ roundId: round.id, newDate: round.startDate })} className="h-6 w-6 shrink-0 rounded bg-gray-50 text-gray-500 hover:bg-orange-50 hover:text-orange-600 flex items-center justify-center transition" title="تأجيل موعد"><CalendarDays size={11} /></button>
                              {isAdmin && <button onClick={async () => {
                                if (!confirm(`حذف روند ${course?.titleAr || round.code}؟`)) return;
                                const deleted = await deleteDaqqiRound(round.id);
                                // Only the success case is announced here. A refusal
                                // already raises site-persist-error carrying the actual
                                // reason, and saying "تعذر حذف الروند" next to it put two
                                // toasts on screen, the vaguer one on top.
                                if (deleted) notify('success', 'تم حذف الروند.');
                              }} className="h-6 w-6 shrink-0 rounded bg-gray-50 text-red-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition" title="حذف الروند"><X size={11} /></button>}
                              {/* «هل المحاضرة اشتغلت في موعدها او لاء»: this
                                  week's lecture, answered either way. */}
                              {status === 'active' && (() => {
                                const thisWeek = getCurrentWeekKey();
                                const postponed = (round.postponedWeeks || []).includes(thisWeek);
                                const held = (round.heldWeeks || []).includes(thisWeek);
                                return (
                                  <>
                                    <button onClick={() => handleDaqqiMarkWeek(round.id, true)} title="المحاضرة اشتغلت في ميعادها الأسبوع ده"
                                      className={`h-6 w-6 shrink-0 rounded text-[11px] font-bold transition ${held ? 'bg-green-600 text-white' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>✓</button>
                                    <button onClick={() => handleDaqqiMarkWeek(round.id, false)} title="ماشتغلتش — تتأجل للأسبوع الجاي"
                                      className={`h-6 w-6 shrink-0 rounded text-[11px] font-bold transition ${postponed ? 'bg-orange-500 text-white' : 'bg-orange-50 text-orange-600 hover:bg-orange-100'}`}>✗</button>
                                  </>
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
                            <td colSpan={11} className="border-b border-sky-200 border-r-4 border-r-sky-400 bg-sky-50 px-4 py-3">
                              <p className="text-xs font-bold text-sky-900 mb-2">قائمة الحاضرين ({round.attendees.length})</p>
                              {round.attendees.length === 0 ? (
                                <p className="text-xs text-sky-800/70">لسه محدش اتسكّن في الروند ده.</p>
                              ) : (
                                <div className="overflow-x-auto rounded-xl border border-sky-200 bg-white px-3 py-2">
                                  <table className="w-full text-xs min-w-[760px]">
                                    <thead>
                                      <tr className="text-sky-900">
                                        <th className="text-right pb-1 pr-1 font-semibold">الاسم</th>
                                        <th className="text-right pb-1 pr-3 font-semibold">تاريخ الحجز</th>
                                        <th className="text-right pb-1 pr-3 font-semibold">المدفوع</th>
                                        <th className="text-right pb-1 pr-3 font-semibold">سعر الكورس</th>
                                        <th className="text-right pb-1 pr-3 font-semibold">المتبقي</th>
                                        <th className="text-right pb-1 pr-3 font-semibold">الحضور</th>
                                        <th className="text-right pb-1 pr-3 font-semibold">التواصل</th>
                                        <th className="text-right pb-1 pr-3 font-semibold">إجراءات</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {round.attendees.map(a => {
                                        // What the client has paid toward this course: collected here, plus what
                                        // they paid before the system (a column of its own — it was never a payment
                                        // row, and the revenue sums above must not count it).
                                        const { prior: aPrior, applied: aApplied, paid: aPaid, price: aPrice, remaining: aRem } = attendeeMoney(a, coursePrice);
                                        const attSub = subscribers.find(s => s.id === a.subscriberId);
                                        const waHref = waLink(a.phone);
                                        const lastComm = lastContactOf(attSub, localComms[a.subscriberId]);
                                        const followUp = attSub?.nextFollowUpDate || lastComm?.nextFollowUp || '';
                                        const contactTarget = (type: 'call' | 'whatsapp') => setDaqqiCommModal({ subscriberId: a.subscriberId, subscriberName: a.name, phone: a.phone, type });
                                        const iconButton = 'h-7 w-7 shrink-0 rounded bg-gray-50 text-gray-500 flex items-center justify-center transition';
                                        return (
                                          <tr key={a.subscriberId} className="border-t border-sky-100 align-top">
                                            {/* «اسم العميل تحته رقم التليفون». */}
                                            <td className="py-1.5 pr-1">
                                              <div className="flex items-center gap-1.5">
                                                <span className="font-bold text-gray-800">{a.name}</span>
                                                {a.archived && (
                                                  <span className="text-[9px] font-bold text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded-full whitespace-nowrap" title="عميل مؤرشف — يظل محفوظاً في سجل الروند">مؤرشف</span>
                                                )}
                                              </div>
                                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                                {a.phone
                                                  ? <a href={`tel:${a.phone}`} dir="ltr" className="text-[11px] text-blue-600 hover:underline">{a.phone}</a>
                                                  : <span className="text-[11px] text-gray-400">من غير رقم</span>}
                                                {attSub?.clientCode && (
                                                  <button onClick={e => { e.stopPropagation(); navigate(`/client/${attSub.clientCode}`); }} className="text-[10px] font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded hover:bg-indigo-100 inline-block">#{attSub.clientCode}</button>
                                                )}
                                              </div>
                                            </td>
                                            <td className="py-1.5 pr-3 text-gray-500 whitespace-nowrap">{a.bookedAt}</td>
                                            <td className="py-1.5 pr-3 font-semibold text-green-700">
                                              {aPaid.toLocaleString('ar-EG-u-nu-latn')} ج.م
                                              {a.trackTitle && (
                                                <div className="text-[10px] font-semibold text-violet-600" title="العميل حاجز المسار ده — الدفع والسعر على المسار كله">مسار: {a.trackTitle}</div>
                                              )}
                                              {aPrior > 0 && (
                                                <div className="text-[10px] font-semibold text-gray-500" title="مدفوع للكورس ده قبل السيستم — محسوب في المدفوع والمتبقي، ومش داخل في إيراد الفترة">
                                                  منها {aPrior.toLocaleString('ar-EG-u-nu-latn')} ج.م قبل السيستم
                                                </div>
                                              )}
                                              {aApplied > 0 && (
                                                <div className="text-[10px] font-semibold text-sky-600" title="دفعات اتحصّلت للعميل من غير ما تتسجل على كورس — اتحسبت هنا لأن ده الكورس الوحيد عنده">
                                                  منها {aApplied.toLocaleString('ar-EG-u-nu-latn')} ج.م من غير كورس محدد
                                                </div>
                                              )}
                                              {(a.amountPending ?? 0) > 0 && (
                                                <div className="text-[10px] font-semibold text-amber-600" title="مبلغ مسجّل ومستلم لكن لسه ما اتعتمدش من الحسابات — مش محسوب في المدفوع لحد الاعتماد">
                                                  ⏳ {(a.amountPending ?? 0).toLocaleString('ar-EG-u-nu-latn')} ج.م بانتظار الاعتماد
                                                </div>
                                              )}
                                              {(a.amountUnlinked ?? 0) > 0 && aApplied === 0 && (
                                                <div className="text-[10px] font-semibold text-sky-600" title="دفعات اتحصّلت للعميل من غير ما تتربط بكورس أو مسار، وعنده أكتر من كورس — ما اتحسبتش على الروند ده تلقائي. اربطها من ملف العميل">
                                                  + {(a.amountUnlinked ?? 0).toLocaleString('ar-EG-u-nu-latn')} ج.م غير مربوطة بكورس
                                                </div>
                                              )}
                                            </td>
                                            <td className="py-1.5 pr-3 text-gray-600">{aPrice > 0 ? `${aPrice.toLocaleString('ar-EG-u-nu-latn')} ج.م` : '—'}</td>
                                            <td className="py-1.5 pr-3">
                                              {aPrice > 0 ? aRem > 0 ? <span className="font-semibold text-amber-600">{aRem.toLocaleString('ar-EG-u-nu-latn')} ج.م</span> : <span className="text-green-500 text-[10px] font-bold">مكتمل ✓</span> : <span className="text-gray-300">—</span>}
                                            </td>
                                            <td className="py-1.5 pr-3">
                                              <div className="flex items-center gap-1.5">
                                                <div className="flex items-center gap-0.5">
                                                  <span className="font-extrabold text-blue-700 text-xs">{a.attendedLectures || 0}</span>
                                                  {status === 'active' && <span className="text-gray-400 text-xs">/{calcCurrentLecture(round.startDate, round.postponedWeeks)}</span>}
                                                </div>
                                                <button onClick={e => { e.stopPropagation(); handleDaqqiMarkAttendance(round.id, a.subscriberId); }} className="p-1 rounded-lg bg-teal-50 text-teal-600 hover:bg-teal-100 transition" title="تسجيل حضور"><UserCheck size={11} /></button>
                                                <button onClick={e => { e.stopPropagation(); handleDaqqiUnmarkAttendance(round.id, a.subscriberId); }} className="p-1 rounded-lg bg-gray-50 text-gray-500 hover:bg-amber-50 hover:text-amber-600 transition" title="تراجع عن تسجيل الحضور (للمحاضرة الحالية)"><Undo2 size={11} /></button>
                                              </div>
                                            </td>
                                            {/* آخر تواصل مع العميل ونتيجته وموعد المتابعة. */}
                                            <td className="py-1.5 pr-3 min-w-[130px] max-w-[190px]">
                                              {lastComm || followUp ? (
                                                <div className="space-y-0.5">
                                                  {lastComm?.outcome && <div className="font-extrabold text-emerald-700">{lastComm.outcome}</div>}
                                                  {lastComm?.notes && <div className="text-gray-600 line-clamp-2" title={lastComm.notes}>{lastComm.notes}</div>}
                                                  {lastComm && <div className="text-[10px] text-gray-400">{lastComm.staffName ? `${lastComm.staffName} · ` : ''}{cairoDay(lastComm.date)}</div>}
                                                  {followUp && <div className="inline-block rounded-lg border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 whitespace-nowrap">📅 المتابعة: {followUp.slice(0, 10)}</div>}
                                                </div>
                                              ) : <span className="text-gray-300">—</span>}
                                            </td>
                                            {/* «اول حاجه ايقونه ملف العميل بعدها الدفع بعدها التواصل بعدها الواتس
                                                وبعدها نقل لروند تانيه واخيرا مسح من الروند» — the same icons as
                                                «عملاء الدقي», in that order. */}
                                            <td className="py-1.5 pr-3">
                                              <div className="flex items-center gap-0.5">
                                                <button title="ملف العميل" onClick={e => { e.stopPropagation(); navigate(`/client/${attSub?.clientCode || a.subscriberId}`); }} className={`${iconButton} hover:bg-primary-50 hover:text-primary-600`}><ExternalLink size={12} /></button>
                                                <button title="تسجيل دفعة" onClick={e => { e.stopPropagation(); setDaqqiPayModal({ subscriberId: a.subscriberId, subscriberName: a.name, roundId: round.id, attendeeAmountPaid: aPaid }); resetDaqqiPayDraft({ courseId: round.courseId || '' }); }} className={`${iconButton} hover:bg-emerald-50 hover:text-emerald-600`}><Wallet size={12} /></button>
                                                <button title="تواصل" onClick={e => { e.stopPropagation(); contactTarget('call'); }} className={`${iconButton} hover:bg-blue-50 hover:text-blue-600`}><Phone size={12} /></button>
                                                {waHref ? (
                                                  <a title="واتساب" href={waHref} target="_blank" rel="noreferrer" onClick={e => { e.stopPropagation(); contactTarget('whatsapp'); }}
                                                    className="h-7 w-7 shrink-0 rounded border border-gray-200 bg-white text-gray-900 hover:bg-gray-900 hover:text-white flex items-center justify-center transition"><WhatsAppIcon size={13} /></a>
                                                ) : (
                                                  <span title="العميل من غير رقم" className="h-7 w-7 shrink-0 rounded bg-gray-50 text-gray-300 flex items-center justify-center"><WhatsAppIcon size={13} /></span>
                                                )}
                                                <button title="نقل لروند أخرى" onClick={e => { e.stopPropagation(); setDaqqiTransferModal({ subscriberId: a.subscriberId, fromRoundId: round.id }); }} className={`${iconButton} hover:bg-amber-50 hover:text-amber-600`}><ArrowLeftRight size={12} /></button>
                                                <button title="مسح من الروند" onClick={e => { e.stopPropagation(); handleRemoveAttendeeFromRound(round.id, a.subscriberId); }} className={`${iconButton} text-red-400 hover:bg-red-50 hover:text-red-600`}><X size={12} /></button>
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
