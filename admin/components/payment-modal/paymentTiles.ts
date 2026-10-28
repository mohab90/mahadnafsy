// The payment dialog's tiles and picture captions: what each booking kind, item type and picture looks like.
import type { PhotoKind } from '../../lib/drivePhotos';
import type { PaymentItemType } from '../../types';

// The booking kinds and the item types as tiles, each in its own colour (small, and told apart at a glance).
export const BOOKING_TONE: Record<string, { on: string; off: string; tile: string }> = {
  new_booking: { on: 'border-rose-600 bg-gradient-to-l from-rose-600 to-red-500', off: 'border-gray-200 text-gray-600 hover:border-rose-400 hover:text-rose-600', tile: 'bg-rose-50' },
  installment: { on: 'border-sky-600 bg-gradient-to-l from-sky-600 to-blue-500', off: 'border-gray-200 text-gray-600 hover:border-sky-400 hover:text-sky-600', tile: 'bg-sky-50' },
  retake: { on: 'border-emerald-600 bg-gradient-to-l from-emerald-600 to-green-500', off: 'border-gray-200 text-gray-600 hover:border-emerald-400 hover:text-emerald-600', tile: 'bg-emerald-50' },
  upgrade: { on: 'border-violet-600 bg-gradient-to-l from-violet-600 to-purple-500', off: 'border-gray-200 text-gray-600 hover:border-violet-400 hover:text-violet-600', tile: 'bg-violet-50' },
};
export const PAYMENT_TYPE_TILES: Array<{ v: PaymentItemType | 'track'; ic: string; lb: string; on: string; off: string }> = [
  { v: 'course', ic: '🎓', lb: 'كورس', on: 'border-rose-600 bg-rose-600', off: 'border-gray-200 text-gray-600 hover:border-rose-300' },
  { v: 'track', ic: '🧭', lb: 'مسار', on: 'border-violet-600 bg-violet-600', off: 'border-gray-200 text-gray-600 hover:border-violet-300' },
  { v: 'certificate', ic: '🏅', lb: 'شهادة', on: 'border-amber-500 bg-amber-500', off: 'border-gray-200 text-gray-600 hover:border-amber-300' },
  { v: 'consultation', ic: '💬', lb: 'استشارة', on: 'border-sky-600 bg-sky-600', off: 'border-gray-200 text-gray-600 hover:border-sky-300' },
  { v: 'book', ic: '📚', lb: 'كتاب', on: 'border-emerald-600 bg-emerald-600', off: 'border-gray-200 text-gray-600 hover:border-emerald-300' },
  { v: 'carneh', ic: '🗂️', lb: 'كارنيه', on: 'border-indigo-600 bg-indigo-600', off: 'border-gray-200 text-gray-600 hover:border-indigo-300' },
  { v: 'other', ic: '📦', lb: 'أخرى', on: 'border-slate-600 bg-slate-600', off: 'border-gray-200 text-gray-600 hover:border-slate-300' },
];

export const PHOTO_COPY: Record<PhotoKind, { icon: string; title: string; why: string }> = {
  personal: { icon: '🙂', title: 'صورة شخصية', why: 'للكارنيه وشهادة البورد' },
  id: { icon: '🪪', title: 'صورة الهوية', why: 'للتوثيق' },
};
