import type { DaqqiDayOfWeek, DaqqiTimeSlot } from '../../../../types';

export const DAQQI_DAYS_OF_WEEK: DaqqiDayOfWeek[] = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
];

export const DAQQI_TIME_SLOTS: DaqqiTimeSlot[] = ['صباحاً', 'ظهراً', 'مساءً'];

export const DAQQI_TIME_SLOT_COLORS: Record<string, string> = {
  'صباحاً': 'bg-amber-100 text-amber-700',
  'ظهراً': 'bg-blue-100 text-blue-700',
  'مساءً': 'bg-indigo-100 text-indigo-700',
};

export const DAQQI_STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  finished: 'bg-gray-200 text-gray-600',
};
