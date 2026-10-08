// «مؤشر عميل في خطر: تقييم واطي، وغاب محاضرتين، وعليه فلوس» — two of the three
// (api/lib/clientsAtRisk.js holds the same rule for the customer-service list).
// «Missed» is against the sessions the round's attendance was taken for.
export const MISSED_LECTURES = 2;
export const LOW_RATING = 5;

export function riskOf({ latestRating = null, sessions = 0, attended = 0, owed = 0 }: {
  latestRating?: number | null; sessions?: number; attended?: number; owed?: number;
}): { atRisk: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (latestRating != null && latestRating < LOW_RATING) reasons.push(`تقييمه ${latestRating}/10`);
  const missed = Math.max(0, Number(sessions) - Number(attended));
  if (missed >= MISSED_LECTURES) reasons.push(`غاب ${missed} محاضرات`);
  if (Number(owed) > 0) reasons.push(`عليه ${Math.round(owed).toLocaleString('ar-EG-u-nu-latn')} ج.م`);
  return { atRisk: reasons.length >= 2, reasons };
}
