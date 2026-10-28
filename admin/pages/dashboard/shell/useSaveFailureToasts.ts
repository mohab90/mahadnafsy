import { useEffect } from 'react';
import { arabicReason } from '../../../lib/apiErrorText';

type Notify = (type: 'success' | 'error' | 'info' | 'warning', text: string) => void;

export function useSaveFailureToasts(notify: Notify) {
  // Show a persistent error toast whenever a MySQL save fails in SiteDataContext.
  //
  // The reason is shown when the emitter supplies one. This used to always blame
  // the internet connection, including for answers the server had explained
  // precisely ("Instructor not found", a validation failure, a duplicate) —
  // which made every one of these indistinguishable from every other and sent
  // people checking their wifi over a data problem.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ field?: string; name?: string; reason?: string; action?: string }>).detail;
      const reason = detail?.reason ? arabicReason(String(detail.reason), '') : '';
      // A delete the server refused is not a failed save. Prefixing it with
      // "فشل الحفظ" named the wrong action and read as a bug in the panel rather
      // than as the rule it is, so a refusal that already explains itself is
      // shown as-is.
      const isDelete = detail?.action === 'delete';
      notify('error', reason
        ? (isDelete ? reason : `فشل الحفظ: ${reason}`)
        : isDelete
          ? 'تعذر الحذف. تحقق من الاتصال بالإنترنت وأعد المحاولة.'
          : 'فشل حفظ البيانات. تحقق من الاتصال بالإنترنت وأعد المحاولة.');
    };
    window.addEventListener('site-persist-error', handler);
    return () => window.removeEventListener('site-persist-error', handler);
  }, [notify]);
}
