/**
 * A refused save, said in Arabic with its reason.
 *
 * «عند زر حجز او دفع قسط اوقات بيظهر ايرور … لازم يظهر سبب الايرور ايه … بالعربي».
 * The server answers in Arabic where it was taught to; the rest reached the desk
 * as «Internal server error», «HTTP 409» or a socket message — and a payment
 * hook handed it to the toast under the wrong key, so even an Arabic reason was
 * dropped for «تحقق من الاتصال بالإنترنت».
 *
 * This reads at DISPLAY time and never rewrites the error: sign-in, the 401
 * handling and the conflict check read the English text and the status out of
 * the message (AuthContext, useCrmCoreState), and must keep doing so.
 */

const HAS_ARABIC = /[؀-ۿ]/;

const NETWORK = 'مفيش اتصال بالسيرفر — اتأكد من الإنترنت وحاول تاني (الدفعة لم تُسجَّل).';
const TIMEOUT = 'السيرفر اتأخر في الرد — الدفعة ممكن تكون اتسجلت، راجع ملف العميل قبل ما تعيد المحاولة.';

// Server texts that are still English, by what they mean.
const KNOWN: Array<[RegExp, string]> = [
  [/internal server error/i, 'حصل خطأ في السيرفر أثناء الحفظ — اتأكد إن الدفعة لم تُسجَّل ثم حاول مرة أخرى، ولو تكرر بلّغ الدعم الفني.'],
  [/lead not found/i, 'العميل المحتمل ده مش موجود أو اتنقل لموظف تاني — حدّث الصفحة وابحث عنه تاني.'],
  [/subscriber not found/i, 'العميل ده مش موجود أو اتشال من قاعدة العملاء — حدّث الصفحة.'],
  [/payment not found/i, 'الدفعة دي مش موجودة — يمكن اتحذفت، حدّث الصفحة.'],
  [/course not found|course does not belong/i, 'الكورس المختار مش موجود — حدّث الصفحة واختاره تاني.'],
  [/bundle not found|bundle does not belong/i, 'الباقة المختارة مش موجودة — حدّث الصفحة واختارها تاني.'],
  [/permission denied|insufficient permission/i, 'مش من صلاحياتك تعمل الإجراء ده — اطلب من المسئول عنك.'],
  [/outside your (payment|financial) scope/i, 'العميل أو الدفعة دي خارج نطاق صلاحياتك (فرع أو موظف تاني).'],
  [/unauthorized|forbidden/i, 'انتهت جلستك أو ليس لديك صلاحية لهذا الإجراء — سجّل الدخول من جديد.'],
  [/already (exists|registered)|duplicate/i, 'البيانات دي متسجلة من قبل (رقم تليفون أو إيميل مكرر) — ابحث عن العميل بزر «بحث».'],
  [/failed to fetch|networkerror|network error|load failed/i, NETWORK],
  [/aborted|timeout|timed out/i, TIMEOUT],
];

const BY_STATUS: Record<number, string> = {
  400: 'البيانات المدخلة غير صحيحة أو ناقصة — راجع الحقول وحاول تاني.',
  401: 'انتهت جلستك — سجّل الدخول من جديد.',
  403: 'ليس لديك صلاحية لهذا الإجراء.',
  404: 'المطلوب غير موجود — حدّث الصفحة وحاول تاني.',
  409: 'في تعارض مع بيانات موجودة (مسجل من قبل أو اتغير) — حدّث الصفحة وحاول تاني.',
  413: 'الملف أو البيانات المرسلة أكبر من المسموح.',
  422: 'البيانات المدخلة غير صالحة — راجع الحقول وحاول تاني.',
  429: 'محاولات كثيرة في وقت قصير — استنى دقيقة وحاول تاني.',
  500: 'حصل خطأ في السيرفر أثناء الحفظ — حاول مرة أخرى، ولو تكرر بلّغ الدعم الفني.',
  502: 'السيرفر غير متاح لحظياً — حاول بعد دقيقة.',
  503: 'السيرفر غير متاح لحظياً — حاول بعد دقيقة.',
  504: 'السيرفر اتأخر في الرد — راجع ملف العميل قبل ما تعيد المحاولة.',
};

/** The reason in Arabic for whatever was thrown; '' only when there is nothing to say. */
export function arabicReason(error: unknown, fallback = 'تعذّر إتمام العملية'): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = raw.trim();
  // The server already explained itself, in Arabic.
  if (message && HAS_ARABIC.test(message)) return message;
  if (message) {
    for (const [pattern, arabic] of KNOWN) if (pattern.test(message)) return arabic;
    const status = /\b(?:HTTP\s*)?([45]\d\d)\b/.exec(message);
    if (status && BY_STATUS[Number(status[1])]) return BY_STATUS[Number(status[1])];
  }
  if (error instanceof TypeError) return NETWORK;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') return TIMEOUT;
  return message ? `${fallback} (${message})` : fallback;
}
