import { useEffect } from 'react';

// The browser writes its own message for a `required` field that was left
// empty, and it writes it in the browser's language — so a visitor filling in
// an Arabic RTL form gets "Please fill out this field." in a Latin-script
// tooltip pointing at the wrong side of the input. Seven pages use `required`
// and not one of them sets a message.
//
// Setting it per input would mean touching every field on every form and
// remembering to do it on the next one. The `invalid` event fires on the field
// itself and does not bubble, but it does capture, so one listener at the
// document covers every form the site will ever have.

const messageFor = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string => {
  const v = el.validity;
  if (v.valueMissing) return el.tagName === 'SELECT' ? 'اختر من القائمة' : 'الحقل ده مطلوب';
  if (v.typeMismatch) return el.getAttribute('type') === 'email'
    ? 'اكتب بريد إلكتروني صحيح، زي name@example.com'
    : 'الصيغة اللي مكتوبة مش صحيحة';
  if (v.patternMismatch) return el.getAttribute('title') || 'الصيغة اللي مكتوبة مش صحيحة';
  if (v.tooShort) return `اكتب ${el.getAttribute('minlength')} حرف على الأقل`;
  if (v.tooLong) return `الحد الأقصى ${el.getAttribute('maxlength')} حرف`;
  if (v.rangeUnderflow) return `أقل قيمة مسموحة ${el.getAttribute('min')}`;
  if (v.rangeOverflow) return `أكبر قيمة مسموحة ${el.getAttribute('max')}`;
  if (v.stepMismatch) return 'القيمة دي مش مسموحة';
  return 'راجع القيمة المكتوبة';
};

export function useArabicValidation(): void {
  useEffect(() => {
    const isField = (t: EventTarget | null): t is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

    const onInvalid = (e: Event) => {
      if (!isField(e.target)) return;
      e.target.setCustomValidity(messageFor(e.target));
    };
    // A custom message sticks until it is cleared, and a field carrying one is
    // permanently invalid — the form would refuse to submit even after the
    // visitor corrects it. Clearing on every edit is what makes that safe.
    const onEdit = (e: Event) => {
      if (isField(e.target) && e.target.validationMessage) e.target.setCustomValidity('');
    };

    document.addEventListener('invalid', onInvalid, true);
    document.addEventListener('input', onEdit, true);
    document.addEventListener('change', onEdit, true);
    return () => {
      document.removeEventListener('invalid', onInvalid, true);
      document.removeEventListener('input', onEdit, true);
      document.removeEventListener('change', onEdit, true);
    };
  }, []);
}
