// The deduction box of a day in the month edit modal: which days take one, what is sent, and what the box says it means. The rules are the server's
// (api/lib/attendancePolicy.js manualDayDeduction): a day that costs nothing by itself (a free day, a leave-balance day, a holiday, overtime) answers 400 to a
// typed figure above one, so the form must not send one; a typed zero or a blank on an absence means "the rule" (two days, one with permission), not "nothing"; on a half day it means the rule too (half a day).

const FREE_STATUSES = ['OVERTIME', 'HOLIDAY', 'FREE_DAY', 'LEAVE_BALANCE', 'WEEKLY_OFF'];

export const takesDeduction = (status: string) => !FREE_STATUSES.includes(status);

/** The most a day's box takes: an absence without permission can cost two days (api/lib/payrollCalc.js UNEXCUSED_ABSENCE_DAYS), any other day one. */
export const mostDeduction = (status: string) => (status === 'ABSENT' ? 2 : 1);

/** What goes into the request: nothing for a day that cannot carry a deduction or a box left blank, else the typed number. */
export function deductionToSend(status: string, typed: string): number | undefined {
  if (!takesDeduction(status) || typed.trim() === '') return undefined;
  return Number(typed);
}

/** The box after the status was changed: kept when the new status can carry that figure, emptied when it cannot (a two on a day that is now a late arrival). */
export function deductionAfterStatusChange(status: string, typed: string): string {
  if (!takesDeduction(status) || typed.trim() === '') return '';
  return Number(typed) > mostDeduction(status) ? '' : typed;
}

/** What the box means for this status, in words, for its tooltip. */
export function deductionHelp(status: string): string {
  if (status === 'ABSENT') return 'سيبه فاضي (أو صفر) والغياب بيتخصم يومين بالقاعدة. اكتب 0.5 أو 1 أو 2 لو عايز خصم مختلف.';
  if (status === 'ABSENT_EXCUSED') return 'سيبه فاضي (أو صفر) والغياب بإذن بيتخصم يوم بالقاعدة. اكتب رقم أكبر من صفر لو عايز خصم مختلف.';
  if (status === 'HALF_DAY') return 'نص اليوم بيتخصم نص يوم من المرتب بالقاعدة. سيبه فاضي (أو صفر) للقاعدة، أو اكتب عدد أيام تاني (مثلاً 0.25).';
  if (!takesDeduction(status)) return 'اليوم ده مفيهوش خصم.';
  return 'سيبه فاضي ويتحسب من التأخير والانصراف بالسياسة، أو اكتب عدد الأيام (لحد يوم).';
}
