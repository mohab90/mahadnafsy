import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight, CalendarDays, ChevronRight,
  CreditCard, Eye, List, MessageCircle, Pencil, Phone, Plus,
  Search, UserCheck, UserPlus, Users, X,
} from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import type {
  DaqqiDayOfWeek, DaqqiRound, DaqqiTimeSlot,
  PaymentHistoryEntry, CommunicationRecord, SubscriberItem,
  Bundle, Course,
} from '../../../types';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { DaqqiPayModal } from './daqqi/DaqqiPayModal';
import type { DaqqiPayDraft } from './daqqi/DaqqiPayModal';
import { DaqqiPayReceiptModal } from './daqqi/DaqqiPayReceiptModal';
import type { DaqqiPayPrintData } from './daqqi/DaqqiPayReceiptModal';
import { DaqqiAddClientModal } from './daqqi/DaqqiAddClientModal';
import { DaqqiEditRoundModal } from './daqqi/DaqqiEditRoundModal';
import type { DaqqiDraftType } from './daqqi/DaqqiEditRoundModal';
import { DaqqiTransferModal } from './daqqi/DaqqiTransferModal';
import { DaqqiToskeenModal } from './daqqi/DaqqiToskeenModal';
import { DaqqiPostponeModal } from './daqqi/DaqqiPostponeModal';
import { DaqqiCommModal } from './daqqi/DaqqiCommModal';
import { DaqqiClientsSection } from './daqqi/DaqqiClientsSection';

// ── Module-level helpers ────────────────────────────────────────────────────
const calcCurrentLecture = (startDate: string, postponedWeeks?: string[]): number => {
  if (!startDate) return 1;
  const start = new Date(startDate);
  const today = new Date();
  const daysDiff = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const weeksElapsed = Math.max(0, Math.floor(daysDiff / 7));
  return Math.max(1, weeksElapsed + 1 - (postponedWeeks?.length || 0));
};

const getCurrentWeekKey = (): string => {
  const d = new Date();
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return monday.toISOString().slice(0, 10);
};

const blankDaqqiDraft = (): DaqqiDraftType => ({
  courseId: '', instructorId: '', receptionId: '', roomId: '',
  dayOfWeek: 'الأحد' as DaqqiDayOfWeek,
  startDate: new Date().toISOString().slice(0, 10),
  timeSlot: 'مساءً' as DaqqiTimeSlot,
});

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  notify: NotifyFn;
  subscribersOverride?: SubscriberItem[];
  roundsOverride?: DaqqiRound[];
  hideCreateRound?: boolean;
  requirePaymentApproval?: boolean;  // true for reception_daqqi: payments go to pending
  onRoundUpdate?: (round: DaqqiRound) => void;
  onRoundCreate?: (round: DaqqiRound) => void;
  createRoundRef?: React.MutableRefObject<(() => void) | null>;
}

