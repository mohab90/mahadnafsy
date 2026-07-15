import type {
  CommunicationRecord,
  ConsultationItem,
  Course,
  DaqqiRound,
  LeadItem,
  SubscriberItem,
} from '../../types';

type Args = {
  lead?: LeadItem;
  subscriber?: SubscriberItem;
  courses: Course[];
  consultations: ConsultationItem[];
  daqqiRounds: DaqqiRound[];
  clientName: string;
  clientPhone: string;
};

export function useUnifiedClientDerivedData({
  lead,
  subscriber,
  courses,
  consultations,
  daqqiRounds,
  clientName,
  clientPhone,
}: Args) {
  const subCerts = subscriber?.certificates ?? [];
  const extraReqs = subscriber?.extraCertificateRequests ?? [];
  const subInstallmentPlans = subscriber?.installmentPlans ?? [];

  const todayStr = new Date().toISOString().slice(0, 10);
  const soon3Str = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const instOverdueCount = subInstallmentPlans.flatMap(plan =>
    plan.entries.filter(entry => !entry.paidAt && entry.dueDate < todayStr)
  ).length;
  const instSoonCount = subInstallmentPlans.flatMap(plan =>
    plan.entries.filter(entry => !entry.paidAt && entry.dueDate >= todayStr && entry.dueDate <= soon3Str)
  ).length;

  const allComms: CommunicationRecord[] = [
    ...((lead?.communications || []).map(comm => ({ ...comm, _src: 'lead' as const }))),
    ...((subscriber?.communications || []).map(comm => ({ ...comm, _src: 'subscriber' as const }))),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const leadPayments = lead?.paymentRecords ?? [];
  const leadPaidEGP = leadPayments.reduce((sum, payment) => payment.currency === 'EGP' ? sum + payment.amount : sum, 0);
  const leadPaidSAR = leadPayments.reduce((sum, payment) => payment.currency === 'SAR' ? sum + payment.amount : sum, 0);
  const enrolledCourse = lead?.enrolledCourseId ? courses.find(course => course.id === lead.enrolledCourseId) : null;
  const coursePriceEGP = enrolledCourse?.price?.EGP ?? 0;
  const leadRemaining = Math.max(0, coursePriceEGP - leadPaidEGP);
  const leadPaidPct = coursePriceEGP > 0 ? Math.min(100, Math.round((leadPaidEGP / coursePriceEGP) * 100)) : 0;

  const subHistory = subscriber?.paymentHistory ?? [];
  const confirmedHistory = subHistory.filter(payment => !payment.status || payment.status === 'paid');
  const subPaidTotals = { EGP: 0, SAR: 0, USD: 0 };
  confirmedHistory.forEach(payment => {
    subPaidTotals[payment.currency] += payment.amount;
  });

  const bookingMap: Record<string, { paidEGP: number; expectedEGP?: number; discount?: number }> = {};
  confirmedHistory.forEach(payment => {
    if (!payment.courseId) return;
    if (!bookingMap[payment.courseId]) bookingMap[payment.courseId] = { paidEGP: 0 };
    if (payment.currency === 'EGP') bookingMap[payment.courseId].paidEGP += payment.amount;
    if (payment.isInstallment === false && payment.courseExpected) bookingMap[payment.courseId].expectedEGP = payment.courseExpected;
    if (payment.isInstallment === false && payment.discount) bookingMap[payment.courseId].discount = payment.discount;
  });

  const bookedCourseIds: string[] = subscriber
    ? [...new Set<string>([
      ...subHistory.filter(payment => payment.courseId && payment.isInstallment === false).map(payment => payment.courseId as string),
      ...subscriber.enrolledCourseIds,
    ])]
    : [];

  const subExpectedEGP = subscriber?.expectedTotals?.EGP ||
    Object.values(bookingMap).reduce((sum, booking) => booking.expectedEGP ? sum + booking.expectedEGP : sum, 0);
  const subRemainingEGP = subExpectedEGP > 0
    ? Math.max(0, subExpectedEGP - subPaidTotals.EGP - (subscriber?.discount || 0))
    : 0;
  const discountBase = subExpectedEGP || subPaidTotals.EGP;

  const normalizedName = clientName.trim().toLowerCase();
  const normalizedPhone = clientPhone.trim();
  const subConsults = consultations.filter(consultation =>
    consultation.clientName.trim().toLowerCase() === normalizedName ||
    (normalizedPhone && consultation.clientPhone?.trim() === normalizedPhone)
  );

  const subDaqqiRounds = subscriber
    ? (daqqiRounds || []).filter(round => round.attendees.some(attendee => attendee.subscriberId === subscriber.id))
    : [];

  return {
    allComms,
    bookedCourseIds,
    bookingMap,
    confirmedHistory,
    discountBase,
    extraReqs,
    instOverdueCount,
    instSoonCount,
    leadPaidEGP,
    leadPaidPct,
    leadPaidSAR,
    leadPayments,
    leadRemaining,
    subCerts,
    subConsults,
    subDaqqiRounds,
    subExpectedEGP,
    subHistory,
    subInstallmentPlans,
    subPaidTotals,
    subRemainingEGP,
  };
}
