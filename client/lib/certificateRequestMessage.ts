// What a student is told when asking for an extra certificate is refused. The server answers with a code
// (POST /api/me/certificate-request: certificate_not_eligible, certificate_request_exists, «courseId required»…) and
// apiFetch turns it into the Error's message, so the form printed «certificate_not_eligible» as it was.

const BY_CODE: Record<string, string> = {
  certificate_not_eligible: 'الشهادة الإضافية بتتطلب كورس خلصته وسددت قيمته. لو خلصته وسددت ولسه ظاهرلك الرسالة دي، كلّم الدعم.',
  certificate_request_exists: 'طلبت الشهادة دي لنفس الكورس قبل كده — هتلاقيها في طلباتك فوق.',
  'courseId required': 'اختار الكورس اللي الشهادة بتاعته.',
  not_subscribed: 'لازم تكون مشترك في كورس عشان تطلب شهادة.',
};

export function certificateRequestMessage(error: unknown): string {
  const text = error instanceof Error ? error.message.trim() : '';
  if (BY_CODE[text]) return BY_CODE[text];
  // Arabic from the server is already for a person; anything else is a code or an HTTP status.
  if (/[؀-ۿ]/.test(text)) return text;
  return 'تعذر إرسال طلب الشهادة — جرّب تاني بعد شوية، ولو اتكررت كلّم الدعم.';
}
