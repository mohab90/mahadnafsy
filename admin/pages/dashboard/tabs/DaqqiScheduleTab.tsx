import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
 CalendarDays,
 X,
} from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import type {
  DaqqiDayOfWeek, DaqqiRound, DaqqiTimeSlot,
  PaymentHistoryEntry, PaymentItemType, CommunicationRecord,
  SubscriberItem,
  Bundle, Course,
} from '../../../types';
import { DaqqiScheduleHeader } from './daqqi/DaqqiScheduleHeader';
import { DaqqiCommunicationModal } from './daqqi/DaqqiCommunicationModal';
import { DaqqiRoundEditorModal } from './daqqi/DaqqiRoundEditorModal';
import {
  DaqqiNewClientModal,
  DaqqiNewClientReceiptModal,
  type DaqqiNewClientDraft,
  type DaqqiNewClientReceipt,
} from './daqqi/DaqqiNewClientModals';
import { useDaqqiPaymentState } from './daqqi/useDaqqiPaymentState';
import { useDaqqiViewFilters } from './daqqi/useDaqqiViewFilters';
import {
  DAQQI_DAYS_OF_WEEK,
  DAQQI_TIME_SLOT_COLORS,
  DAQQI_TIME_SLOTS,
} from './daqqi/daqqiScheduleConfig';
import {
  blankDaqqiDraft,
  calcCurrentLecture,
  enrolledLabels,
  getCurrentWeekKey,
  normalizeDaqqiBranchId,
  parseDaqqiBranchIds,
  parseDaqqiRooms,
  type DaqqiDraftType,
} from './daqqi/daqqiScheduleUtils';
import { branchMatchesFilter } from '../branchWorkspaceFilters';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import { mysqlAdmin } from '../../../lib/mysqlapi';

