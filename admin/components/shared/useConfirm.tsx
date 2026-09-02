import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * A styled replacement for window.confirm.
 *
 * PromptModal already made this argument for window.prompt and replaced it, and
 * every word of it applies here: the dialog is unstyled in an app that is
 * otherwise consistent, it blocks the tab, and — the reason this exists —
 * browsers are allowed to suppress it. Chrome offers "prevent this page from
 * creating additional dialogs" after the second one, and once that box is
 * ticked every later confirm() returns false instantly. The click then does
 * nothing at all: no request, no error, no toast, no explanation.
 *
 * That is exactly the reported symptom — "لما بحاول امسح عميل مش بيقبل ابدا".
 * Traced on production by intercepting the request: the delete path is whole,
 * the API answers 200, and the only thing between the button and the server is
 * a dialog the browser is entitled to swallow.
 *
 * Returns a promise so a call site converts almost mechanically:
 *
 *     if (!window.confirm('…')) return;      →   if (!await confirm({ … })) return;
 *
 * `tone: 'danger'` is the default because everything guarded this way is
 * destructive; pass 'normal' for a merely-unusual action.
 */
export type ConfirmOptions = {
  title: string;
  /** Lines of body text. A single string is fine. */
  message?: string | string[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'normal';
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

export function useConfirm(): [ (options: ConfirmOptions) => Promise<boolean>, React.ReactNode ] {
  const [pending, setPending] = useState<Pending | null>(null);
  // Held in a ref as well so an unmount can settle the promise instead of
  // leaving the caller awaiting forever — an abandoned await inside a try block
  // silently swallows the rest of the handler.
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  useEffect(() => () => { pendingRef.current?.resolve(false); }, []);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    setPending({ ...options, resolve });
  }), []);

  const settle = useCallback((answer: boolean) => {
    setPending(current => { current?.resolve(answer); return null; });
  }, []);

  useEffect(() => {
    if (!pending) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') settle(false);
      if (event.key === 'Enter') settle(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, settle]);

  const danger = (pending?.tone ?? 'danger') === 'danger';
  const lines = pending
    ? (Array.isArray(pending.message) ? pending.message : pending.message ? [pending.message] : [])
    : [];

  const dialog = pending ? (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={() => settle(false)}
      role="dialog"
      aria-modal="true"
      dir="rtl"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 text-base font-bold text-gray-900">
            {danger && <AlertTriangle size={18} className="shrink-0 text-red-500" />}
            {pending.title}
          </h3>
          <button
            onClick={() => settle(false)}
            aria-label="إغلاق"
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        </div>

        {lines.map((line, index) => (
          <p key={index} className="mb-2 whitespace-pre-line text-sm leading-relaxed text-gray-600">{line}</p>
        ))}

        <div className="mt-4 flex gap-2">
          <button
            autoFocus
            onClick={() => settle(true)}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-white ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {pending.confirmLabel || (danger ? 'تأكيد الحذف' : 'تأكيد')}
          </button>
          <button
            onClick={() => settle(false)}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50"
          >
            {pending.cancelLabel || 'إلغاء'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return [confirm, dialog];
}
