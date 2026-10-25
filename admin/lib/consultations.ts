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

export const sortConsultationsByDate = (rows: ConsultationItem[]) =>
  [...rows].sort((left, right) => {
    const leftTime = new Date(left.sessionDate.replace(' ', 'T')).getTime();
    const rightTime = new Date(right.sessionDate.replace(' ', 'T')).getTime();
    return rightTime - leftTime;
  });

/**
 * «كل استشارة لازم تبان عاجلة خلال 60 دقيقة ولا استشارة بموعد» (25 Oct 2026): an express session
 * (source site_express) is answered within the hour; every other booking has a day and, usually, an hour.
 */
export type ConsultationTiming = { urgent: boolean; label: string; when: string };

export function consultationTiming(item: Pick<ConsultationItem, 'source' | 'sessionDate' | 'scheduledAt' | 'date' | 'sessionTime' | 'createdAt'>): ConsultationTiming {
  if (item.source === 'site_express') {
    const arrived = String(item.createdAt || '').replace('T', ' ').slice(0, 16);
    return { urgent: true, label: 'عاجلة خلال 60 دقيقة', when: arrived ? `وصلت ${arrived}` : 'التواصل مع العميل خلال ساعة من الحجز' };
  }
  const raw = String(item.sessionDate || item.scheduledAt || item.date || '').replace('T', ' ');
  const day = raw.slice(0, 10);
  const clock = item.sessionTime || (/^\d{4}-\d{2}-\d{2} (\d{2}:\d{2})/.exec(raw)?.[1] && raw.slice(11, 16) !== '00:00' ? raw.slice(11, 16) : '');
  return { urgent: false, label: 'استشارة بموعد', when: [day, clock].filter(Boolean).join(' · ') || 'بدون تاريخ' };
}
