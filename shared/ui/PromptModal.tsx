import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * A styled replacement for window.prompt.
 *
 * The recruitment and staff-file actions each need one short piece of text — a
 * call note, a reason for a decision, a date — and reached for window.prompt to
 * get it. That is the wrong tool here on four counts: it is unstyled in an app
 * that is otherwise consistent, it blocks the whole tab, browsers suppress it
 * (a second dialog can be dismissed permanently by the user, and automation
 * dismisses it outright, so the action silently does nothing), and it cannot
 * validate what it collects before the caller acts on it.
 *
 * `validate` returns an error string to keep the dialog open and show it, or
 * null to accept — so a bad date is caught here rather than by the API.
 */
export interface PromptModalProps {
  title: string;
  label: string;
  hint?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  multiline?: boolean;
  required?: boolean;
  busy?: boolean;
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

const PromptModal: React.FC<PromptModalProps> = ({
  title, label, hint, initialValue = '', placeholder, confirmLabel = 'تأكيد',
  multiline = false, required = false, busy = false, validate, onSubmit, onCancel,
}) => {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Focus on open, and let Escape close it — the two things window.prompt gave
  // for free and a hand-rolled dialog has to put back.
  useEffect(() => {
    firstFieldRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  const submit = () => {
    const trimmed = value.trim();
    if (required && !trimmed) { setError('هذا الحقل مطلوب'); return; }
    const failure = validate?.(trimmed) ?? null;
    if (failure) { setError(failure); return; }
    onSubmit(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={() => (busy ? undefined : onCancel())} dir="rtl">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
          <button onClick={onCancel} disabled={busy}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40">
            <X size={16} />
          </button>
        </div>

        {hint && <p className="mb-3 rounded-xl bg-gray-50 p-2.5 text-xs text-gray-600">{hint}</p>}

        <label className="block">
          <span className="mb-1 block text-xs font-bold text-gray-700">{label}</span>
          {multiline ? (
            <textarea
              ref={el => { firstFieldRef.current = el; }}
              rows={3} value={value} placeholder={placeholder}
              onChange={e => { setValue(e.target.value); setError(null); }}
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
            />
          ) : (
            <input
              ref={el => { firstFieldRef.current = el; }}
              value={value} placeholder={placeholder}
              onChange={e => { setValue(e.target.value); setError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
            />
          )}
        </label>

        {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button onClick={submit} disabled={busy}
            className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40">
            {busy ? 'جارٍ الحفظ…' : confirmLabel}
          </button>
          <button onClick={onCancel} disabled={busy}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptModal;
