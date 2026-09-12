import React, { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AlertTriangle, X } from 'lucide-react';

/**
 * A styled, un-suppressable replacement for window.confirm.
 *
 * PromptModal made this argument when it replaced window.prompt, and its own
 * comment says browsers suppress these dialogs. 47 window.confirm calls were
 * left behind, and the consequence was reported as a bug: Chrome offers
 * "prevent this page from creating additional dialogs" after the second one,
 * and once that is ticked every later confirm() returns false instantly. The
 * click makes no request, shows no error and says nothing — "لما بحاول امسح
 * عميل مش بيقبل ابدا". Confirmed on production by breaking confirm() and
 * watching the delete button go silent, then work again through this.
 *
 * Imperative rather than a hook on purpose. A hook would need three edits in
 * every one of thirty-six files — import, `useConfirm()`, and mounting the
 * dialog in that file's render — and the third is the kind of step that gets
 * missed in one file out of thirty-six and leaves a screen where confirming is
 * impossible. As a function, each call site is a single substitution:
 *
 *     if (!window.confirm('…')) return;   →   if (!await confirmDialog('…')) return;
 *
 * The enclosing function has to be async, which the compiler enforces.
 *
 * A plain string is accepted so the simplest sites stay one line; the object
 * form adds a title and a confirm label where the extra clarity is worth it.
 */
export type ConfirmOptions = {
  title?: string;
  /** Body text. Newlines are preserved, matching what window.confirm did. */
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' paints the confirm button red. Default, since these guard deletes. */
  tone?: 'danger' | 'normal';
};

const ConfirmBox: React.FC<{ options: ConfirmOptions; onAnswer: (ok: boolean) => void }> = ({ options, onAnswer }) => {
  const danger = (options.tone ?? 'danger') === 'danger';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onAnswer(false);
      if (event.key === 'Enter') onAnswer(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAnswer]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      onClick={() => onAnswer(false)}
      role="dialog"
      aria-modal="true"
      dir="rtl"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 text-base font-bold text-gray-900">
            {danger && <AlertTriangle size={18} className="shrink-0 text-red-500" />}
            {options.title || (danger ? 'تأكيد الحذف' : 'تأكيد')}
          </h3>
          <button onClick={() => onAnswer(false)} aria-label="إغلاق"
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        {options.message && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600">{options.message}</p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            autoFocus
            onClick={() => onAnswer(true)}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-white ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {options.confirmLabel || (danger ? 'تأكيد الحذف' : 'تأكيد')}
          </button>
          <button
            onClick={() => onAnswer(false)}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50"
          >
            {options.cancelLabel || 'إلغاء'}
          </button>
        </div>
      </div>
    </div>
  );
};

// One container and one root, reused. Creating a root per call leaks a detached
// node for every confirmation the session ever shows.
let container: HTMLDivElement | null = null;
let root: Root | null = null;

export function confirmDialog(input: ConfirmOptions | string): Promise<boolean> {
  const options: ConfirmOptions = typeof input === 'string' ? { message: input } : input;

  if (!container) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }

  return new Promise<boolean>(resolve => {
    let settled = false;
    const answer = (value: boolean) => {
      if (settled) return;
      settled = true;
      // Unmount on a later tick: React 19 warns when a root is updated from
      // inside its own render/commit, and this runs from an event handler
      // within that tree.
      queueMicrotask(() => root?.render(null));
      resolve(value);
    };
    root?.render(<ConfirmBox options={options} onAnswer={answer} />);
  });
}

export default confirmDialog;
