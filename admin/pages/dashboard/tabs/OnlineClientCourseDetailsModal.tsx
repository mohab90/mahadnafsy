import { X } from 'lucide-react';
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
  updateSubscriber: (subscriber: SubscriberItem) => void;
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
  updateSubscriber,
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
      const newPayHistory = [...(row.paymentHistory || [])];
      draft.forEach((item) => {
        const cid = item.courseId;
        const exp = Number(item.expected) || 0;
        const paid = Number(item.paid) || 0;
        if (cid.startsWith('multi:')) return;
        if (cid.startsWith('bundle:')) {
          const bundleId = cid.replace('bundle:', '');
          const bundleCourseIds = bundles.find((bundle) => bundle.id === bundleId)?.courses.map((course) => course.id) || [];
          const existingBundleIdx = newPayHistory.findIndex((payment) => payment.courseId === cid && !payment.isInstallment);
          if (existingBundleIdx >= 0) {
            newPayHistory[existingBundleIdx] = { ...newPayHistory[existingBundleIdx], courseExpected: exp, ...(item.paid !== '' ? { amount: paid } : {}) };
            return;
          }
          const firstCoursePayIdx = newPayHistory.findIndex((payment) => payment.courseId && bundleCourseIds.includes(payment.courseId) && !payment.isInstallment);
          if (firstCoursePayIdx >= 0) {
            const toRemove = new Set(newPayHistory
              .map((_payment, index) => index)
              .filter((index) => index !== firstCoursePayIdx && newPayHistory[index].courseId && bundleCourseIds.includes(newPayHistory[index].courseId as string) && !newPayHistory[index].isInstallment));
            newPayHistory.splice(0, newPayHistory.length, ...newPayHistory.filter((_payment, index) => !toRemove.has(index)));
            const newIdx = newPayHistory.findIndex((payment) => payment.courseId && bundleCourseIds.includes(payment.courseId) && !payment.isInstallment);
            if (newIdx >= 0) newPayHistory[newIdx] = { ...newPayHistory[newIdx], courseId: cid, courseExpected: exp, ...(item.paid !== '' ? { amount: paid } : {}) };
          } else if (exp > 0 || paid > 0) {
            newPayHistory.push({ id: `det-${Date.now()}-${cid}`, courseId: cid, amount: paid, courseExpected: exp, paymentType: 'course', currency: 'EGP', at: new Date().toISOString(), isInstallment: false });
          }
          return;
        }
        const idx = newPayHistory.findIndex((payment) => payment.courseId === cid && !payment.isInstallment);
        if (idx >= 0) {
          newPayHistory[idx] = { ...newPayHistory[idx], courseExpected: exp, ...(item.paid !== '' ? { amount: paid } : {}) };
        } else if (exp > 0 || paid > 0) {
          newPayHistory.push({ id: `det-${Date.now()}-${cid}`, courseId: cid, amount: paid, courseExpected: exp, paymentType: 'course', currency: 'EGP', at: new Date().toISOString(), isInstallment: false });
        }
      });

      const newCreatedAt = draft.map((item) => item.createdAt).filter(Boolean).sort()[0] || row.createdAt;
      const updatedCustomPrices: Record<string, number> = { ...((row as SubscriberWithCustomPrices).customPrices || {}) };
      draft.forEach((item) => {
        if (item.expected !== '' && Number(item.expected) > 0) updatedCustomPrices[item.courseId] = Number(item.expected);
      });

      const updated = { ...row, customPrices: updatedCustomPrices, paymentHistory: newPayHistory, createdAt: newCreatedAt };
      updateSubscriber(updated);
      if (isNonAdminStaff) setSalesOwnSubscribers((prev) => prev.map((subscriber) => subscriber.id === updated.id ? updated : subscriber));
      const { updatedAt: _occ, ...savePayload } = updated as SubscriberWithCustomPrices & { updatedAt?: string };
      await mysqlAdmin.saveSubscriber(savePayload);
      notify('success', 'تم حفظ التفاصيل بنجاح ✅');
      onClose();
    } catch {
      notify('error', 'حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-indigo-50">
          <div>
            <h3 className="font-extrabold text-gray-900">📋 تفاصيل الكورسات</h3>
            <p className="text-xs text-gray-500 mt-0.5">{row.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
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
                  <input type="number" value={item.paid} onChange={(event) => setDraft((prev) => prev.map((entry, i) => i === index ? { ...entry, paid: event.target.value } : entry))} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" placeholder="0" />
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-xs text-gray-500 mb-1">تاريخ الاشتراك</label>
                <input type="date" value={item.createdAt} onChange={(event) => setDraft((prev) => prev.map((entry, i) => i === index ? { ...entry, createdAt: event.target.value } : entry))} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
              </div>
            </div>
          ))}
          {draft.length === 0 && <p className="text-sm text-gray-400 text-center py-4">لا يوجد كورسات مسجلة</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-gray-200 hover:bg-gray-100">إلغاء</button>
          <button disabled={saving} onClick={saveDetails} className="px-5 py-2 text-sm rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-50">
            {saving ? '...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}
