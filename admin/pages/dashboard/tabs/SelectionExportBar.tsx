import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';

/**
 * «تحديد عدد معين من الشهادات وكمان اعملها داونلود في شيت اكسل»: ticking rows,
 * picking the first N of what is on screen, and the download that holds exactly
 * those (or everything shown when nothing is ticked). Shared by the certificate
 * requests and the institute's certificates.
 */
export function useRowPicker<T extends { id: string }>(visible: T[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [count, setCount] = useState('');
  const chosen = useMemo(() => visible.filter(row => selected.has(row.id)), [visible, selected]);
  const allSelected = visible.length > 0 && chosen.length === visible.length;
  return {
    selected, count, setCount, chosen, allSelected,
    isSelected: (id: string) => selected.has(id),
    toggle: (id: string) => setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    }),
    toggleAll: () => setSelected(allSelected ? new Set() : new Set(visible.map(row => row.id))),
    clear: () => setSelected(new Set()),
    /** The first N shown; false when N is not a positive number. */
    pickFirst: (): boolean => {
      const wanted = Math.floor(Number(count));
      if (!(wanted > 0)) return false;
      setSelected(new Set(visible.slice(0, wanted).map(row => row.id)));
      return true;
    },
  };
}

export type RowPicker<T extends { id: string }> = ReturnType<typeof useRowPicker<T>>;

export function SelectionExportBar<T extends { id: string }>({ picker, shown, noun = 'شهادة', onDownload, notify }: {
  picker: RowPicker<T>;
  shown: number;
  noun?: string;
  onDownload: () => void | Promise<void>;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  if (shown === 0) return null;
  const pick = () => {
    if (!picker.pickFirst()) { notify('error', `اكتب عدد الـ${noun} المطلوب (رقم أكبر من صفر).`); return; }
    if (Number(picker.count) > shown) notify('info', `المتاح ${shown} فقط — اتحدد كلهم.`);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
      <label className="flex items-center gap-1.5 text-xs font-bold text-gray-700">
        حدّد أول
        <input type="number" min="1" inputMode="numeric" value={picker.count} onChange={event => picker.setCount(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') pick(); }} aria-label={`عدد الـ${noun} المطلوب تحديدها`}
          className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1 text-center text-xs" placeholder="العدد" />
        {noun}
      </label>
      <button type="button" onClick={pick} className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-bold text-amber-800 hover:bg-amber-100">تحديد</button>
      <button type="button" onClick={picker.toggleAll} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50">
        {picker.allSelected ? 'إلغاء تحديد الكل' : `تحديد كل المعروض (${shown})`}
      </button>
      {picker.selected.size > 0 && (
        <button type="button" onClick={picker.clear} className="rounded-lg px-2 py-1 text-xs font-bold text-gray-500 hover:bg-white">مسح التحديد</button>
      )}
      <span className="mr-auto text-xs font-bold text-gray-600">المحدّد: {picker.chosen.length} من {shown}</span>
      <button type="button" onClick={() => void onDownload()}
        className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">
        <Download size={13} /> تنزيل Excel {picker.chosen.length ? `(${picker.chosen.length})` : '(الكل)'}
      </button>
    </div>
  );
}
