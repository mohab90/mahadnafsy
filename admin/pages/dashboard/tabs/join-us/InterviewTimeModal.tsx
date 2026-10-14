import React, { useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import { cairoDateOnly, cairoDateTimeInput } from '../../../../../shared/cairoDate';

/**
 * Picking the interview time with a date-and-time picker.
 *
 * «ليه لما بننقل عميل للانترفيو بيظهر في السابق» (12 Oct 2026). This was a text
 * field asking for "YYYY-MM-DD HH:MM" in 24-hour time, with a September date as
 * its example: an afternoon interview typed as «03:00» is three in the morning,
 * already gone, and the interviews screen filed the candidate under السابق the
 * moment they arrived. The picker shows the time the way it will be read, and
 * will not offer a day that has passed.
 */
const InterviewTimeModal: React.FC<{
  title: string;
  hint?: string;
  confirmLabel: string;
  initialValue?: string;
  /** «من غير موعد» — move or accept without agreeing a time yet. */
  allowUndated?: boolean;
  busy: boolean;
  onSubmit: (interviewAt: string | undefined) => void;
  onCancel: () => void;
}> = ({ title, hint, confirmLabel, initialValue, allowUndated, busy, onSubmit, onCancel }) => {
  const [value, setValue] = useState(initialValue ? initialValue.replace(' ', 'T').slice(0, 16) : '');
  const [error, setError] = useState('');
  const min = `${cairoDateOnly()}T00:00`;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!value) { setError('اختار اليوم والساعة'); return; }
    if (value.slice(0, 10) < cairoDateOnly()) { setError('اليوم ده فات — اختار النهارده أو يوم جاي'); return; }
    onSubmit(value.replace('T', ' '));
  };

  return (
    <Modal open onClose={onCancel} title={title} subtitle={hint} tone="violet" size="sm" icon={<CalendarCheck size={18} />}>
      <form onSubmit={submit} className="space-y-3" dir="rtl">
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-gray-600">ميعاد الانترفيو (بتوقيت القاهرة)</span>
          <input type="datetime-local" value={value} min={min} step={900}
            onChange={event => { setValue(event.target.value); setError(''); }}
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" dir="ltr" />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {[['النهارده', 0], ['بكرة', 1], ['بعد بكرة', 2]].map(([label, days]) => (
            <button key={label} type="button"
              onClick={() => {
                const day = cairoDateTimeInput(new Date(Date.now() + Number(days) * 86400000)).slice(0, 10);
                setValue(`${day}T${value.split('T')[1] || '12:00'}`);
                setError('');
              }}
              className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-bold text-violet-700 hover:bg-violet-100">
              {label}
            </button>
          ))}
        </div>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy}
            className="flex-1 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-black text-white hover:bg-violet-700 disabled:opacity-50">
            {busy ? 'جاري الحفظ…' : confirmLabel}
          </button>
          {allowUndated && (
            <button type="button" disabled={busy} onClick={() => onSubmit(undefined)}
              className="rounded-xl border border-violet-200 px-3 py-2.5 text-xs font-bold text-violet-700 hover:bg-violet-50 disabled:opacity-50">
              من غير موعد
            </button>
          )}
          <button type="button" onClick={onCancel}
            className="rounded-xl border border-gray-200 px-3 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50">إلغاء</button>
        </div>
      </form>
    </Modal>
  );
};

export default InterviewTimeModal;
