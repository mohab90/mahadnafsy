import { ConsultationItem, Currency, MeetingProvider, Therapist, TherapistAvailabilitySlot, WeekDayKey } from '../types';

export const weekDayLabels: Record<WeekDayKey, string> = {
  saturday: 'السبت',
  sunday: 'الأحد',
  monday: 'الاثنين',
  tuesday: 'الثلاثاء',
  wednesday: 'الأربعاء',
  thursday: 'الخميس',
  friday: 'الجمعة',
};

export const meetingProviderLabels: Record<MeetingProvider, string> = {
  zoom: 'Zoom',
  google_meet: 'Google Meet',
  custom: 'رابط مخصص',
};

export const defaultMeetingBaseUrls: Record<MeetingProvider, string> = {
  zoom: 'https://zoom.us/j',
  google_meet: 'https://meet.google.com/lookup',
  custom: 'https://meet.example.com/session',
};

export const getWeekDayKeyFromDate = (dateValue: string): WeekDayKey | null => {
  if (!dateValue) return null;
  const parsed = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const dayMap: WeekDayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return dayMap[parsed.getDay()] || null;
};

export const formatAvailabilitySlot = (slot: TherapistAvailabilitySlot) => {
  const base = `${weekDayLabels[slot.day]} • ${slot.startTime} - ${slot.endTime}`;
  return slot.label ? `${slot.label} - ${base}` : base;
};

export const getTherapistSessionPrice = (therapist: Therapist, currency: Currency) => {
  if (therapist.consultationSettings?.enabled) {
    return therapist.consultationSettings.sessionPrice[currency];
  }
  return therapist.price[currency];
};

export const getTherapistActiveSlots = (therapist: Therapist, dateValue?: string) => {
  const slots = therapist.consultationSettings?.availableSlots?.filter((slot) => slot.isActive) || [];
  const weekDay = dateValue ? getWeekDayKeyFromDate(dateValue) : null;
  if (!weekDay) return slots;
  return slots.filter((slot) => slot.day === weekDay);
};

export const findTherapistSlot = (therapist: Therapist, slotId?: string) => {
  if (!slotId) return undefined;
  return therapist.consultationSettings?.availableSlots?.find((slot) => slot.id === slotId);
};

export const isConsultationEnabled = (therapist: Therapist) => Boolean(therapist.consultationSettings?.enabled);

/**
 * The express session's price in one currency, 0 when none is set — the same
 * rule the checkout charges by (api/lib/consultationRequests.js). The home page
 * fell back to 500 and the consultations page to 300 when nothing was set, so
 * the two showed different prices for one session and the checkout refused it.
 */
export const expressPrice = (content: Record<string, string>, currency: Currency): number => {
  const direct = Number(content[`express.price.${currency}`]);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const legacy = Number(content['consultation.price_egp']);
  return currency === 'EGP' && Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
};

export const sortConsultationsByDate = (rows: ConsultationItem[]) =>
  [...rows].sort((left, right) => {
    const leftTime = new Date(left.sessionDate.replace(' ', 'T')).getTime();
    const rightTime = new Date(right.sessionDate.replace(' ', 'T')).getTime();
    return rightTime - leftTime;
  });