import { DaqqiNewRoundModal } from './daqqi/DaqqiNewRoundModal';
import { DaqqiAddClientsModal } from './daqqi/DaqqiAddClientsModal';
import { DaqqiRoundRow } from './daqqi/DaqqiRoundRow';
import { confirmDialog } from '../../../components/shared/confirmDialog';
const DaqqiPayModal = React.lazy(() => import('./daqqi/DaqqiPayModal').then(module => ({ default: module.DaqqiPayModal })));
const DaqqiPaymentReceiptModal = React.lazy(() => import('./daqqi/DaqqiPaymentReceiptModal').then(module => ({ default: module.DaqqiPaymentReceiptModal })));
const DaqqiPostponeRoundModal = React.lazy(() => import('./daqqi/DaqqiRoundActionModals').then(module => ({ default: module.DaqqiPostponeRoundModal })));
const DaqqiToskeenRoundModal = React.lazy(() => import('./daqqi/DaqqiRoundActionModals').then(module => ({ default: module.DaqqiToskeenRoundModal })));
const DaqqiTransferRoundModal = React.lazy(() => import('./daqqi/DaqqiRoundActionModals').then(module => ({ default: module.DaqqiTransferRoundModal })));

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props {
  notify: NotifyFn;
  subscribersOverride?: SubscriberItem[];
  roundsOverride?: DaqqiRound[];
  hideCreateRound?: boolean;
  requirePaymentApproval?: boolean;  // true for reception_daqqi: payments go to pending
  onRoundUpdate?: (round: DaqqiRound) => boolean | void | Promise<boolean | void>;
  onRoundCreate?: (round: DaqqiRound) => boolean | void | Promise<boolean | void>;
  createRoundRef?: React.MutableRefObject<(() => void) | null>;
  branchFilter?: string;
}
const DaqqiScheduleTab: React.FC<Props> = ({ notify, subscribersOverride, roundsOverride, hideCreateRound, requirePaymentApproval, onRoundUpdate, onRoundCreate, createRoundRef, branchFilter }) => {
  const navigate = useNavigate();
  const {
    courses, bundles, therapists, staffMembers, subscribers: ctxSubscribers, updateSubscriber, addSubscriber, recordSubscriberPayment,
    daqqiRounds: ctxRounds, addDaqqiRound: ctxAddDaqqiRound, updateDaqqiRound: ctxUpdateDaqqiRound,
    deleteDaqqiRound, transferDaqqiAttendee, bulkSetDaqqiRounds, content, authUser, isAdmin,
  } = useSiteData();

  // Track IDs of subscribers that this staff member is allowed to see.
  // When subscribersOverride is given, we use those IDs as the filter against ctxSubscribers
  // so that any updates (updateSubscriber/addSubscriber) are immediately reflected in the view.
  const [locallyAddedSubIds, setLocallyAddedSubIds] = useState<Set<string>>(new Set());
  const subscribers = React.useMemo(() => {
    if (!subscribersOverride) return ctxSubscribers;
    const ctxMap = new Map(ctxSubscribers.map(s => [s.id, s]));
    const overrideIds = new Set(subscribersOverride.map(s => s.id));
    const allVisibleIds = new Set([...overrideIds, ...locallyAddedSubIds]);
    return [...allVisibleIds]
      .map(id => ctxMap.get(id) ?? subscribersOverride.find(s => s.id === id))
      .filter(Boolean) as SubscriberItem[];
  }, [subscribersOverride, ctxSubscribers, locallyAddedSubIds]);

  const sourceDaqqiRounds = roundsOverride ?? ctxRounds;
  const [attendanceCounts, setAttendanceCounts] = useState<Record<string, number>>({});
  const daqqiRounds = React.useMemo(
    () => sourceDaqqiRounds.map(round => ({
      ...round,
      attendees: round.attendees.map(attendee => {
        const count = attendanceCounts[`${round.id}:${attendee.subscriberId}`];
        return count === undefined ? attendee : { ...attendee, attendedLectures: count };
      }),
    })),
    [sourceDaqqiRounds, attendanceCounts],
  );
  const doUpdateRound = async (round: DaqqiRound) =>
    onRoundUpdate ? (await onRoundUpdate(round)) !== false : ctxUpdateDaqqiRound(round);
  const doAddRound = async (round: DaqqiRound) =>
    onRoundCreate ? (await onRoundCreate(round)) !== false : ctxAddDaqqiRound(round);

  const [daqqiDraft, setDaqqiDraft] = useState<DaqqiDraftType>(blankDaqqiDraft());
  const [daqqiStep, setDaqqiStep] = useState<'form' | 'attendees'>('form');
  const [daqqiPendingRound, setDaqqiPendingRound] = useState<DaqqiRound | null>(null);
  const [daqqiSelectedAttendees, setDaqqiSelectedAttendees] = useState<Set<string>>(new Set());
  const [daqqiExpandedId, setDaqqiExpandedId] = useState<string>('');
  const [daqqiFormOpen, setDaqqiFormOpen] = useState(false);
  // Expose create-round trigger to parent via ref
  React.useEffect(() => {
    if (createRoundRef) {
      createRoundRef.current = () => { setDaqqiFormOpen(true); setDaqqiStep('form'); setDaqqiDraft(blankDaqqiDraft()); setDaqqiPendingRound(null); };
    }
    return () => { if (createRoundRef) createRoundRef.current = null; };
  });
  const [daqqiShowAllClients, setDaqqiShowAllClients] = useState(false);
  const [daqqiAddClientsRoundId, setDaqqiAddClientsRoundId] = useState<string>('');
  const [daqqiAddClientsSel, setDaqqiAddClientsSel] = useState<Set<string>>(new Set());
  const [daqqiAddClientsCourseSel, setDaqqiAddClientsCourseSel] = useState<Record<string, string>>({});
  const [daqqiEditRoundId, setDaqqiEditRoundId] = useState<string>('');
  const [daqqiEditDraft, setDaqqiEditDraft] = useState<DaqqiDraftType>(blankDaqqiDraft());
  const {
    daqqiView,
    setDaqqiView,
    daqqiFilterCourse,
    setDaqqiFilterCourse,
    daqqiFilterInstructor,
    setDaqqiFilterInstructor,
    daqqiFilterDay,
    setDaqqiFilterDay,
    daqqiFilterTimeSlot,
    setDaqqiFilterTimeSlot,
    daqqiFilterStatus,
    setDaqqiFilterStatus,
    daqqiFilterReception,
    setDaqqiFilterReception,
    hasDaqqiFilters,
    clearDaqqiFilters,
  } = useDaqqiViewFilters();
  const {
    daqqiPayModal,
    setDaqqiPayModal,
    daqqiPayDraft,
    setDaqqiPayDraft,
    resetDaqqiPayDraft,
    daqqiPayPrintData,
    setDaqqiPayPrintData,
  } = useDaqqiPaymentState();
  const [daqqiTransferModal, setDaqqiTransferModal] = useState<{ subscriberId: string; fromRoundId: string } | null>(null);
  const [daqqiPostponeModal, setDaqqiPostponeModal] = useState<{ roundId: string; newDate: string } | null>(null);
  const [daqqiToskeenSubId, setDaqqiToskeenSubId] = useState<string | null>(null);
  const [daqqiCommModal, setDaqqiCommModal] = useState<{ subscriberId: string; subscriberName: string; phone: string } | null>(null);
  const [daqqiAddClientModal, setDaqqiAddClientModal] = useState(false);
  const [daqqiNewClientPrintReceipt, setDaqqiNewClientPrintReceipt] = useState<DaqqiNewClientReceipt | null>(null);

  const daqqiBranchIds = parseDaqqiBranchIds(content);
  const daqqiSubs = subscribers.filter(s => {
    const rawBranch = s.branch || '';
    if (branchFilter) return branchMatchesFilter(rawBranch, branchFilter);
    return normalizeDaqqiBranchId(rawBranch) === 'DAQQI' || daqqiBranchIds.has(rawBranch);
  });

  const daqqiRooms = parseDaqqiRooms(content);

  const instructorOptions = therapists;
  const receptionOptions = staffMembers.filter(s =>
    s.role === 'reception_daqqi' && s.status === 'active'
  );
  const daysOfWeek = DAQQI_DAYS_OF_WEEK;
  const timeSlotsList = DAQQI_TIME_SLOTS;
  const timeSlotColors = DAQQI_TIME_SLOT_COLORS;
  const assignedSubIds = new Set(daqqiRounds.flatMap(r => r.attendees.map(a => a.subscriberId)));

  const handleInitCreateRound = () => {
    if (!daqqiDraft.courseId || !daqqiDraft.instructorId || !daqqiDraft.receptionId || !daqqiDraft.startDate) {
      notify('error', 'الرجاء تعبئة جميع الحقول المطلوبة.');
      return;
    }
    const instructor = therapists.find(t => t.id === daqqiDraft.instructorId);
    const reception = staffMembers.find(s => s.id === daqqiDraft.receptionId);
    const room = daqqiRooms.find(r => r.name === daqqiDraft.roomId);
    const newRound: DaqqiRound = {
      id: `daqqi-${Date.now()}`, code: '', // Server assigns code from DB to avoid UNIQUE KEY conflict
      courseId: daqqiDraft.courseId, instructorId: daqqiDraft.instructorId,
      instructorName: instructor?.name || '', receptionId: daqqiDraft.receptionId,
      receptionName: reception?.name || '', dayOfWeek: daqqiDraft.dayOfWeek,
      startDate: daqqiDraft.startDate, timeSlot: daqqiDraft.timeSlot,
      room: daqqiDraft.roomId.trim() || undefined,
      roomId: daqqiDraft.roomId.trim() || undefined, roomName: room?.name || daqqiDraft.roomId.trim() || undefined,
      status: 'new', attendees: [],
      createdAt: new Date().toISOString(),
    };
    setDaqqiPendingRound(newRound);
    setDaqqiSelectedAttendees(new Set());
    setDaqqiShowAllClients(false);
    setDaqqiStep('attendees');
  };

  const handleSaveNewRound = async () => {
    if (!daqqiPendingRound) return;
    const selSubs = daqqiSubs.filter(s => daqqiSelectedAttendees.has(s.id));
    const attendees = selSubs.map(s => {
      // A refunded payment keeps its row and its positive amount, and a pending
      // one is a receipt nobody has approved yet. Counting either as collected
      // told reception «متبقي 0» for a client who has paid nothing. Same
      // predicate as useOverviewDerived, ClientDbTab and FinancialTab.
      const paid = (s.paymentHistory || []).reduce((sum, p) => (
        p.currency === 'EGP' && (!p.status || p.status === 'paid') ? sum + Number(p.amount) : sum
      ), 0);
      return { subscriberId: s.id, name: s.name, phone: s.phone, bookedAt: s.createdAt, amountPaid: paid };
    });
    const round = { ...daqqiPendingRound, attendees };
    try {
      if (!await doAddRound(round)) throw new Error('Server rejected round');
      setDaqqiFormOpen(false); setDaqqiStep('form'); setDaqqiPendingRound(null);
      setDaqqiSelectedAttendees(new Set()); setDaqqiDraft(blankDaqqiDraft());
      notify('success', 'تم إنشاء الروند بنجاح.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notify('error', `فشل حفظ الروند: ${msg}`);
    }
  };

  const handleAddClientsToRound = async () => {
    const round = daqqiRounds.find(r => r.id === daqqiAddClientsRoundId);
    if (!round) return;
    const newSubs = subscribers.filter(
      s => daqqiBranchIds.has(s.branch || '') && daqqiAddClientsSel.has(s.id) && !round.attendees.find(a => a.subscriberId === s.id)
    );
    const newAttendees = [
      ...round.attendees,
      ...newSubs.map(s => {
        const chosenCourseId = daqqiAddClientsCourseSel[s.id] || round.courseId;
        const paid = (s.paymentHistory || [])
          .filter(p => p.currency === 'EGP' && (!p.status || p.status === 'paid') && (!p.courseId || p.courseId === chosenCourseId))
          .reduce((sum, p) => sum + Number(p.amount), 0);
        return { subscriberId: s.id, name: s.name, phone: s.phone, bookedAt: s.createdAt || new Date().toISOString().slice(0,10), amountPaid: paid };
      }),
    ];
    if (!await doUpdateRound({ ...round, attendees: newAttendees })) {
      notify('error', 'تعذر إضافة العملاء إلى الروند.');
      return;
    }
    setDaqqiAddClientsRoundId('');
    setDaqqiAddClientsSel(new Set());
    setDaqqiAddClientsCourseSel({});
  };

  const handleSaveEditRound = async () => {
    const round = daqqiRounds.find(r => r.id === daqqiEditRoundId);
    if (!round) return;
    const instructor = therapists.find(t => t.id === daqqiEditDraft.instructorId);
    const reception = staffMembers.find(s => s.id === daqqiEditDraft.receptionId);
    const room = daqqiRooms.find(r => r.name === daqqiEditDraft.roomId);
    const saved = await doUpdateRound({
      ...round,
      courseId: daqqiEditDraft.courseId,
      instructorId: daqqiEditDraft.instructorId,
      instructorName: instructor?.name || '',
      receptionId: daqqiEditDraft.receptionId,
      receptionName: reception?.name || '',
      dayOfWeek: daqqiEditDraft.dayOfWeek,
      startDate: daqqiEditDraft.startDate,
      timeSlot: daqqiEditDraft.timeSlot,
      // Empty string, not undefined, so clearing the hall actually clears it —
      // the API reads '' as "no room", while a dropped key would leave the old
      // one in place and the round would keep holding a hall nobody chose.
      room: daqqiEditDraft.roomId.trim(),
      roomId: daqqiEditDraft.roomId.trim() || undefined,
      roomName: room?.name || daqqiEditDraft.roomId.trim() || undefined,
    });
    if (saved) {
      setDaqqiEditRoundId('');
      notify('success', 'تم تحديث الروند بنجاح.');
    } else {
      notify('error', 'تعذر تحديث الروند.');
    }
  };

  // One row, through its own route. This used to send the whole round back
  // with the client filtered out, which put a roster change through the
  // round's own validation — so a round saved before start_date was required
  // refused to let anyone be removed from it.
  const handleRemoveAttendeeFromRound = async (roundId: string, subscriberId: string) => {
    try {
      await mysqlAdmin.removeDaqqiAttendee(roundId, subscriberId);
      bulkSetDaqqiRounds(daqqiRounds.map(r => (r.id === roundId
        ? { ...r, attendees: r.attendees.filter(a => a.subscriberId !== subscriberId) }
        : r)));
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر حذف العميل من الروند.');
    }
  };

  const handleDaqqiPay = async (shouldPrint = false) => {
    if (!daqqiPayModal) return;
    const amount = Number(daqqiPayDraft.amount);
    if (!amount || amount <= 0) return;
    const sub = subscribers.find(s => s.id === daqqiPayModal.subscriberId);
    if (!sub) return;
    const courses_ref = (window as Window & { __courses?: Course[] }).__courses || [];
    const bundles_ref = (window as Window & { __bundles?: Bundle[] }).__bundles || [];
    const _sysPx = (() => {
      const cid = daqqiPayDraft.courseId;
      if (!cid) return 0;
      if (cid.startsWith('bundle:')) {
        const b = bundles_ref.find((bx: any) => bx.id === cid.replace('bundle:', ''));
        return (b?.price as unknown as Record<string,number>)?.[daqqiPayDraft.currency] || (b?.price as unknown as Record<string,number>)?.EGP || 0;
      }
      const c = courses_ref.find((cx: any) => cx.id === cid);
      return (c?.price as unknown as Record<string,number>)?.[daqqiPayDraft.currency] || (c?.price as unknown as Record<string,number>)?.EGP || 0;
    })();
    const _customExp = Number(daqqiPayDraft.customExpected) || 0;
    const _discPct = Number(daqqiPayDraft.discountPct) || 0;
    const _courseExpected = _customExp > 0 ? _customExp : (_discPct > 0 && _sysPx > 0 ? Math.round(_sysPx * (1 - _discPct / 100)) : _sysPx);
    const _discNote = _discPct > 0 ? `خصم ${_discPct}%` : (_customExp > 0 && _sysPx > 0 ? `سعر نهائي: ${_customExp}` : '');
    const entries: PaymentHistoryEntry[] = [
      {
        id: `dq-pay-${Date.now()}`,
        amount,
        courseExpected: _courseExpected > 0 ? _courseExpected : amount,
        currency: daqqiPayDraft.currency,
        paymentType: daqqiPayDraft.paymentType,
        isInstallment: daqqiPayDraft.bookingType === 'installment',
        courseId: daqqiPayDraft.courseId || undefined,
        note: [daqqiPayDraft.note, daqqiPayDraft.transactionId, _discNote].filter(Boolean).join(' | ') || undefined,
        paymentMethod: daqqiPayDraft.paymentMethod || undefined,
        fromAccountNumber: daqqiPayDraft.fromAccountNumber || undefined,
        source: 'daqqi' as const,
        at: daqqiPayDraft.date,
        status: requirePaymentApproval ? 'pending' : 'paid',
      },
      ...(daqqiPayDraft.extraItems || []).filter(i => i.amount && Number(i.amount) > 0).map((i, ix) => ({
        id: `dq-pay-${Date.now()}-x${ix}`,
        amount: Number(i.amount),
        currency: daqqiPayDraft.currency,
        paymentType: i.type,
        isInstallment: false,
        note: [i.label, daqqiPayDraft.note].filter(Boolean).join(' | ') || undefined,
        paymentMethod: daqqiPayDraft.paymentMethod || undefined,
        source: 'daqqi' as const,
        at: daqqiPayDraft.date,
        status: requirePaymentApproval ? 'pending' : ('paid' as 'paid'),
      } as PaymentHistoryEntry)),
    ];
    try {
      for (const entry of entries) {
        await recordSubscriberPayment(
          daqqiPayModal.subscriberId,
          entry as unknown as Record<string, unknown>,
        );
      }
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تسجيل الدفعة.');
      return;
    }
    if (daqqiPayModal.roundId && !requirePaymentApproval) {
      const r = daqqiRounds.find(r => r.id === daqqiPayModal.roundId);
      if (r && !await doUpdateRound({ ...r, attendees: r.attendees.map(a => a.subscriberId === daqqiPayModal.subscriberId ? { ...a, amountPaid: a.amountPaid + amount } : a) })) {
        notify('error', 'تم تسجيل الدفعة، لكن تعذر تحديث إجمالي العميل داخل الروند.');
      }
    }
    if (shouldPrint && !requirePaymentApproval) {
      const _extraTotalPrint = (daqqiPayDraft.extraItems || []).filter(i => i.amount && Number(i.amount) > 0).reduce((s, i) => s + Number(i.amount), 0);
      const _courseNamePrint = (() => {
        const cid = daqqiPayDraft.courseId;
        if (!cid) return daqqiPayDraft.paymentType;
        if (cid.startsWith('bundle:')) {
          const bid = cid.replace('bundle:', '');
          const b = bundles.find(bx => bx.id === bid) || (bundles_ref.find((bx: Bundle) => bx.id === bid));
          return b?.title || cid;
        }
        const c = courses.find(cx => cx.id === cid) || (courses_ref.find((cx: Course) => cx.id === cid));
        return (c as Course | undefined)?.titleAr || (c as Course | undefined)?.title || cid;
      })();
      // Compute paid before this payment (for remaining calculation)
      const _prevPaid = (sub.paymentHistory || [])
        .filter(p => p.currency === daqqiPayDraft.currency && (!p.status || p.status === 'paid') && (!p.courseId || p.courseId === daqqiPayDraft.courseId))
        .reduce((s, p) => s + Number(p.amount), 0);
      const _newTotal = _prevPaid + amount + _extraTotalPrint;
      const _remaining = Math.max(0, _courseExpected - _newTotal);
      const _staffNamePrint = authUser?.displayName || authUser?.email?.split('@')[0] || 'الاستقبال';
      setDaqqiPayPrintData({
        subName: daqqiPayModal.subscriberName,
        phone: sub?.phone || '',
        courseName: _courseNamePrint,
        items: [
          { label: _courseNamePrint, amount, currency: daqqiPayDraft.currency },
          ...(daqqiPayDraft.extraItems || []).filter(i => i.amount && Number(i.amount) > 0).map(i => ({ label: i.label || i.type, amount: Number(i.amount), currency: daqqiPayDraft.currency })),
        ],
        total: amount + _extraTotalPrint,
        currency: daqqiPayDraft.currency,
        method: daqqiPayDraft.paymentMethod,
        date: daqqiPayDraft.date,
        note: daqqiPayDraft.note || undefined,
        bookingType: daqqiPayDraft.bookingType,
        courseExpected: _courseExpected,
        prevPaid: _prevPaid,
        remaining: _remaining,
        staffName: _staffNamePrint,
        transactionId: daqqiPayDraft.transactionId || undefined,
      });
    }
    setDaqqiPayModal(null);
    resetDaqqiPayDraft();
    notify(requirePaymentApproval ? 'info' : 'success',
      requirePaymentApproval ? 'تم إرسال الدفعة للمراجعة ✓ — بانتظار موافقة المدير' : 'تم تسجيل الدفعة بنجاح.'
    );
  };

  const handleDaqqiPostponeStartDate = async () => {
    if (!daqqiPostponeModal?.newDate) return;
    const round = daqqiRounds.find(r => r.id === daqqiPostponeModal.roundId);
    if (!round) return;
    if (!await doUpdateRound({ ...round, startDate: daqqiPostponeModal.newDate })) {
      notify('error', 'تعذر تعديل تاريخ بداية الروند.');
      return;
    }
    setDaqqiPostponeModal(null);
    notify('success', 'تم تعديل تاريخ بداية الروند.');
  };

  const handleDaqqiToskeen = async (daqqiToskeenTargetRoundId: string) => {
    if (!daqqiToskeenSubId || !daqqiToskeenTargetRoundId) { notify('error', 'اختر العميل والروند أولاً.'); return; }
    const sub = subscribers.find(s => s.id === daqqiToskeenSubId);
    const round = daqqiRounds.find(r => r.id === daqqiToskeenTargetRoundId);
    if (!sub || !round) { notify('error', 'تعذر العثور على العميل أو الروند.'); return; }
    // Previously a silent no-op — clicking "تسكين" on someone already in the round did
    // nothing with zero feedback, which read as the button being broken.
    if (round.attendees.find(a => a.subscriberId === daqqiToskeenSubId)) {
      notify('info', `${sub.name} مُسكَّن بالفعل في روند ${round.code}.`);
      return;
    }
    // A subscriber already housed in a DIFFERENT active/new round for this same course
    // getting silently double-booked into a second one was the other half of "تسكين
    // بيعمل مشاكل" — warn instead of allowing a silent double-placement.
    const otherRound = daqqiRounds.find(r =>
      r.id !== round.id && r.courseId === round.courseId && r.status !== 'finished' &&
      r.attendees.some(a => a.subscriberId === daqqiToskeenSubId)
    );
    if (otherRound && !await confirmDialog(`${sub.name} مُسكَّن بالفعل في روند ${otherRound.code} لنفس الكورس. تسكينه في روند إضافي (${round.code})؟`)) {
      return;
    }
    const paid = (sub.paymentHistory || []).reduce((sum, p) => (
      p.currency === 'EGP' && (!p.status || p.status === 'paid') ? sum + Number(p.amount) : sum
    ), 0);
    const newAttendee = { subscriberId: sub.id, name: sub.name, phone: sub.phone, bookedAt: new Date().toISOString().slice(0, 10), amountPaid: paid };
    if (!await doUpdateRound({ ...round, attendees: [...round.attendees, newAttendee] })) {
      notify('error', 'تعذر تسكين العميل في الروند.');
      return;
    }
    setDaqqiToskeenSubId(null);
    notify('success', 'تم تسكين العميل في الروند بنجاح.');
  };

  const handleDaqqiTransfer = async (daqqiTransferTargetId: string) => {
    if (!daqqiTransferModal || !daqqiTransferTargetId) return;
    const fromRound = daqqiRounds.find(r => r.id === daqqiTransferModal.fromRoundId);
    const toRound = daqqiRounds.find(r => r.id === daqqiTransferTargetId);
    if (!fromRound || !toRound) return;
    if (!fromRound.attendees.some(a => a.subscriberId === daqqiTransferModal.subscriberId)) return;
    if (!await transferDaqqiAttendee(
      daqqiTransferModal.subscriberId,
      daqqiTransferModal.fromRoundId,
      daqqiTransferTargetId,
    )) {
      notify('error', 'تعذر نقل العميل؛ لم يتم تغيير أي روند.');
      return;
    }
    setDaqqiTransferModal(null);
    notify('success', 'تم نقل العميل بنجاح.');
  };

  const handleDaqqiMarkAttendance = async (roundId: string, subscriberId: string) => {
    const round = daqqiRounds.find(r => r.id === roundId);
    if (!round) return;
    try {
      const response = await fetch(`/api/admin/daqqi-rounds/${encodeURIComponent(roundId)}/attendance`, {
        method: 'POST',
        credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ subscriberId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'تعذر تسجيل الحضور.');
      setAttendanceCounts(previous => ({
        ...previous,
        [`${roundId}:${subscriberId}`]: Number(result.attendedLectures),
      }));
      notify('success', 'تم تسجيل الحضور وحفظه في سجل الجلسة.');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تسجيل الحضور.');
    }
  };

  const handleDaqqiTogglePostpone = async (roundId: string) => {
    const round = daqqiRounds.find(r => r.id === roundId);
    if (!round) return;
    const thisWeek = getCurrentWeekKey();
    const existing = round.postponedWeeks || [];
    const updatedWeeks = existing.includes(thisWeek)
      ? existing.filter(w => w !== thisWeek)
      : [...existing, thisWeek];
    if (!await doUpdateRound({ ...round, postponedWeeks: updatedWeeks })) {
      notify('error', 'تعذر تحديث تأجيل الأسبوع.');
    }
  };

  const handleDaqqiAddComm = async (type: CommunicationRecord['type'], note: string) => {
    if (!daqqiCommModal || !note.trim()) return;
    const sub = subscribers.find(s => s.id === daqqiCommModal.subscriberId);
    if (!sub) return;
    const rec: CommunicationRecord = {
      id: `dq-comm-${Date.now()}`, type,
      date: new Date().toISOString().slice(0, 10), notes: note.trim(),
    };
    const saved = await updateSubscriber({ ...sub, communications: [...(sub.communications ?? []), rec] });
    if (!saved) {
      notify('error', 'فشل تسجيل التواصل. لم يتم اعتماد التغيير.');
      return;
    }
    notify('success', 'تم تسجيل التواصل بنجاح.');
  };

  const handleDaqqiAddNewClient = async (draft: DaqqiNewClientDraft) => {
    if (!draft.name.trim() || !draft.phone.trim()) {
      notify('error', 'الاسم والهاتف مطلوبان.');
      return;
    }
    const amount = Number(draft.amount);
    const courseIds = draft.courseIds;
    const courseAccessMap: Record<string, { mode: 'full' }> = {};
    courseIds.forEach(cid => { courseAccessMap[cid] = { mode: 'full' }; });
    const newSub: any = {
      id: `daqqi-client-${Date.now()}`,
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      branch: 'daqqi',
      status: 'active' as const,
      enrolledCourseIds: courseIds,
      paymentHistory: [],
      courseAccess: courseAccessMap,
      createdAt: new Date().toISOString().slice(0, 10),
      clientCode: '',
    };
    if (amount > 0) {
      const entry: PaymentHistoryEntry = {
        id: `dq-pay-${Date.now()}`,
        amount,
        currency: draft.currency,
        paymentType: draft.paymentType,
        isInstallment: draft.bookingType === 'installment',
        courseId: draft.paymentType === 'course' ? (courseIds[0] || '') : '',
        note: [draft.note, draft.transactionId].filter(Boolean).join(' | ') || undefined,
        paymentMethod: draft.paymentMethod || undefined,
        at: draft.date,
      };
      newSub.paymentHistory = [entry];
    }
    let ok = false;
    try {
      ok = await addSubscriber(newSub);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notify('error', `فشل إضافة العميل: ${msg}`);
      return;
    }
    if (!ok) {
      notify('error', 'العميل موجود بالفعل (هاتف أو إيميل مكرر).');
      return;
    }
    // Track the new subscriber's ID so it appears immediately in the filtered view
    if (subscribersOverride) {
      setLocallyAddedSubIds(prev => { const n = new Set(prev); n.add(newSub.id); return n; });
    }
    notify('success', 'تم إضافة العميل بنجاح.');
    // Show print receipt if payment was made
    if (Number(draft.amount) > 0) {
      const courseLabels = draft.courseIds.map(cid => {
        if (cid.startsWith('bundle:')) {
          const b = bundles.find(bx => bx.id === cid.replace('bundle:', ''));
          return b?.title || cid;
        }
        const c = courses.find(cx => cx.id === cid);
        return c?.titleAr || c?.title || cid;
      });
      setDaqqiNewClientPrintReceipt({
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        courses: courseLabels,
        amount: Number(draft.amount),
        currency: draft.currency,
        method: draft.paymentMethod || '—',
        bookingType: draft.bookingType,
        date: draft.date,
      });
    }
    setDaqqiAddClientModal(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex flex-col gap-5">
      {/* Header */}
      <DaqqiScheduleHeader
        view={daqqiView}
        setView={setDaqqiView}
        hideCreateRound={hideCreateRound}
        onCreateRound={() => {
          setDaqqiFormOpen(true);
          setDaqqiStep('form');
          setDaqqiDraft(blankDaqqiDraft());
          setDaqqiPendingRound(null);
        }}
        onAddClient={() => {
          setDaqqiAddClientModal(true);
        }}
      />



      {/* The clients table that sat here was removed by request — this page is
          the schedule. Adding a client moved to the header. */}
      {/* Empty or main view */}
      {daqqiRounds.length === 0 ? (
        <div className="border border-dashed border-gray-300 rounded-xl p-12 text-center text-gray-400">
          <CalendarDays size={32} className="mx-auto mb-2 opacity-30" />
          <p>لا توجد رواندات بعد. ابدأ بإنشاء روند جديدة.</p>
        </div>
      ) : daqqiView === 'table' ? (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
            <select value={daqqiFilterCourse} onChange={e => setDaqqiFilterCourse(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[130px]">
              <option value="">كل الكورسات</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.titleAr || c.title}</option>)}
            </select>
            <select value={daqqiFilterInstructor} onChange={e => setDaqqiFilterInstructor(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[130px]">
              <option value="">كل الدكاترة</option>
              {instructorOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={daqqiFilterDay} onChange={e => setDaqqiFilterDay(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[110px]">
              <option value="">كل الأيام</option>
              {daysOfWeek.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={daqqiFilterTimeSlot} onChange={e => setDaqqiFilterTimeSlot(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[110px]">
              <option value="">كل المواعيد</option>
              <option value="صباحاً">صباحاً</option>
              <option value="ظهراً">ظهراً</option>
              <option value="مساءً">مساءً</option>
            </select>
            <select value={daqqiFilterStatus} onChange={e => setDaqqiFilterStatus(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[100px]">
              <option value="">كل الحالات</option>
              <option value="new">جديد</option>
              <option value="active">شغال</option>
              <option value="finished">منتهي</option>
            </select>
            <select value={daqqiFilterReception} onChange={e => setDaqqiFilterReception(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[130px]">
              <option value="">كل الريسبشن</option>
              {receptionOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {hasDaqqiFilters && (
              <button onClick={clearDaqqiFilters} className="px-2 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 text-xs font-bold flex items-center gap-1">
                <X size={11} />مسح الفلاتر
              </button>
            )}
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm min-w-[1050px]">
              <thead>
                <tr className="bg-gray-50 text-gray-700 text-xs">
                  <th className="text-right px-3 py-2.5 border-b border-gray-200 font-semibold">الكود</th>
                  <th className="text-right px-3 py-2.5 border-b border-gray-200 font-semibold">الكورس</th>
                  <th className="text-right px-3 py-2.5 border-b border-gray-200 font-semibold">اليوم / التاريخ</th>
                  <th className="text-right px-3 py-2.5 border-b border-gray-200 font-semibold">الموعد</th>
                  <th className="text-right px-3 py-2.5 border-b border-gray-200 font-semibold">المحاضر</th>
                  <th className="text-right px-3 py-2.5 border-b border-gray-200 font-semibold">الريسبشن</th>
                  <th className="text-right px-3 py-2.5 border-b border-gray-200 font-semibold">القاعة</th>
                  <th className="text-right px-3 py-2.5 border-b border-gray-200 font-semibold">الحالة</th>
                  <th className="text-right px-3 py-2.5 border-b border-gray-200 font-semibold">المحاضرة</th>
                  <th className="text-right px-3 py-2.5 border-b border-gray-200 font-semibold">محصّل / متبقي</th>
                  <th className="text-right px-3 py-2.5 border-b border-gray-200 font-semibold">الحاضرين</th>
                  <th className="text-right px-3 py-2.5 border-b border-gray-200 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {[...daqqiRounds]
                  .sort((a, b) => a.startDate.localeCompare(b.startDate))
                  .filter(r =>
                    (!daqqiFilterCourse || r.courseId === daqqiFilterCourse) &&
                    (!daqqiFilterInstructor || r.instructorId === daqqiFilterInstructor) &&
                    (!daqqiFilterDay || r.dayOfWeek === daqqiFilterDay) &&
                    (!daqqiFilterTimeSlot || r.timeSlot === daqqiFilterTimeSlot) &&
                    (!daqqiFilterStatus || (r.status || 'new') === daqqiFilterStatus) &&
                    (!daqqiFilterReception || r.receptionId === daqqiFilterReception)
                  )
                  .map(round => {
                    return (
                      <DaqqiRoundRow
                        key={round.id}
                        round={round}
                        isAdmin={isAdmin}
                        resetDaqqiPayDraft={resetDaqqiPayDraft}
                        setDaqqiCommModal={setDaqqiCommModal}
                        setDaqqiToskeenSubId={setDaqqiToskeenSubId}
                        deleteDaqqiRound={deleteDaqqiRound}
                        attendanceCounts={attendanceCounts}
                        navigate={navigate}
                        courses={courses}
                        subscribers={subscribers}
                        bundles={bundles}
                        daqqiRounds={daqqiRounds}
                        daqqiExpandedId={daqqiExpandedId}
                        setDaqqiExpandedId={setDaqqiExpandedId}
                        setDaqqiEditRoundId={setDaqqiEditRoundId}
                        setDaqqiEditDraft={setDaqqiEditDraft}
                        setDaqqiAddClientsRoundId={setDaqqiAddClientsRoundId}
                        setDaqqiAddClientsSel={setDaqqiAddClientsSel}
                        setDaqqiPayModal={setDaqqiPayModal}
                        setDaqqiPostponeModal={setDaqqiPostponeModal}
                        setDaqqiTransferModal={setDaqqiTransferModal}
                        handleDaqqiMarkAttendance={handleDaqqiMarkAttendance}
                        handleDaqqiTogglePostpone={handleDaqqiTogglePostpone}
                        handleRemoveAttendeeFromRound={handleRemoveAttendeeFromRound}
                        doUpdateRound={doUpdateRound}
                        notify={notify}
                      />
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto pb-4">
          {(() => {
            const today = new Date();
            const dayOfWeek = today.getDay();
            const startOfWeek = new Date(today);
            startOfWeek.setDate(today.getDate() - dayOfWeek);
            const dayNamesAr: DaqqiDayOfWeek[] = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
            const monthNamesAr = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
            const todayStr = today.toISOString().slice(0, 10);
            const days = Array.from({ length: 14 }, (_, i) => {
              const d = new Date(startOfWeek);
              d.setDate(startOfWeek.getDate() + i);
              return { date: d, dayName: dayNamesAr[d.getDay()], dateStr: d.toISOString().slice(0, 10), monthName: monthNamesAr[d.getMonth()], dayNum: d.getDate() };
            });
            const renderWeek = (weekDays: typeof days, label: string) => (
              <div className="mb-5">
                <div className="text-xs font-bold text-gray-500 mb-2 px-1 flex items-center gap-2">
                  <span className="inline-block w-1 h-3.5 bg-primary-400 rounded-full" />
                  {label}
                </div>
                <div className="min-w-[980px] grid grid-cols-7 gap-2">
                  {weekDays.map(({ dayName, dateStr, monthName, dayNum }) => {
                    const dayRounds = [...daqqiRounds]
                      .filter(r => r.dayOfWeek === dayName)
                      .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot));
                    const isToday = dateStr === todayStr;
                    return (
                      <div key={dateStr} className={`rounded-xl border transition-all ${isToday ? 'border-primary-400 shadow-md' : dayRounds.length > 0 ? 'border-gray-200 bg-white shadow-sm' : 'border-dashed border-gray-100 bg-gray-50/30'}`}>
                        <div className={`px-2 py-2.5 border-b text-center rounded-t-xl ${isToday ? 'border-primary-200 bg-primary-100/50' : 'border-gray-100 bg-gradient-to-b from-gray-50 to-white'}`}>
                          <span className={`text-[11px] font-extrabold ${isToday ? 'text-primary-700' : 'text-gray-700'}`}>{dayName}</span>
                          <div className={`text-[11px] font-semibold mt-0.5 ${isToday ? 'text-primary-600' : 'text-gray-500'}`}>{dayNum} {monthName}</div>
                          {isToday && <div className="text-[9px] text-primary-500 font-bold bg-primary-50 rounded-full px-2 mt-0.5 inline-block">اليوم</div>}
                          {dayRounds.length > 0 && <span className="block text-[10px] text-primary-500 font-bold mt-0.5">{dayRounds.length} روند</span>}
                        </div>
                        <div className="p-1.5 space-y-2 min-h-[80px]">
                          {dayRounds.map(r => {
                            const c = courses.find(x => x.id === r.courseId);
                            const isActive = r.status === 'active';
                            const isNew = (r.status || 'new') === 'new';
                            const cardBg = isActive ? 'bg-green-50 border-green-200 hover:border-green-400' : isNew ? 'bg-blue-50 border-blue-200 hover:border-blue-400' : 'bg-gray-50 border-gray-200 hover:border-gray-300';
                            const dotColor = isActive ? 'bg-green-500' : isNew ? 'bg-blue-400' : 'bg-gray-400';
                            const headingColor = isActive ? 'text-green-800' : isNew ? 'text-blue-800' : 'text-gray-600';
                            const statusBadge = isActive
                              ? <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold">م {calcCurrentLecture(r.startDate, r.postponedWeeks)}</span>
                              : isNew
                                ? <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold">جديد</span>
                                : <span className="text-[9px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full font-bold">منتهي</span>;
                            return (
                              <div key={r.id} className={`rounded-lg border p-2 cursor-pointer hover:shadow-md transition-all ${cardBg}`}
                                onClick={() => { setDaqqiView('table'); setDaqqiExpandedId(r.id); }}>
                                <div className="flex items-center justify-between gap-1 mb-1">
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${timeSlotColors[r.timeSlot] || ''}`}>{r.timeSlot}</span>
                                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                                </div>
                                <p className={`text-[11px] font-bold leading-tight truncate ${headingColor}`}>{c?.titleAr || c?.title || '—'}</p>
                                {r.instructorName && <p className="text-[10px] text-gray-500 truncate mt-0.5">{r.instructorName}</p>}
                                {r.receptionName && <p className="text-[10px] text-gray-400 truncate">👤 {r.receptionName}</p>}
                                <div className="flex items-center justify-between mt-1.5 gap-1">
                                  {statusBadge}
                                  <span className="text-[10px] bg-white/80 text-gray-600 font-bold px-1.5 py-0.5 rounded-full border border-gray-200">{r.attendees.length} ✦</span>
                                </div>
                                <p className="text-[9px] text-gray-400 mt-1 font-mono">{r.startDate}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
            return (
              <div>
                {renderWeek(days.slice(0, 7), 'الأسبوع الحالي')}
                {renderWeek(days.slice(7, 14), 'الأسبوع القادم')}
              </div>
            );
          })()}
        </div>
      )}

      {/* New Round Modal */}
      {daqqiFormOpen && (
        <DaqqiNewRoundModal
          daqqiDraft={daqqiDraft}
          enrolledLabels={enrolledLabels}
          assignedSubIds={assignedSubIds}
          bundles={bundles}
          daqqiShowAllClients={daqqiShowAllClients}
          setDaqqiShowAllClients={setDaqqiShowAllClients}
          handleInitCreateRound={handleInitCreateRound}
          instructorOptions={instructorOptions}
          receptionOptions={receptionOptions}
          daqqiRooms={daqqiRooms}
          setDaqqiDraft={setDaqqiDraft}
          daqqiStep={daqqiStep}
          setDaqqiStep={setDaqqiStep}
          daqqiPendingRound={daqqiPendingRound}
          daqqiSelectedAttendees={daqqiSelectedAttendees}
          setDaqqiSelectedAttendees={setDaqqiSelectedAttendees}
          setDaqqiFormOpen={setDaqqiFormOpen}
          courses={courses}
          daqqiSubs={daqqiSubs}
          handleSaveNewRound={handleSaveNewRound}
        />
      )}

      {/* Add Clients Modal */}
      <DaqqiAddClientsModal
        daqqiAddClientsRoundId={daqqiAddClientsRoundId}
        enrolledLabels={enrolledLabels}
        setDaqqiAddClientsRoundId={setDaqqiAddClientsRoundId}
        daqqiRounds={daqqiRounds}
        courses={courses}
        bundles={bundles}
        daqqiSubs={daqqiSubs}
        daqqiAddClientsSel={daqqiAddClientsSel}
        setDaqqiAddClientsSel={setDaqqiAddClientsSel}
        daqqiAddClientsCourseSel={daqqiAddClientsCourseSel}
        setDaqqiAddClientsCourseSel={setDaqqiAddClientsCourseSel}
        daqqiShowAllClients={daqqiShowAllClients}
        setDaqqiShowAllClients={setDaqqiShowAllClients}
        handleAddClientsToRound={handleAddClientsToRound}
      />

      <DaqqiNewClientModal
        open={daqqiAddClientModal}
        content={content}
        courses={courses}
        bundles={bundles}
        onClose={() => setDaqqiAddClientModal(false)}
        onSubmit={handleDaqqiAddNewClient}
      />

      <DaqqiNewClientReceiptModal
        receipt={daqqiNewClientPrintReceipt}
        onClose={() => setDaqqiNewClientPrintReceipt(null)}
      />


      <DaqqiPaymentReceiptModal
        data={daqqiPayPrintData}
        content={content}
        onClose={() => setDaqqiPayPrintData(null)}
      />

      <DaqqiRoundEditorModal
        open={!!daqqiEditRoundId}
        roundCode={daqqiRounds.find((round) => round.id === daqqiEditRoundId)?.code}
        draft={daqqiEditDraft}
        setDraft={setDaqqiEditDraft}
        courses={courses}
        instructors={instructorOptions}
        receptionStaff={receptionOptions}
        rooms={daqqiRooms}
        daysOfWeek={daysOfWeek}
        timeSlots={timeSlotsList}
        onClose={() => setDaqqiEditRoundId('')}
        onSave={handleSaveEditRound}
      />

      {/* Pay Modal */}
      <DaqqiPayModal
        modal={daqqiPayModal}
        draft={daqqiPayDraft}
        setDraft={setDaqqiPayDraft}
        onClose={() => setDaqqiPayModal(null)}
        onSubmit={handleDaqqiPay}
        subscribers={subscribers}
        courses={courses}
        bundles={bundles}
        content={content}
        requirePaymentApproval={requirePaymentApproval}
      />

      <DaqqiTransferRoundModal
        modal={daqqiTransferModal}
        rounds={daqqiRounds}
        subscribers={subscribers}
        courses={courses}
        onClose={() => setDaqqiTransferModal(null)}
        onConfirm={handleDaqqiTransfer}
      />

      <DaqqiToskeenRoundModal
        subscriberId={daqqiToskeenSubId}
        rounds={daqqiRounds}
        subscribers={subscribers}
        courses={courses}
        onClose={() => setDaqqiToskeenSubId(null)}
        onConfirm={handleDaqqiToskeen}
      />

      <DaqqiPostponeRoundModal
        modal={daqqiPostponeModal}
        setModal={(next) => setDaqqiPostponeModal(next)}
        rounds={daqqiRounds}
        courses={courses}
        onClose={() => setDaqqiPostponeModal(null)}
        onConfirmStartDate={handleDaqqiPostponeStartDate}
        onUpdateRound={doUpdateRound}
        notify={notify}
      />
      <DaqqiCommunicationModal
        target={daqqiCommModal}
        onClose={() => setDaqqiCommModal(null)}
        onSubmit={handleDaqqiAddComm}
      />
    </article>
  );
};

export default DaqqiScheduleTab;
