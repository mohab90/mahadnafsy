import { useState } from 'react';
import { Modal } from '../../../../shared/ui/Modal';
import { mysqlAdmin } from '../../../lib/mysqlapi';

// «تكمله لداتا العميل الاسم بالانجليزي ,, الرقم القومي ,,, تاريخ بداية الكورس
// وتاريخ النهايه» (8 Oct 2026). Anyone on the certificates desk completes them;
// the dates start from the client's round or enrolment when the system knows them.
// «يقدر يعدل اسم العميل علي الشهاده» (10 Oct 2026): the Arabic name printed on it
// too — from the certificates desk and from the client's file, for customer
// service and collection alike.
export type CertDataRow = {
  id: string; subscriberName: string; nameAr?: string | null; nameEn: string | null; idNumber: string | null; nationality: string | null;
  courseStartDate: string | null; courseEndDate: string | null; suggestedStart: string | null; suggestedEnd: string | null;
};

/** What a certificate still lacks before it can be issued. */
export function missingCertData(row: CertDataRow): string[] {
  const missing: string[] = [];
  if (!row.nameEn) missing.push('الاسم بالإنجليزي');
  if (!row.idNumber) missing.push(!row.nationality || row.nationality === 'egyptian' ? 'الرقم القومي' : 'رقم الهوية');
  if (!row.courseStartDate && !row.suggestedStart) missing.push('تاريخ البداية');
  if (!row.courseEndDate && !row.suggestedEnd) missing.push('تاريخ النهاية');
  return missing;
}

export function CertDataModal({ row, onClose, onSaved, notify }: {
  row: CertDataRow;
  onClose: () => void;
  onSaved: () => void;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [form, setForm] = useState({
    nameAr: row.nameAr || '',
    nameEn: row.nameEn || '',
    idNumber: row.idNumber || '',
    courseStartDate: row.courseStartDate || row.suggestedStart || '',
    courseEndDate: row.courseEndDate || row.suggestedEnd || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm(current => ({ ...current, [key]: event.target.value }));
  const field = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200';
  const egyptian = !row.nationality || row.nationality === 'egyptian';

  const save = async () => {
    setSaving(true);
    try {
      await mysqlAdmin.adminPut(`/admin/certificate-requests/${encodeURIComponent(row.id)}/client-data`, form);
      notify('success', 'اتحفظت بيانات الشهادة');
      onSaved();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الحفظ');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="بيانات الشهادة" subtitle={row.subscriberName} size="sm">
      <div className="space-y-3 text-sm" dir="rtl">
        <label className="block text-xs font-bold text-gray-700">الاسم على الشهادة بالعربي (ثلاثي على الأقل)
          <input value={form.nameAr} onChange={set('nameAr')} placeholder={row.subscriberName} className={`${field} mt-1`} />
        </label>
        <label className="block text-xs font-bold text-gray-700">الاسم بالإنجليزي (زي البطاقة)
          <input value={form.nameEn} onChange={set('nameEn')} dir="ltr" placeholder="Mohamed Ahmed Ali" className={`${field} mt-1`} />
        </label>
        <label className="block text-xs font-bold text-gray-700">{egyptian ? 'الرقم القومي (14 رقم)' : 'رقم الهوية / الجواز'}
          <input value={form.idNumber} onChange={set('idNumber')} dir="ltr" inputMode={egyptian ? 'numeric' : 'text'} className={`${field} mt-1 font-mono`} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-bold text-gray-700">بداية الكورس
            <input type="date" value={form.courseStartDate} onChange={set('courseStartDate')} className={`${field} mt-1`} />
            {!row.courseStartDate && row.suggestedStart && <span className="text-[10px] font-normal text-gray-400">من السيستم — راجعه</span>}
          </label>
          <label className="block text-xs font-bold text-gray-700">نهاية الكورس
            <input type="date" value={form.courseEndDate} onChange={set('courseEndDate')} className={`${field} mt-1`} />
            {!row.courseEndDate && row.suggestedEnd && <span className="text-[10px] font-normal text-gray-400">من السيستم — راجعه</span>}
          </label>
        </div>
        <p className="text-[11px] text-gray-400">الاسم والرقم القومي بيتحفظوا في ملف العميل كمان لو مش موجودين.</p>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm hover:bg-gray-50">إلغاء</button>
          <button disabled={saving} onClick={() => void save()} className="flex-1 rounded-xl bg-amber-600 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50">
            {saving ? '⏳…' : 'حفظ البيانات'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
