import { useEffect, useState } from 'react';
import { Modal } from '../../../shared/ui/Modal';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { arabicReason } from '../../lib/apiErrorText';

type CourseDates = { courseId: string; title: string; titleEn: string | null; start: string | null; end: string | null; suggestedStart: string | null; suggestedEnd: string | null };
type Loaded = { name: string; nameEn: string; nationalId: string; egyptian: boolean; courses: CourseDates[] };

/**
 * «بيانات الشهادة»: on every client's page, for collection and customer service —
 * the English name, the national id, and the dates each of the client's courses
 * ran. Saved on the client and their enrolments, so every certificate reads one
 * place (api/routes/misc/clientCertificateData.js).
 */
export function ClientCertificateDataModal({ subscriberId, onClose, onSaved, notify }: {
  subscriberId: string;
  onClose: () => void;
  onSaved: () => void;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [nameEn, setNameEn] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [dates, setDates] = useState<Record<string, { start: string; end: string }>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    mysqlAdmin.adminGet<Loaded>(`/admin/subscribers/${encodeURIComponent(subscriberId)}/certificate-data`)
      .then(data => {
        if (!alive) return;
        setLoaded(data);
        setNameEn(data.nameEn || '');
        setNationalId(data.nationalId || '');
        // Typed dates first; until then the system's own (the round, the enrolment) are offered to confirm.
        setDates(Object.fromEntries(data.courses.map(course => [course.courseId, {
          start: course.start || course.suggestedStart || '', end: course.end || course.suggestedEnd || '',
        }])));
      })
      .catch(error => { if (alive) { notify('error', arabicReason(error, 'تعذّر تحميل بيانات الشهادة')); onClose(); } });
    return () => { alive = false; };
    // The client opened is the only thing that should load it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriberId]);

  const field = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200';
  const setDate = (courseId: string, key: 'start' | 'end') => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDates(current => ({ ...current, [courseId]: { ...current[courseId], [key]: event.target.value } }));

  const save = async () => {
    setSaving(true);
    try {
      await mysqlAdmin.adminPut(`/admin/subscribers/${encodeURIComponent(subscriberId)}/certificate-data`, {
        nameEn, nationalId,
        courses: Object.entries(dates).map(([courseId, value]) => ({ courseId, start: value.start || null, end: value.end || null })),
      });
      notify('success', 'اتحفظت بيانات الشهادة');
      onSaved();
    } catch (error) {
      notify('error', arabicReason(error, 'تعذّر حفظ بيانات الشهادة'));
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="بيانات الشهادة" subtitle={loaded?.name} size="md">
      {!loaded ? (
        <p className="py-10 text-center text-sm text-gray-400">جاري التحميل…</p>
      ) : (
        <div className="space-y-3 text-sm" dir="rtl">
          <label className="block text-xs font-bold text-gray-700">اسم العميل بالإنجليزي (زي البطاقة — بيتطبع على الشهادة)
            <input value={nameEn} onChange={event => setNameEn(event.target.value)} dir="ltr" placeholder="Mohamed Ahmed Ali" className={`${field} mt-1`} />
          </label>
          <label className="block text-xs font-bold text-gray-700">{loaded.egyptian ? 'الرقم القومي (14 رقم)' : 'رقم الهوية / الجواز'}
            <input value={nationalId} onChange={event => setNationalId(event.target.value)} dir="ltr" inputMode={loaded.egyptian ? 'numeric' : 'text'} className={`${field} mt-1 font-mono`} />
          </label>
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700">تاريخ بداية ونهاية كل كورس</p>
            {loaded.courses.length === 0 && <p className="rounded-xl bg-gray-50 p-3 text-xs text-gray-500">العميل مش مشترك في كورسات لسه.</p>}
            {loaded.courses.map(course => (
              <div key={course.courseId} className="rounded-xl border border-gray-100 bg-gray-50/60 p-2.5">
                <p className="mb-1.5 text-xs font-bold text-indigo-700">{course.title}
                  {!course.titleEn && <span className="mr-2 text-[10px] font-normal text-red-600">ناقص اسمه بالإنجليزي (من صفحة الكورس)</span>}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[11px] font-bold text-gray-600">البداية
                    <input type="date" value={dates[course.courseId]?.start || ''} onChange={setDate(course.courseId, 'start')} className={`${field} mt-0.5`} />
                    {!course.start && course.suggestedStart && <span className="text-[10px] font-normal text-gray-400">من السيستم — راجعه</span>}
                  </label>
                  <label className="block text-[11px] font-bold text-gray-600">النهاية
                    <input type="date" value={dates[course.courseId]?.end || ''} onChange={setDate(course.courseId, 'end')} className={`${field} mt-0.5`} />
                    {!course.end && course.suggestedEnd && <span className="text-[10px] font-normal text-gray-400">من السيستم — راجعه</span>}
                  </label>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400">البيانات دي بتتحفظ على العميل وعلى كورساته، وبتتكمّل بيها أي طلب شهادة مفتوح له.</p>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm hover:bg-gray-50">إلغاء</button>
            <button disabled={saving} onClick={() => void save()} className="flex-1 rounded-xl bg-amber-600 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50">
              {saving ? '⏳…' : 'حفظ البيانات'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