const DaqqiScheduleTab: React.FC<Props> = ({ notify, subscribersOverride, roundsOverride, hideCreateRound, requirePaymentApproval, onRoundUpdate, onRoundCreate, createRoundRef }) => {
  const navigate = useNavigate();
  const {
    courses, bundles, therapists, staffMembers, subscribers: ctxSubscribers, updateSubscriber, addSubscriber,
    daqqiRounds: ctxRounds, addDaqqiRound: ctxAddDaqqiRound, updateDaqqiRound: ctxUpdateDaqqiRound, deleteDaqqiRound, content, authUser,
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

  const daqqiRounds = roundsOverride ?? ctxRounds;
  const doUpdateRound = (round: DaqqiRound) => onRoundUpdate ? onRoundUpdate(round) : ctxUpdateDaqqiRound(round);
  const doAddRound = (round: DaqqiRound): Promise<void> =>
    onRoundCreate ? (onRoundCreate(round), Promise.resolve()) : ctxAddDaqqiRound(round);

  // ── State ──────────────────────────────────────────────────────────────────
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
  const [daqqiView, setDaqqiView] = useState<'table' | 'calendar'>('table');
  const [daqqiFilterCourse, setDaqqiFilterCourse] = useState('');
  const [daqqiFilterInstructor, setDaqqiFilterInstructor] = useState('');
  const [daqqiFilterDay, setDaqqiFilterDay] = useState('');
  const [daqqiFilterTimeSlot, setDaqqiFilterTimeSlot] = useState('');
  const [daqqiFilterStatus, setDaqqiFilterStatus] = useState('');
  const [daqqiFilterReception, setDaqqiFilterReception] = useState('');
  const [daqqiPayModal, setDaqqiPayModal] = useState<{ subscriberId: string; subscriberName: string; roundId?: string; attendeeAmountPaid?: number } | null>(null);
  const [daqqiPayDraft, setDaqqiPayDraft] = useState<DaqqiPayDraft>({
    bookingType: 'new_booking',
    paymentType: 'course',
    courseId: '', courseExpected: '', bookingDiscount: '',
    customExpected: '', discountPct: '',
    certType: '', certReqId: '',
    amount: '', currency: 'EGP',
    paymentMethod: '', transactionId: '', fromAccountNumber: '',
    date: new Date().toISOString().slice(0, 10), note: '',
    extraItems: [],
  });
  const [daqqiTransferModal, setDaqqiTransferModal] = useState<{ subscriberId: string; fromRoundId: string } | null>(null);
  const [daqqiTransferTargetId, setDaqqiTransferTargetId] = useState('');
  const [daqqiPostponeModal, setDaqqiPostponeModal] = useState<{ roundId: string; newDate: string } | null>(null);
  const [daqqiToskeenSubId, setDaqqiToskeenSubId] = useState<string | null>(null);
  const [daqqiToskeenTargetRoundId, setDaqqiToskeenTargetRoundId] = useState('');
  const [daqqiCommModal, setDaqqiCommModal] = useState<{ subscriberId: string; subscriberName: string; phone: string } | null>(null);
  const [daqqiAddClientModal, setDaqqiAddClientModal] = useState(false);
  const [daqqiPayPrintData, setDaqqiPayPrintData] = useState<DaqqiPayPrintData | null>(null);

  // ── Derived data ───────────────────────────────────────────────────────────
  // Resolve which branch IDs represent الدقي — matches 'daqqi' (any case/dash) and any admin-configured
  // branch whose label contains 'دق' (Arabic root for Doqqi), enabling flexible branch naming.
  const daqqiBranchIds = (() => {
    const norm = (v: string) => v.toUpperCase().replace(/[-\s]/g, '_');
    const ids = new Set<string>(['daqqi', 'DAQQI']);
    try {
      const raw = content['institute.branches'];
      if (raw) {
        const branches: { id: string; label: string }[] = JSON.parse(raw);
        branches.forEach(b => {
          if (norm(b.id) === 'DAQQI' || (b.label || '').includes('دق')) ids.add(b.id);
        });
      }
    } catch { /* ignore */ }
    return ids;
  })();
  const normBranchId = (v?: string | null) => String(v || '').toUpperCase().replace(/[-\s]/g, '_');
  const daqqiSubs = subscribers.filter(s => {
    const rawBranch = s.branch || '';
    return normBranchId(rawBranch) === 'DAQQI' || daqqiBranchIds.has(rawBranch);
  });

  // Training rooms: parsed from institute.branches for the Daqqi branch entry
  const daqqiRooms = (() => {
    try {
      const raw = content['institute.branches'];
      if (!raw) return [] as { name: string; capacity: number }[];
      const branches: { id: string; label: string; rooms?: { name: string; capacity: number }[] }[] = JSON.parse(raw);
      const norm = (v: string) => v.toUpperCase().replace(/[-\s]/g, '_');
      const daqBranch = branches.find(b => norm(b.id) === 'DAQQI' || (b.label || '').includes('دق'));
      return daqBranch?.rooms || [] as { name: string; capacity: number }[];
    } catch { return [] as { name: string; capacity: number }[]; }
  })();

  // Helper: check if a subscriber is enrolled in a specific course, directly OR via a bundle containing it
  const isEnrolledInCourse = (enrolledIds: string[], courseId: string): boolean => {
    if (enrolledIds.includes(courseId)) return true;
    return enrolledIds.some(eid => {
      if (!eid.startsWith('bundle:')) return false;
      const b = bundles.find(bx => bx.id === eid.replace('bundle:', ''));
      return b?.courses.some(c => c.id === courseId) ?? false;
    });
  };

  // Helper: get human-readable enrolled labels (includes bundle names)
  const enrolledLabels = (enrolledIds: string[]): string[] =>
    enrolledIds.map(cid => {
      if (cid.startsWith('bundle:')) {
        const b = bundles.find(bx => bx.id === cid.replace('bundle:', ''));
        return b ? `مسار: ${b.title}` : null;
      }
      const c = courses.find(cx => cx.id === cid);
      return c ? (c.titleAr || c.title) : null;
    }).filter(Boolean) as string[];

  // Helper: get bundle names that contain a given courseId
  const courseBundles = (courseId: string) =>
    bundles.filter(b => b.courses.some(c => c.id === courseId));

  const instructorOptions = therapists;
  const receptionOptions = staffMembers.filter(s =>
    s.role === 'reception_daqqi' && s.status === 'active'
  );
  const daysOfWeek: DaqqiDayOfWeek[] = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const timeSlotsList: DaqqiTimeSlot[] = ['صباحاً', 'ظهراً', 'مساءً'];
  const timeSlotColors: Record<string, string> = {
    'صباحاً': 'bg-amber-100 text-amber-700',
    'ظهراً': 'bg-blue-100 text-blue-700',
    'مساءً': 'bg-indigo-100 text-indigo-700',
  };
  const statusColorsMap: Record<string, string> = {
    new: 'bg-blue-100 text-blue-700',
    active: 'bg-green-100 text-green-700',
    finished: 'bg-gray-200 text-gray-600',
  };
  const assignedSubIds = new Set(daqqiRounds.flatMap(r => r.attendees.map(a => a.subscriberId)));
  const unassignedDaqqiSubs = daqqiSubs.filter(s => !assignedSubIds.has(s.id));

  // ── Handlers ───────────────────────────────────────────────────────────────
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
      roomId: daqqiDraft.roomId || undefined, roomName: room?.name || daqqiDraft.roomId || undefined,
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
      const paid = (s.paymentHistory || []).reduce((sum, p) => p.currency === 'EGP' ? sum + Number(p.amount) : sum, 0);
      return { subscriberId: s.id, name: s.name, phone: s.phone, bookedAt: s.createdAt, amountPaid: paid };
    });
    const round = { ...daqqiPendingRound, attendees };
    setDaqqiFormOpen(false); setDaqqiStep('form'); setDaqqiPendingRound(null);
    setDaqqiSelectedAttendees(new Set()); setDaqqiDraft(blankDaqqiDraft());
    try {
      await doAddRound(round);
      notify('success', 'تم إنشاء الروند بنجاح.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notify('error', `فشل حفظ الروند: ${msg}`);
    }
  };

  const handleAddClientsToRound = () => {
    const round = daqqiRounds.find(r => r.id === daqqiAddClientsRoundId);
    if (!round) return;
    const newSubs = subscribers.filter(
      s => daqqiBranchIds.has(s.branch || '') && daqqiAddClientsSel.has(s.id) && !round.attendees.find(a => a.subscriberId === s.id)
    );
    const newAttendees = [
      ...round.attendees,
      ...newSubs.map(s => {
        const chosenCourseId = daqqiAddClientsCourseSel[s.id] || round.courseId;
        const paid = (s.paymentHistory || []).filter(p => p.currency === 'EGP' && (!p.courseId || p.courseId === chosenCourseId)).reduce((sum, p) => sum + Number(p.amount), 0);
        return { subscriberId: s.id, name: s.name, phone: s.phone, bookedAt: s.createdAt || new Date().toISOString().slice(0,10), amountPaid: paid };
      }),
    ];
    doUpdateRound({ ...round, attendees: newAttendees });
    setDaqqiAddClientsRoundId('');
    setDaqqiAddClientsSel(new Set());
    setDaqqiAddClientsCourseSel({});
  };

  const handleSaveEditRound = () => {
    const round = daqqiRounds.find(r => r.id === daqqiEditRoundId);
    if (!round) return;
    const instructor = therapists.find(t => t.id === daqqiEditDraft.instructorId);
    const reception = staffMembers.find(s => s.id === daqqiEditDraft.receptionId);
    const room = daqqiRooms.find(r => r.name === daqqiEditDraft.roomId);
    doUpdateRound({
      ...round,
      courseId: daqqiEditDraft.courseId,
      instructorId: daqqiEditDraft.instructorId,
      instructorName: instructor?.name || '',
      receptionId: daqqiEditDraft.receptionId,
      receptionName: reception?.name || '',
      dayOfWeek: daqqiEditDraft.dayOfWeek,
      startDate: daqqiEditDraft.startDate,
      timeSlot: daqqiEditDraft.timeSlot,
      roomId: daqqiEditDraft.roomId || undefined,
      roomName: room?.name || daqqiEditDraft.roomId || undefined,
    });
    setDaqqiEditRoundId('');
    notify('success', 'تم تحديث الروند بنجاح.');
  };

  const handleRemoveAttendeeFromRound = (roundId: string, subscriberId: string) => {
    const round = daqqiRounds.find(r => r.id === roundId);
    if (!round) return;
    doUpdateRound({ ...round, attendees: round.attendees.filter(a => a.subscriberId !== subscriberId) });
  };

  const handleDaqqiPay = (shouldPrint = false) => {
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
    let updatedSub = { ...sub, paymentHistory: [...(sub.paymentHistory ?? []), ...entries] };
    if (daqqiPayDraft.paymentType === 'course' && daqqiPayDraft.courseId) {
      if (!updatedSub.enrolledCourseIds.includes(daqqiPayDraft.courseId)) {
        updatedSub = {
          ...updatedSub,
          enrolledCourseIds: [...updatedSub.enrolledCourseIds, daqqiPayDraft.courseId],
          courseAccess: { ...(updatedSub.courseAccess ?? {}), [daqqiPayDraft.courseId]: { mode: 'full' } },
        };
      }
    }
    updateSubscriber(updatedSub);
    void mysqlAdmin.saveSubscriberPayment(daqqiPayModal.subscriberId, entries[0] as unknown as Record<string, unknown>).catch(() => {});
    if (daqqiPayDraft.paymentType === 'course' && daqqiPayDraft.courseId) {
      void mysqlAdmin.addEnrollment(daqqiPayModal.subscriberId, daqqiPayDraft.courseId, null, 'full').catch(() => {});
    }
    for (const ei of (daqqiPayDraft.extraItems || [])) {
      if (ei.type === 'course' && ei.courseId && !updatedSub.enrolledCourseIds.includes(ei.courseId)) {
        updatedSub = { ...updatedSub, enrolledCourseIds: [...updatedSub.enrolledCourseIds, ei.courseId], courseAccess: { ...(updatedSub.courseAccess ?? {}), [ei.courseId]: { mode: 'full' } } };
        void mysqlAdmin.addEnrollment(daqqiPayModal.subscriberId, ei.courseId, null, 'full').catch(() => {});
      }
    }
    if (daqqiPayModal.roundId && !requirePaymentApproval) {
      const r = daqqiRounds.find(r => r.id === daqqiPayModal.roundId);
      if (r) doUpdateRound({ ...r, attendees: r.attendees.map(a => a.subscriberId === daqqiPayModal.subscriberId ? { ...a, amountPaid: a.amountPaid + amount } : a) });
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
      const _prevPaid = (sub.paymentHistory || []).filter(p => p.currency === daqqiPayDraft.currency && (!p.courseId || p.courseId === daqqiPayDraft.courseId)).reduce((s, p) => s + Number(p.amount), 0);
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
    setDaqqiPayDraft({ bookingType: 'new_booking', paymentType: 'course', courseId: '', courseExpected: '', bookingDiscount: '', customExpected: '', discountPct: '', certType: '', certReqId: '', amount: '', currency: 'EGP', paymentMethod: '', transactionId: '', fromAccountNumber: '', date: new Date().toISOString().slice(0, 10), note: '', extraItems: [] });
    notify(requirePaymentApproval ? 'info' : 'success',
      requirePaymentApproval ? 'تم إرسال الدفعة للمراجعة ✓ — بانتظار موافقة المدير' : 'تم تسجيل الدفعة بنجاح.'
    );
  };

  const handleDaqqiPostponeStartDate = () => {
    if (!daqqiPostponeModal?.newDate) return;
    const round = daqqiRounds.find(r => r.id === daqqiPostponeModal.roundId);
    if (!round) return;
    doUpdateRound({ ...round, startDate: daqqiPostponeModal.newDate });
    setDaqqiPostponeModal(null);
    notify('success', 'تم تعديل تاريخ بداية الروند.');
  };

  const handleDaqqiToskeen = () => {
    if (!daqqiToskeenSubId || !daqqiToskeenTargetRoundId) return;
    const sub = subscribers.find(s => s.id === daqqiToskeenSubId);
    const round = daqqiRounds.find(r => r.id === daqqiToskeenTargetRoundId);
    if (!sub || !round) return;
    if (round.attendees.find(a => a.subscriberId === daqqiToskeenSubId)) return;
    const paid = (sub.paymentHistory || []).reduce((sum, p) => p.currency === 'EGP' ? sum + Number(p.amount) : sum, 0);
    const newAttendee = { subscriberId: sub.id, name: sub.name, phone: sub.phone, bookedAt: new Date().toISOString().slice(0, 10), amountPaid: paid };
    doUpdateRound({ ...round, attendees: [...round.attendees, newAttendee] });
    setDaqqiToskeenSubId(null);
    setDaqqiToskeenTargetRoundId('');
    notify('success', 'تم تسكين العميل في الروند بنجاح.');
  };

  const handleDaqqiTransfer = () => {
    if (!daqqiTransferModal || !daqqiTransferTargetId) return;
    const fromRound = daqqiRounds.find(r => r.id === daqqiTransferModal.fromRoundId);
    const toRound = daqqiRounds.find(r => r.id === daqqiTransferTargetId);
    if (!fromRound || !toRound) return;
    const attendee = fromRound.attendees.find(a => a.subscriberId === daqqiTransferModal.subscriberId);
    if (!attendee) return;
    doUpdateRound({ ...fromRound, attendees: fromRound.attendees.filter(a => a.subscriberId !== daqqiTransferModal.subscriberId) });
    if (!toRound.attendees.find(a => a.subscriberId === daqqiTransferModal.subscriberId)) {
      doUpdateRound({ ...toRound, attendees: [...toRound.attendees, { ...attendee, bookedAt: new Date().toISOString().slice(0, 10) }] });
    }
    setDaqqiTransferModal(null);
    setDaqqiTransferTargetId('');
    notify('success', 'تم نقل العميل بنجاح.');
  };

  const handleDaqqiMarkAttendance = (roundId: string, subscriberId: string) => {
    const round = daqqiRounds.find(r => r.id === roundId);
    if (!round) return;
    doUpdateRound({
      ...round,
      attendees: round.attendees.map(a =>
        a.subscriberId === subscriberId ? { ...a, attendedLectures: (a.attendedLectures || 0) + 1 } : a
      ),
    });
  };

  const handleDaqqiTogglePostpone = (roundId: string) => {
    const round = daqqiRounds.find(r => r.id === roundId);
    if (!round) return;
    const thisWeek = getCurrentWeekKey();
    const existing = round.postponedWeeks || [];
    const updatedWeeks = existing.includes(thisWeek)
      ? existing.filter(w => w !== thisWeek)
      : [...existing, thisWeek];
    doUpdateRound({ ...round, postponedWeeks: updatedWeeks });
  };

  const handleDaqqiAddComm = (type: CommunicationRecord['type'], note: string) => {
    if (!daqqiCommModal) return;
    const sub = subscribers.find(s => s.id === daqqiCommModal.subscriberId);
    if (!sub) return;
    const rec: CommunicationRecord = {
      id: `dq-comm-${Date.now()}`, type,
      date: new Date().toISOString().slice(0, 10), notes: note,
    };
    updateSubscriber({ ...sub, communications: [...(sub.communications ?? []), rec] });
    setDaqqiCommModal(null);
    notify('success', 'تم تسجيل التواصل بنجاح.');
  };


  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2">
          <CalendarDays size={18} className="text-primary-500" />
          جدول كورسات الدقي
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-gray-200 overflow-hidden">
            <button onClick={() => setDaqqiView('table')} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition ${daqqiView === 'table' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              <List size={13} />جدول
            </button>
            <button onClick={() => setDaqqiView('calendar')} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition ${daqqiView === 'calendar' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              <CalendarDays size={13} />تقويم
            </button>
          </div>
          {!hideCreateRound && (
            <button
              onClick={() => { setDaqqiFormOpen(true); setDaqqiStep('form'); setDaqqiDraft(blankDaqqiDraft()); setDaqqiPendingRound(null); }}
              className="flex items-center gap-1.5 bg-primary-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-primary-700 transition"
            >
              <Plus size={15} />إنشاء روند جديدة
            </button>
          )}
        </div>
      </div>



      {/* Clients panel */}
      <DaqqiClientsSection
        daqqiSubs={daqqiSubs}
        daqqiRounds={daqqiRounds}
        courses={courses}
        bundles={bundles}
        assignedSubIds={assignedSubIds}
        receptionOptions={receptionOptions}
        notify={notify}
        onAddClient={() => setDaqqiAddClientModal(true)}
        onComm={(subId, subName, phone) => setDaqqiCommModal({ subscriberId: subId, subscriberName: subName, phone })}
        onPayment={(subId, subName, firstCourseId) => { setDaqqiPayModal({ subscriberId: subId, subscriberName: subName }); setDaqqiPayDraft({ bookingType: 'new_booking', paymentType: 'course', courseId: firstCourseId || '', courseExpected: '', bookingDiscount: '', customExpected: '', discountPct: '', certType: '', certReqId: '', amount: '', currency: 'EGP', paymentMethod: '', transactionId: '', fromAccountNumber: '', date: new Date().toISOString().slice(0, 10), note: '', extraItems: [] }); }}
        onHousing={(subId) => { setDaqqiToskeenSubId(subId); setDaqqiToskeenTargetRoundId(''); }}
      />

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
            {(daqqiFilterCourse || daqqiFilterInstructor || daqqiFilterDay || daqqiFilterTimeSlot || daqqiFilterStatus || daqqiFilterReception) && (
              <button onClick={() => { setDaqqiFilterCourse(''); setDaqqiFilterInstructor(''); setDaqqiFilterDay(''); setDaqqiFilterTimeSlot(''); setDaqqiFilterStatus(''); setDaqqiFilterReception(''); }} className="px-2 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 text-xs font-bold flex items-center gap-1">
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
                            {courseBundles(round.courseId).map(b => (
                              <div key={b.id} className="text-[10px] text-violet-600 font-semibold mt-0.5">مسار: {b.title}</div>
                            ))}
                          </td>
                          <td className="px-3 py-2.5 text-xs">
                            <span className="font-semibold text-gray-800">{round.dayOfWeek}</span>
                            <span className="text-gray-400 mr-1 text-[11px]">({round.startDate})</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${timeSlotColors[round.timeSlot] || ''}`}>{round.timeSlot}</span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-700">{round.instructorName}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-700">{round.receptionName}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-700">{round.roomName || '—'}</td>
                          <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                            <select
                              value={status}
                              onChange={e => doUpdateRound({ ...round, status: e.target.value as DaqqiRound['status'], ...(e.target.value === 'active' && { currentLecture: round.currentLecture || 1 }) })}
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
                              <div className="grid grid-cols-4 gap-0.5">
                                <button onClick={() => { setDaqqiAddClientsRoundId(round.id); setDaqqiAddClientsSel(new Set()); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-center transition" title="+ عملاء"><UserPlus size={12} /></button>
                                <button onClick={() => { setDaqqiEditRoundId(round.id); setDaqqiEditDraft({ courseId: round.courseId, instructorId: round.instructorId, receptionId: round.receptionId, roomId: round.roomId || '', dayOfWeek: round.dayOfWeek, startDate: round.startDate, timeSlot: round.timeSlot }); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-amber-50 hover:text-amber-600 flex items-center justify-center transition" title="تعديل"><Pencil size={12} /></button>
                                <button onClick={() => setDaqqiPostponeModal({ roundId: round.id, newDate: round.startDate })} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-orange-50 hover:text-orange-600 flex items-center justify-center transition" title="تأجيل موعد"><CalendarDays size={12} /></button>
                                <button onClick={() => { if (!confirm(`حذف روند ${course?.titleAr || round.code}؟`)) return; deleteDaqqiRound(round.id); }} className="h-7 rounded bg-gray-50 text-red-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition" title="حذف الروند"><X size={12} /></button>
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
                                              <div className="font-bold text-gray-800">{a.name}</div>
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
                                                <button onClick={e => { e.stopPropagation(); const wNum = a.phone.replace(/\D/g, ''); const waNum = wNum.startsWith('0') ? '2' + wNum : wNum; window.open(`https://wa.me/${waNum}`, '_blank'); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-teal-50 hover:text-teal-600 flex items-center justify-center transition" title="واتساب"><MessageCircle size={12} /></button>
                                                <button onClick={e => { e.stopPropagation(); setDaqqiPayModal({ subscriberId: a.subscriberId, subscriberName: a.name, roundId: round.id, attendeeAmountPaid: a.amountPaid }); setDaqqiPayDraft({ bookingType: 'new_booking', paymentType: 'course', courseId: round.courseId || '', courseExpected: '', bookingDiscount: '', customExpected: '', discountPct: '', amount: '', currency: 'EGP', paymentMethod: '', transactionId: '', fromAccountNumber: '', date: new Date().toISOString().slice(0, 10), note: '', certType: '', certReqId: '', extraItems: [] as { type: import('../../../types').PaymentItemType; label: string; amount: string; }[] }); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-green-50 hover:text-green-600 flex items-center justify-center transition" title="تسجيل دفعة"><CreditCard size={12} /></button>
                                                <button onClick={e => { e.stopPropagation(); const s = subscribers.find(x => x.id === a.subscriberId); navigate(`/client/${s?.clientCode || a.subscriberId}`); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-center transition" title="عرض الملف"><Eye size={12} /></button>
                                                <button onClick={e => { e.stopPropagation(); setDaqqiTransferModal({ subscriberId: a.subscriberId, fromRoundId: round.id }); setDaqqiTransferTargetId(''); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-amber-50 hover:text-amber-600 flex items-center justify-center transition" title="نقل لروند أخرى"><ArrowLeftRight size={12} /></button>
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setDaqqiFormOpen(false); setDaqqiStep('form'); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto p-6" dir="rtl" onClick={e => e.stopPropagation()}>
            {daqqiStep === 'form' ? (
              <>
                <h4 className="font-extrabold text-gray-900 text-lg mb-4">إنشاء روند جديدة</h4>
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
                  {daqqiRooms.length > 0 && (
                    <div>
                      <label className="text-xs text-gray-600 font-bold mb-1 block">القاعة</label>
                      <select value={daqqiDraft.roomId} onChange={e => setDaqqiDraft({ ...daqqiDraft, roomId: e.target.value })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
                        <option value="">— بدون قاعة —</option>
                        {daqqiRooms.map(r => <option key={r.name} value={r.name}>{r.name}{r.capacity ? ` (${r.capacity} فرد)` : ''}</option>)}
                      </select>
                    </div>
                  )}
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
                      !assignedSubIds.has(s.id) && isEnrolledInCourse(s.enrolledCourseIds || [], roundCourseId)
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
                              const paid = (s.paymentHistory || []).reduce((sum, p) => p.currency === 'EGP' ? sum + Number(p.amount) : sum, 0);
                              const cp = roundCourse?.price?.EGP ?? 0;
                              const enrolledNames = enrolledLabels(s.enrolledCourseIds || []);
                              const bookingDate = (s.createdAt || '').slice(0, 10);
                              return (
                                <label key={s.id} className="flex items-center gap-3 border border-gray-200 rounded-xl px-3 py-2.5 cursor-pointer hover:bg-gray-50">
                                  <input type="checkbox" checked={daqqiSelectedAttendees.has(s.id)} onChange={e => setDaqqiSelectedAttendees(prev => { const next = new Set(prev); e.target.checked ? next.add(s.id) : next.delete(s.id); return next; })} />
                                  <div className="flex-1 min-w-0">
                                    <div className="font-bold text-gray-800 text-sm">{s.name}</div>
                                    <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
                                      <span>{s.phone}</span>
                                      {bookingDate && <span className="text-gray-400">📅 {bookingDate}</span>}
                                      <span className="text-green-700 font-semibold">مدفوع: {paid.toLocaleString()} ج.م</span>
                                      {cp > 0 && <span className="text-gray-400">من {cp.toLocaleString()} ج.م</span>}
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
          </div>
        </div>
      )}

      {/* Add Clients Modal */}
      {daqqiAddClientsRoundId && (() => {
        const addRound = daqqiRounds.find(r => r.id === daqqiAddClientsRoundId);
        const addCourse = addRound ? courses.find(c => c.id === addRound.courseId) : null;
        const alreadyIn = new Set(addRound?.attendees.map(a => a.subscriberId) ?? []);
        const available = daqqiSubs.filter(s => {
          if (alreadyIn.has(s.id)) return false;
          if (daqqiShowAllClients) return true;
          return isEnrolledInCourse(s.enrolledCourseIds || [], addRound!.courseId);
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
                    const paidForCourse = (s.paymentHistory || []).filter(p => p.currency === 'EGP' && (!p.courseId || p.courseId === chosenCourseId)).reduce((sum, p) => sum + Number(p.amount), 0);
                    const cp = addCourse?.price?.EGP ?? 0;
                    const rem = cp > 0 ? Math.max(0, cp - paidForCourse) : 0;
                    const enrolled = enrolledLabels(enrolledIds);
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
      })()}

      {/* Add New Client Modal */}
      <DaqqiAddClientModal
        isOpen={daqqiAddClientModal}
        onClose={() => setDaqqiAddClientModal(false)}
        notify={notify}
        subscribersOverride={subscribersOverride}
        onLocallyAdd={id => setLocallyAddedSubIds(prev => { const n = new Set(prev); n.add(id); return n; })}
        onClientAdded={() => {}}
      />

      {/* Print styles */}
      <style>{`
        @media print {
          body > *:not(#daqqiPrintReceipt) { display: none !important; }
          #daqqiPrintReceipt {
            display: block !important;
            width: 80mm !important;
            max-width: 80mm !important;
            margin: 0 !important;
            padding: 3mm !important;
            font-size: 10px !important;
            font-family: monospace !important;
            line-height: 1.4 !important;
            color: #000 !important;
          }
          .print\\:hidden { display: none !important; }
        }
      `}</style>

      {/* Pay Receipt Print Modal */}
      <DaqqiPayReceiptModal data={daqqiPayPrintData} onClose={() => setDaqqiPayPrintData(null)} />

      {/* Edit Round Modal */}
      {daqqiEditRoundId && (
        <DaqqiEditRoundModal
          roundId={daqqiEditRoundId}
          rounds={daqqiRounds}
          draft={daqqiEditDraft}
          onChange={setDaqqiEditDraft}
          onSave={handleSaveEditRound}
          onClose={() => setDaqqiEditRoundId('')}
        />
      )}

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

      {/* Transfer Modal */}
      {daqqiTransferModal && (
        <DaqqiTransferModal
          modal={daqqiTransferModal}
          targetId={daqqiTransferTargetId}
          onTargetChange={setDaqqiTransferTargetId}
          onClose={() => { setDaqqiTransferModal(null); setDaqqiTransferTargetId(''); }}
          onConfirm={handleDaqqiTransfer}
          rounds={daqqiRounds}
          subscribers={subscribers}
          courses={courses}
        />
      )}

      {/* Toskeen Modal */}
      {daqqiToskeenSubId && (
        <DaqqiToskeenModal
          subId={daqqiToskeenSubId}
          targetRoundId={daqqiToskeenTargetRoundId}
          onTargetChange={setDaqqiToskeenTargetRoundId}
          onClose={() => { setDaqqiToskeenSubId(null); setDaqqiToskeenTargetRoundId(''); }}
          onConfirm={handleDaqqiToskeen}
          rounds={daqqiRounds}
          subscribers={subscribers}
          courses={courses}
        />
      )}

      {/* Postpone Modal */}
      {daqqiPostponeModal && (
        <DaqqiPostponeModal
          modal={daqqiPostponeModal}
          onChange={setDaqqiPostponeModal}
          onClose={() => setDaqqiPostponeModal(null)}
          onConfirm={handleDaqqiPostponeStartDate}
          onToggleWeek={handleDaqqiTogglePostpone}
          rounds={daqqiRounds}
          courses={courses}
        />
      )}
      {/* Communication Modal */}
      {daqqiCommModal && (
        <DaqqiCommModal
          key={daqqiCommModal.subscriberId}
          modal={daqqiCommModal}
          onClose={() => setDaqqiCommModal(null)}
          onSave={handleDaqqiAddComm}
        />
      )}
    </article>
  );
};

export default DaqqiScheduleTab;
