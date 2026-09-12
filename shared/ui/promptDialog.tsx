import React, { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { X } from 'lucide-react';

/**
 * Un-suppressable replacements for window.prompt and window.alert.
 *
 * The same defect as window.confirm, which these sit beside: a browser may stop
 * showing these dialogs entirely, and then prompt() returns null and alert()
 * returns nothing — the action quietly does not happen, with no request, no
 * error and no explanation. That was traced on production for confirm and is
 * true of all three.
 *
 * PromptModal already exists and is better where a screen can host it: it
 * validates before the caller acts. These are for the 28 call sites that only
 * want a string back, where mounting a component in each of sixteen files is
 * three edits apiece and the third is the one that gets missed.
 *
 *     const x = window.prompt('…');    →   const x = await promptDialog('…');
 *     window.alert('…');               →   await alertDialog('…');
 *
 * promptDialog returns null when cancelled, exactly as window.prompt did, so
 * the null-checks already written around every call site still hold.
 */
export type PromptOptions = {
  title?: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  multiline?: boolean;
};

type Mode =
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }
  | { kind: 'alert'; message: string; title?: string; resolve: () => void };

const Shell: React.FC<{ mode: Mode; done: () => void }> = ({ mode, done }) => {
  const isPrompt = mode.kind === 'prompt';
  const [value, setValue] = useState(isPrompt ? (mode.options.defaultValue ?? '') : '');
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const cancel = () => { if (mode.kind === 'prompt') mode.resolve(null); else mode.resolve(); done(); };
  const submit = () => { if (mode.kind === 'prompt') mode.resolve(value); else mode.resolve(); done(); };

  useEffect(() => {
    fieldRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
      if (event.key === 'Enter' && (!isPrompt || !mode.options?.multiline)) submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const title = mode.kind === 'prompt' ? mode.options.title : mode.title;
  const message = mode.kind === 'prompt' ? mode.options.message : mode.message;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      onClick={cancel} role="dialog" aria-modal="true" dir="rtl">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-base font-bold text-gray-900">{title || (isPrompt ? 'إدخال' : 'تنبيه')}</h3>
          <button onClick={cancel} aria-label="إغلاق"
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        {message && <p className="mb-3 whitespace-pre-line text-sm leading-relaxed text-gray-600">{message}</p>}

        {isPrompt && (mode.options.multiline ? (
          <textarea
            ref={el => { fieldRef.current = el; }}
            rows={3} value={value} placeholder={mode.options.placeholder}
            onChange={event => setValue(event.target.value)}
            className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
        ) : (
          <input
            ref={el => { fieldRef.current = el; }}
            value={value} placeholder={mode.options.placeholder}
            onChange={event => setValue(event.target.value)}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
        ))}

        <div className="mt-4 flex gap-2">
          <button onClick={submit}
            className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
            {(isPrompt && mode.options.confirmLabel) || 'تأكيد'}
          </button>
          {isPrompt && (
            <button onClick={cancel}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50">
              إلغاء
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function open(mode: Mode) {
  if (!container) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  root?.render(<Shell mode={mode} done={() => queueMicrotask(() => root?.render(null))} />);
}

export function promptDialog(input: PromptOptions | string, defaultValue?: string): Promise<string | null> {
  const options: PromptOptions = typeof input === 'string'
    ? { message: input, defaultValue }
    : input;
  return new Promise(resolve => {
    let settled = false;
    open({ kind: 'prompt', options, resolve: value => { if (!settled) { settled = true; resolve(value); } } });
  });
}

export function alertDialog(message: string, title?: string): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    open({ kind: 'alert', message, title, resolve: () => { if (!settled) { settled = true; resolve(); } } });
  });
}
