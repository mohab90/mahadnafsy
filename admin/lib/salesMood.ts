/**
 * «إحصائياتي» for a sales rep (8 Oct 2026): «تفرح مع كل حجز … وتزعل لما التارجيت
 * يكون بعيد … تشجعه كل شوية». How the page feels, decided from the numbers:
 * where the month's money stands against where it should be by today.
 */

export type Mood = 'champion' | 'fire' | 'good' | 'worried' | 'sad' | 'no_target';

export type PulseNumbers = {
  revenue: number;
  target: number;
  dayOfMonth: number;
  daysInMonth: number;
  todayBookings: number;
  monthBookings: number;
  streak: number;
  /** Cairo hour, 0–23 — a day with no booking reads differently at 10 and at 18. */
  hour: number;
};

export const MOOD_FACE: Record<Mood, string> = {
  champion: '🏆', fire: '🤩', good: '😄', worried: '😟', sad: '😢', no_target: '🙂',
};

/** Share of the target in hand, and of the month gone. */
export function progressOf({ revenue, target, dayOfMonth, daysInMonth }: Pick<PulseNumbers, 'revenue' | 'target' | 'dayOfMonth' | 'daysInMonth'>) {
  const done = target > 0 ? revenue / target : 0;
  const time = daysInMonth > 0 ? Math.min(1, dayOfMonth / daysInMonth) : 1;
  const expectedByToday = target * time;
  const left = Math.max(0, target - revenue);
  const daysLeft = Math.max(1, daysInMonth - dayOfMonth + 1);
  return { done, time, expectedByToday, left, perDay: Math.ceil(left / daysLeft), daysLeft };
}

export function moodOf(numbers: PulseNumbers): Mood {
  if (numbers.target <= 0) return 'no_target';
  const { done, time } = progressOf(numbers);
  if (done >= 1) return 'champion';
  const pace = time > 0 ? done / time : done;
  if (pace >= 1.15) return 'fire';
  if (pace >= 0.9) return 'good';
  if (pace >= 0.6) return 'worried';
  return 'sad';
}

const money = (value: number) => `${Math.round(value).toLocaleString('ar-EG-u-nu-latn')} ج.م`;

/** What the face says, in turn. Every line is about this rep's own numbers. */
export function messagesFor(mood: Mood, numbers: PulseNumbers): string[] {
  const { left, perDay, done, expectedByToday } = progressOf(numbers);
  const pct = Math.round(done * 100);
  const ahead = numbers.revenue - expectedByToday;
  const lines: string[] = [];
  if (mood === 'champion') {
    lines.push('🏆 حققت التارجت! إنت بطل الشهر ده');
    lines.push(`كل جنيه بعد كده زيادة ليك — ${pct}% من التارجت 💰`);
    lines.push('ماتوقفش! خلّي الشهر ده رقم قياسي 🚀');
  } else if (mood === 'fire') {
    lines.push('إنت نار 🔥 سابق التارجت بمراحل');
    lines.push(`قدام المطلوب لحد النهارده بـ ${money(ahead)} — عاش!`);
    lines.push(`فاضلك ${money(left)} وتقفل التارجت 🎯`);
  } else if (mood === 'good') {
    lines.push('ماشي صح 👏 كمّل بنفس الحماس');
    lines.push(`${pct}% من التارجت — في المعاد بالظبط`);
    lines.push(`محتاج ${money(perDay)} في اليوم وتقفل الشهر 💪`);
  } else if (mood === 'worried') {
    lines.push('التارجت بعيد شوية 😟 بس لسه في وقت تلحق');
    lines.push(`محتاج ${money(perDay)} في اليوم — كل مكالمة بتقربك 📞`);
    lines.push('كلّم المتابعات المتأخرة الأول — دول أقرب ناس للحجز');
  } else if (mood === 'sad') {
    lines.push('التارجت زعلان منك 😢 لسه فاضل كتير');
    lines.push(`فاضل ${money(left)} — يعني ${money(perDay)} كل يوم من النهارده`);
    lines.push('ولا يهمك — حجز واحد النهارده يغيّر المود كله 💪');
  } else {
    lines.push('مفيش تارجت متحدد للشهر ده — اسأل مديرك وابدأ تجري وراه');
    lines.push(`${numbers.monthBookings} حجز الشهر ده لحد دلوقتي 👏`);
  }
  if (numbers.todayBookings === 0 && numbers.hour >= 13) lines.push('لسه مفيش حجز النهارده… أول حجز هو أصعب واحد، يلا بينا 🚀');
  if (numbers.todayBookings >= 2) lines.push(`${numbers.todayBookings} حجوزات النهارده! يوم حلو 🎉`);
  if (numbers.streak >= 3) lines.push(`🔥 ${numbers.streak} أيام ورا بعض فيها حجز — ماتكسرش السلسلة`);
  return lines;
}

export type Badge = { key: string; emoji: string; label: string; earned: boolean };

export function badgesFor(numbers: PulseNumbers): Badge[] {
  const { done } = progressOf(numbers);
  return [
    { key: 'first_today', emoji: '⭐', label: 'أول حجز النهارده', earned: numbers.todayBookings >= 1 },
    { key: 'hat_trick', emoji: '🎩', label: '3 حجوزات في يوم', earned: numbers.todayBookings >= 3 },
    { key: 'streak3', emoji: '🔥', label: '3 أيام ورا بعض', earned: numbers.streak >= 3 },
    { key: 'half', emoji: '🥈', label: 'نص التارجت', earned: numbers.target > 0 && done >= 0.5 },
    { key: 'three_q', emoji: '🥇', label: '75% من التارجت', earned: numbers.target > 0 && done >= 0.75 },
    { key: 'target', emoji: '🏆', label: 'التارجت كامل', earned: numbers.target > 0 && done >= 1 },
  ];
}

/** The milestones of the target crossed, for a celebration of each once. */
export const MILESTONES = [0.5, 0.75, 1] as const;
export function milestonesReached(revenue: number, target: number): number[] {
  if (target <= 0) return [];
  return MILESTONES.filter(step => revenue >= target * step).map(step => Math.round(step * 100));
}
