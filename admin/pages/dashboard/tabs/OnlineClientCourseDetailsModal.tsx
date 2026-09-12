import { Modal } from '../../../../shared/ui/Modal';
import type React from 'react';
import type { Bundle, Course, SubscriberItem } from '../../../types';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { SubscriberWithCustomPrices } from './onlineClientsUtils';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type CourseDetailsDraft = {
  courseId: string;
  expected: string;
  paid: string;
  createdAt: string;
};

interface OnlineClientCourseDetailsModalProps {
  row: SubscriberItem | null;
  draft: CourseDetailsDraft[];
  setDraft: React.Dispatch<React.SetStateAction<CourseDetailsDraft[]>>;
  saving: boolean;
  setSaving: (saving: boolean) => void;
  courses: Course[];
  bundles: Bundle[];
  reloadSubscribers: () => Promise<void>;
  isNonAdminStaff: boolean;
  setSalesOwnSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>>;
  notify: NotifyFn;
  onClose: () => void;
}

export function OnlineClientCourseDetailsModal({
  row,
  draft,
  setDraft,
  saving,
  setSaving,
  courses,
  bundles,
  reloadSubscribers,
  isNonAdminStaff,
  setSalesOwnSubscribers,
  notify,
  onClose,
}: OnlineClientCourseDetailsModalProps) {
  if (!row) return null;

  const titleForCourse = (courseId: string) => {
    if (courseId.startsWith('bundle:')) {
      return bundles.find((bundle) => bundle.id === courseId.replace('bundle:', ''))?.title || courseId;
    }
    if (courseId.startsWith('multi:')) {
      return 'باقة: ' + courseId
        .replace('multi:', '')
        .split(',')
        .map((id) => courses.find((course) => course.id === id)?.title || id)
        .join(' + ');
    }
    return courses.find((course) => course.id === courseId)?.title || courseId;
  };

  const saveDetails = async () => {
    setSaving(true);
    try {
      const updatedCustomPrices: Record<string, number> = { ...((row as SubscriberWithCustomPrices).customPrices || {}) };
      draft.forEach((item) => {
        if (item.expected !== '' && Number(item.expected) > 0) updatedCustomPrices[item.courseId] = Number(item.expected);
      });

      const updated = { ...row, customPrices: updatedCustomPrices };
      const { updatedAt: _occ, ...savePayload } = updated as SubscriberWithCustomPrices & { updatedAt?: string };
      await mysqlAdmin.saveSubscriber(savePayload);
      await reloadSubscribers();
      if (isNonAdminStaff) {
        const fresh = await mysqlAdmin.listStaffSubscribers() as unknown as SubscriberItem[];
        setSalesOwnSubscribers(fresh);
      }
      notify('success', 'تم حفظ التفاصيل بنجاح ✅');
      onClose();
    } catch {
      notify('error', 'حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="📋 تفاصيل الكورسات"
      subtitle={row.name}
      footer={(
        <>
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-gray-200 hover:bg-gray-100">إلغاء</button>
          <button disabled={saving} onClick={saveDetails} className="px-5 py-2 text-sm rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-50">
            {saving ? '...' : 'حفظ'}
          </button>
        </>
      )}
    >
        <div className="space-y-4">
          {draft.map((item, index) => (
            <div key={item.courseId} className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <p className="font-bold text-gray-800 text-sm mb-3 truncate">{titleForCourse(item.courseId)}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">سعر الكورس (ج.م)</label>
                  <input type="number" value={item.expected} onChange={(event) => setDraft((prev) => prev.map((entry, i) => i === index ? { ...entry, expected: event.target.value } : entry))} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" placeholder="0" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">المبلغ المدفوع (ج.م)</label>
                  <input type="number" value={item.paid} readOnly disabled className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-100 text-gray-500" placeholder="0" />
                  <p className="mt-1 text-[10px] text-gray-400">يتغير فقط من تسجيل/اعتماد دفعة أو استرداد مالي.</p>
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-xs text-gray-500 mb-1">تاريخ الاشتراك</label>
                <input type="date" value={item.createdAt} readOnly disabled className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-100 text-gray-500" />
              </div>
            </div>
          ))}
          {draft.length === 0 && <p className="text-sm text-gray-400 text-center py-4">لا يوجد كورسات مسجلة</p>}
        </div>
    </Modal>
  );
}
