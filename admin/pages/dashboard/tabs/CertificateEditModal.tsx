import { useState } from 'react';
import { Modal } from '../../../../shared/ui/Modal';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { arabicReason } from '../../../lib/apiErrorText';
import { FORM_DEFAULTS, loadFormOffsets, saveFormOffsets } from '../../../lib/certificateForm';

export type CertificateEditRow = {
  id: string; subscriberName: string; courseTitle: string;
  /** What the certificate prints now, and what was changed on this certificate (null = as the sources say). */
  printed: { name: string | null; course: string | null; duration: string; trainer: string };
  edits: { nameEn: string | null; courseEn: string | null; duration: string | null; trainer: string | null };
};

/**
 * «زر تعديل للاسم او المدة او اي حاجه تخص الشهادة»: the name, the course, its
 * duration and the trainer exactly as they will print — changed for THIS
 * certificate only (the client's file and the course keep theirs; an emptied
 * field goes back to what they say). Also the two distances the desk's copy is
 * printed at on the pre-printed paper.
 */
export function CertificateEditModal({ row, onClose, onSaved, notify }: {
  row: CertificateEditRow;
  onClose: () => void;
  onSaved: () => void;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  // The field starts as what prints now, so the desk edits it rather than retyping it.
  const [nameEn, setNameEn] = useState(row.edits.nameEn ?? row.printed.name ?? '');
  const [courseEn, setCourseEn] = useState(row.edits.courseEn ?? row.printed.course ?? '');
  const [duration, setDuration] = useState(row.edits.duration ?? row.printed.duration ?? '');
  const [trainer, setTrainer] = useState(row.edits.trainer ?? row.printed.trainer ?? '');
  const [offsets, setOffsets] = useState(loadFormOffsets);
  const [saving, setSaving] = useState(false);

  const field = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200';
  const save = async () => {
    setSaving(true);
    try {
      await mysqlAdmin.adminPut(`/admin/institute-certificates/${encodeURIComponent(row.id)}/edit`, { nameEn, courseEn, duration, trainer });
      saveFormOffsets(offsets);
      notify('success', 'اتحفظ تعديل الشهادة');
      onSaved();
    } catch (error) {
      notify('error', arabicReason(error, 'تعذّر حفظ تعديل الشهادة'));
    } finally { setSaving(false); }
  };
  const nudge = (key: 'nameTop' | 'courseTop') => (event: React.ChangeEvent<HTMLInputElement>) =>
    setOffsets(current => ({ ...current, [key]: Number(event.target.value) }));

  return (
    <Modal open onClose={onClose} title="تعديل الشهادة" subtitle={`${row.subscriberName} — ${row.courseTitle}`} size="md">
      <div className="space-y-3 text-sm" dir="rtl">
        <label className="block text-xs font-bold text-gray-700">الاسم على الشهادة (بالإنجليزي)
          <input value={nameEn} onChange={event => setNameEn(event.target.value)} dir="ltr" placeholder="MOHAMED AHMED ALI" className={`${field} mt-1`} />
        </label>
        <label className="block text-xs font-bold text-gray-700">اسم الكورس / الدبلومة (بالإنجليزي)
          <input value={courseEn} onChange={event => setCourseEn(event.target.value)} dir="ltr" placeholder="Clinical Psychology Diploma" className={`${field} mt-1`} />
        </label>
        <label className="block text-xs font-bold text-gray-700">مدة الكورس (بتتكتب تحت اسم الكورس)
          <input value={duration} onChange={event => setDuration(event.target.value)} dir="ltr" placeholder="60 Hours" className={`${field} mt-1`} />
        </label>
        <label className="block text-xs font-bold text-gray-700">اسم المحاضر (بيظهر في شهادة العميل — في طباعة السيستم بيتساب فاضي)
          <input value={trainer} onChange={event => setTrainer(event.target.value)} className={`${field} mt-1`} />
        </label>
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-2.5">
          <p className="mb-1.5 text-xs font-bold text-gray-700">مكان الطباعة على النموذج الجاهز (سم من أعلى الورقة)</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] font-bold text-gray-600">اسم العميل
              <input type="number" step="0.1" min={3} max={28} value={offsets.nameTop} onChange={nudge('nameTop')} className={`${field} mt-0.5`} />
            </label>
            <label className="block text-[11px] font-bold text-gray-600">اسم الكورس (والمدة تحته)
              <input type="number" step="0.1" min={3} max={28} value={offsets.courseTop} onChange={nudge('courseTop')} className={`${field} mt-0.5`} />
            </label>
          </div>
          <p className="mt-1 text-[10px] text-gray-400">الأصل {FORM_DEFAULTS.nameTop} و{FORM_DEFAULTS.courseTop} سم — لو الطابعة بتزحزح الورقة عدّلهم، وبيتحفظوا على الجهاز ده.</p>
        </div>
        <p className="text-[11px] text-gray-400">التعديل ده على الشهادة دي بس — ملف العميل والكورس زي ما هم. امسح الخانة وهترجع للأصل.</p>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm hover:bg-gray-50">إلغاء</button>
          <button disabled={saving} onClick={() => void save()} className="flex-1 rounded-xl bg-amber-600 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50">
            {saving ? '⏳…' : 'حفظ التعديل'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
