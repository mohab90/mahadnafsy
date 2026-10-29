'use strict';

// What the sign-in log says went wrong, in words the desk can act on. The codes are what the sign-in
// routes write to login_history.failure_reason; the log used to show them raw («wrong_password»).
const REASONS = Object.freeze({
  wrong_password: 'كلمة المرور غلط',
  account_not_found: 'مفيش حساب بالبيانات دي',
  password_not_set: 'الحساب ملوش كلمة مرور — يدخل بكود الواتساب أو «نسيت كلمة المرور»',
  sharing_locked: 'الحساب موقوف مؤقتاً (دخول من أجهزة أو شبكات كتير)',
  sharing_limit_locked: 'دخل صح بس الحساب اتوقف بعدها (شبكات كتير)',
  device_limit: 'وصل للحد الأقصى من الأجهزة',
  wa_otp_invalid: 'كود الواتساب غلط أو منتهي',
  email_code_wrong: 'كود الإيميل غلط',
  email_code_expired: 'كود الإيميل انتهى أو اتحرق بعد 5 محاولات غلط',
  email_code_no_email: 'الحساب مالوش إيميل مسجّل يوصله كود الدخول',
  email_code_too_soon: 'طلب كود جديد بسرعة',
  email_code_send_failed: 'تعذّر إرسال كود الدخول على الإيميل',
});

/** The Arabic reason for a stored code; an unknown code is shown as it is rather than hidden. */
const reasonLabel = code => (code ? (REASONS[code] || String(code)) : null);

module.exports = { REASONS, reasonLabel };
