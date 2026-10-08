// The four questions a client housed in a round is asked, 1 to 10, in the order
// the desk asks them (api/lib/clientRatings.js), and how satisfied a mean reads.

export type RatingScores = { instructor: number; material: number; delivery: number; branchStaff: number };

export const RATING_QUESTIONS: Array<{ key: keyof RatingScores; label: string }> = [
  { key: 'instructor', label: 'المحاضر' },
  { key: 'material', label: 'المادة العلمية' },
  { key: 'delivery', label: 'توصيل المعلومة' },
  { key: 'branchStaff', label: 'مسئولين الفرع' },
];

export const ratingAverage = (scores: Partial<RatingScores>) =>
  Math.round((RATING_QUESTIONS.reduce((sum, { key }) => sum + Number(scores[key] || 0), 0) / RATING_QUESTIONS.length) * 10) / 10;

// «مدى رضى العميل عن الخدمه او مدى استياءه»: 8 and up is satisfied, under 5 upset.
export function satisfactionOf(average: number): { label: string; emoji: string; cls: string } {
  if (average >= 8) return { label: 'راضي', emoji: '😊', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (average >= 5) return { label: 'متوسط', emoji: '😐', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { label: 'مستاء', emoji: '😟', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
}
