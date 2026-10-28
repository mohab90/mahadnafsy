import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { Modal } from '../../../../shared/ui/Modal';
import { arabicReason } from '../../../lib/apiErrorText';
import { LAYOUT_FIELDS, LAYOUT_RANGE, SITE, formPrintUrl, loadFormLayout, saveFormLayout, type FormLayout } from '../../../lib/certificateForm';

/**
 * «مكان الطباعة على النموذج الجاهز (سم من أعلى الورقة) محتاج أعمله تثبيت بمقاسات معينة»: the four distances the pre-printed
 * form is written at, saved once for the institute — every print, on every computer, reads them from the server.
 */
export function FormLayoutModal({ sampleCode, onClose, notify }: {
  sampleCode?: string;
  onClose: () => void;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [layout, setLayout] = useState<FormLayout | null>(null);
  const [defaults, setDefaults] = useState<FormLayout | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    loadFormLayout()
      .then(result => { if (alive) { setLayout(result.layout); setDefaults(result.defaults); } })
      .catch(error => { if (alive) { notify('error', arabicReason(error, 'تعذّر تحميل المقاسات')); onClose(); } });
    return () => { alive = false; };
    // Loaded once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const field = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200';
  const set = (key: keyof FormLayout) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setLayout(current => (current ? { ...current, [key]: Number(event.target.value) } : current));
  const valid = layout && LAYOUT_FIELDS.every(({ key }) => layout[key] >= LAYOUT_RANGE.min && layout[key] <= LAYOUT_RANGE.max);

  const save = async () => {
    if (!layout || !valid) return;
    setSaving(true);
    try {
      await saveFormLayout(layout);
      notify('success', 'اتثبتت المقاسات — كل طباعة على النموذج هتمشي بيها');
      onClose();
    } catch (error) {
      notify('error', arabicReason(error, 'تعذّر حفظ المقاسات'));
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="مقاسات الطباعة على النموذج الجاهز" subtitle="سم من أعلى الورقة — بتتحفظ مرة واحدة لكل الأجهزة" size="md">
      {!layout ? (
        <p className="py-10 text-center text-sm text-gray-400">جاري التحميل…</p>
      ) : (
        <div className="space-y-3 text-sm" dir="rtl">
          <div className="grid grid-cols-2 gap-2">
            {LAYOUT_FIELDS.map(({ key, label }) => (
              <label key={key} className="block text-[11px] font-bold text-gray-600">{label}
                <input type="number" step="0.1" min={LAYOUT_RANGE.min} max={LAYOUT_RANGE.max} value={layout[key]} onChange={set(key)} className={`${field} mt-0.5`} />
                {defaults && <span className="text-[10px] font-normal text-gray-400">الأصل {defaults[key]} سم</span>}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-gray-400">كل مقاس بين {LAYOUT_RANGE.min} و{LAYOUT_RANGE.max} سم. جرّب على ورقة فاضية قبل ما تحفظ.</p>
          {sampleCode && (
            <a href={formPrintUrl(SITE, sampleCode, true, layout)} target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100">
              <Printer size={14} /> تجربة طباعة بالمقاسات دي (من غير حفظ)
            </a>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm hover:bg-gray-50">إلغاء</button>
            <button disabled={saving || !valid} onClick={() => void save()} className="flex-1 rounded-xl bg-amber-600 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50">
              {saving ? '⏳…' : 'تثبيت المقاسات'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
