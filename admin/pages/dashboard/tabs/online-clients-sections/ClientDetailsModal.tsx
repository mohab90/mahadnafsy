import React from 'react';
import { X } from 'lucide-react';
import type { Bundle, Course, SubscriberItem } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type DetailsDraftEntry = { courseId: string; expected: string; paid: string; createdAt: string };

interface Props {
  collDetailsRow: SubscriberItem | null;
  setCollDetailsRow: (row: SubscriberItem | null) => void;
  collDetailsDraft: DetailsDraftEntry[];
  setCollDetailsDraft: React.Dispatch<React.SetStateAction<DetailsDraftEntry[]>>;
  collDetailsSaving: boolean;
  setCollDetailsSaving: (v: boolean) => void;
  courses: Course[];
  bundles: Bundle[];
  updateSubscriber: (s: SubscriberItem) => void;
  isNonAdminStaff: boolean;
  setSalesOwnSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>>;
  notify: NotifyFn;
}

export function ClientDetailsModal({
  collDetailsRow, setCollDetailsRow, collDetailsDraft, setCollDetailsDraft,
  collDetailsSaving, setCollDetailsSaving, courses, bundles, updateSubscriber,
  isNonAdminStaff, setSalesOwnSubscribers, notify,
}: Props) {
  if (!collDetailsRow) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl" onClick={e=>{if(e.target===e.currentTarget)setCollDetailsRow(null);}}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-indigo-50">
          <div>
            <h3 className="font-extrabold text-gray-900">📋 تفاصيل الكورسات</h3>
            <p className="text-xs text-gray-500 mt-0.5">{collDetailsRow.name}</p>
          </div>
          <button onClick={()=>setCollDetailsRow(null)} className="text-gray-400 hover:text-gray-700"><X size={20}/></button>
        </div>
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {collDetailsDraft.map((d, i) => {
            const title = d.courseId.startsWith('bundle:')
              ? bundles.find(b=>b.id===d.courseId.replace('bundle:',''))?.title || d.courseId
              : d.courseId.startsWith('multi:')
              ? 'باقة: ' + d.courseId.replace('multi:','').split(',').map((cid: string) => courses.find(c=>c.id===cid)?.title || cid).join(' + ')
              : courses.find(c=>c.id===d.courseId)?.title || d.courseId;
            return (
              <div key={d.courseId} className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <p className="font-bold text-gray-800 text-sm mb-3 truncate">{title}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">سعر الكورس (ج.م)</label>
                    <input type="number" value={d.expected}
                      onChange={e=>setCollDetailsDraft(prev=>prev.map((x,j)=>j===i?{...x,expected:e.target.value}:x))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      placeholder="0" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">المبلغ المدفوع (ج.م)</label>
                    <input type="number" value={d.paid}
                      onChange={e=>setCollDetailsDraft(prev=>prev.map((x,j)=>j===i?{...x,paid:e.target.value}:x))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      placeholder="0" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-xs text-gray-500 mb-1">تاريخ الاشتراك</label>
                  <input type="date" value={d.createdAt}
                    onChange={e=>setCollDetailsDraft(prev=>prev.map((x,j)=>j===i?{...x,createdAt:e.target.value}:x))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                </div>
              </div>
            );
          })}
          {collDetailsDraft.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">لا يوجد كورسات مسجلة</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={()=>setCollDetailsRow(null)} className="px-4 py-2 text-sm rounded-xl border border-gray-200 hover:bg-gray-100">إلغاء</button>
          <button disabled={collDetailsSaving} onClick={async()=>{
            if(!collDetailsRow) return;
            setCollDetailsSaving(true);
            try {
              const newPayHistory = [...(collDetailsRow.paymentHistory||[])];
              collDetailsDraft.forEach(d => {
                const cid = d.courseId;
                const exp = Number(d.expected)||0;
                const paid = Number(d.paid)||0;
                // Virtual multi-bundle: only stored in customPrices, skip paymentHistory
                if (cid.startsWith('multi:')) return;
                if (cid.startsWith('bundle:')) {
                  // Bundle: find existing bundle-tagged entry first, then fall back to first course payment
                  const bundleId = cid.replace('bundle:', '');
                  const bCourseIds = bundles.find(b=>b.id===bundleId)?.courses.map(c=>c.id) || [];
                  // Remove any old individual-course payments and replace with one consolidated bundle entry
                  const existingBundleIdx = newPayHistory.findIndex(p=>p.courseId===cid&&!p.isInstallment);
                  if (existingBundleIdx >= 0) {
                    newPayHistory[existingBundleIdx] = {...newPayHistory[existingBundleIdx], courseExpected: exp, ...(d.paid!==''?{amount:paid}:{})};
                  } else {
                    // Find first existing non-installment payment for any course in the bundle
                    const firstCoursePayIdx = newPayHistory.findIndex(p=>p.courseId&&bCourseIds.includes(p.courseId)&&!p.isInstallment);
                    if (firstCoursePayIdx >= 0) {
                      // Promote this payment to represent the whole bundle, remove others
                      const otherCoursePayIdxs = newPayHistory.map((_p,i)=>i).filter(i=>i!==firstCoursePayIdx&&newPayHistory[i].courseId&&bCourseIds.includes(newPayHistory[i].courseId as string));
                      // Remove other individual course payments (keep installments)
                      const toRemove = new Set(otherCoursePayIdxs.filter(i=>!newPayHistory[i].isInstallment));
                      newPayHistory.splice(0, newPayHistory.length, ...newPayHistory.filter((_,i)=>!toRemove.has(i)));
                      const newIdx = newPayHistory.findIndex(p=>p.courseId&&bCourseIds.includes(p.courseId)&&!p.isInstallment);
                      if (newIdx >= 0) newPayHistory[newIdx] = {...newPayHistory[newIdx], courseId: cid, courseExpected: exp, ...(d.paid!==''?{amount:paid}:{})};
                    } else if (exp > 0 || paid > 0) {
                      newPayHistory.push({ id: `det-${Date.now()}-${cid}`, courseId: cid, amount: paid, courseExpected: exp, paymentType: 'course' as 'course', currency: 'EGP' as const, at: new Date().toISOString(), isInstallment: false });
                    }
                  }
                } else {
                  const idx = newPayHistory.findIndex(p=>p.courseId===cid&&!p.isInstallment);
                  if(idx >= 0) {
                    newPayHistory[idx] = {...newPayHistory[idx], courseExpected: exp, ...(d.paid!==''?{amount:paid}:{})};
                  } else if(exp > 0 || paid > 0) {
                    newPayHistory.push({ id: `det-${Date.now()}-${cid}`, courseId: cid, amount: paid, courseExpected: exp, paymentType: 'course' as 'course', currency: 'EGP' as const, at: new Date().toISOString(), isInstallment: false });
                  }
                }
              });
              const newCreatedAt = collDetailsDraft.map(d=>d.createdAt).filter(Boolean).sort()[0] || collDetailsRow.createdAt;
              // Build customPrices map for reliable persistence
              const updatedCustomPrices: Record<string,number> = { ...((collDetailsRow as any).customPrices || {}) };
              collDetailsDraft.forEach(d => {
                if (d.expected !== '' && Number(d.expected) > 0) updatedCustomPrices[d.courseId] = Number(d.expected);
              });
              const updated = { ...collDetailsRow, customPrices: updatedCustomPrices, paymentHistory: newPayHistory, createdAt: newCreatedAt };
              updateSubscriber(updated);
              if (isNonAdminStaff) setSalesOwnSubscribers(prev => prev.map(s => s.id === updated.id ? updated : s));
              // Strip updatedAt to bypass OCC conflict check when editing prices
              const { updatedAt: _occ, ...savePayload } = updated as any;
              await mysqlAdmin.saveSubscriber(savePayload);
              notify('success', 'تم حفظ التفاصيل بنجاح ✅');
            } catch { notify('error', 'حدث خطأ أثناء الحفظ'); }
            finally { setCollDetailsSaving(false); setCollDetailsRow(null); }
          }} className="px-5 py-2 text-sm rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-50">
            {collDetailsSaving ? '...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}
