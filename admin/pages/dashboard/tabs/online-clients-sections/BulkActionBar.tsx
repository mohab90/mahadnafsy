import React from 'react';
import type { Course, StaffMember, SubscriberItem } from '../../../../types';
import { paymentAmountInEGP } from '../onlineClientsUtils';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type BulkAction = null|'pause'|'finish'|'delete'|'assign';

interface Props {
  collOnlineSelected: Set<string>;
  setCollOnlineSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  collOnlineBulkConfirm: BulkAction;
  setCollOnlineBulkConfirm: (v: BulkAction) => void;
  collOnlineBulkAssignTo: string;
  setCollOnlineBulkAssignTo: (v: string) => void;
  isAdmin: boolean;
  staffMembers: StaffMember[];
  filtered: SubscriberItem[];
  courses: Course[];
  actionSubscribers: SubscriberItem[];
  shouldUseScopedSubscribers: boolean;
  setSalesOwnSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>>;
  deleteSubscriber: (id: string) => Promise<boolean>;
  updateSubscriber: (s: SubscriberItem) => Promise<boolean>;
  notify: NotifyFn;
}

export function BulkActionBar({
  collOnlineSelected, setCollOnlineSelected, collOnlineBulkConfirm, setCollOnlineBulkConfirm,
  collOnlineBulkAssignTo, setCollOnlineBulkAssignTo, isAdmin, staffMembers, filtered, courses,
  actionSubscribers, shouldUseScopedSubscribers, setSalesOwnSubscribers, deleteSubscriber, updateSubscriber, notify,
}: Props) {
  const [saving, setSaving] = React.useState(false);
  if (collOnlineSelected.size === 0 && !collOnlineBulkConfirm) return null;

  return (
    <>
      {collOnlineSelected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2" dir="rtl">
          <span className="text-xs font-bold text-blue-700">✔ تم تحديد {collOnlineSelected.size} عميل</span>
          <span className="flex-1"/>
          <button onClick={() => setCollOnlineBulkConfirm('pause')} className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-bold hover:bg-amber-600 transition">⏸ وقف</button>
          <button onClick={() => setCollOnlineBulkConfirm('finish')} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 transition">✅ إنهاء</button>
          {isAdmin && <button onClick={() => setCollOnlineBulkConfirm('assign')} className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-bold hover:bg-purple-700 transition">👤 تعيين مسئول</button>}
          {isAdmin && <button onClick={() => setCollOnlineBulkConfirm('delete')} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 transition">🗑 حذف</button>}
          <button onClick={() => {
            const toExport = filtered.filter(s => collOnlineSelected.has(s.id));
            const header = 'الاسم,الهاتف,الإيميل,الفرع,الكورسات,الحالة,المدفوع (ج.م),المتبقي,الكود\n';
            const csvRows = toExport.map(s => {
              const paid = (s.paymentHistory||[]).reduce((a,p)=>a+paymentAmountInEGP(p),0);
              const crs = (s.enrolledCourseIds||[]).map(id=>courses.find(c=>c.id===id)?.title||id).join(' | ');
              return [s.name,s.phone,s.email,s.branch||'',crs,s.clientStatus||s.status||'',paid,Math.max(0,(Number(s.totalValue)||0)-paid),s.clientCode||''].map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',');
            }).join('\n');
            const blob = new Blob(['﻿'+header+csvRows],{type:'text/csv;charset=utf-8;'});
            const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`selected-clients-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href);
          }} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition">📥 تصدير CSV</button>
          <button onClick={() => setCollOnlineSelected(new Set())} className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-bold hover:bg-gray-300 transition">✕ إلغاء</button>
        </div>
      )}
      {collOnlineBulkConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" dir="rtl">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <div className="text-lg font-bold mb-3 text-gray-800">
              {collOnlineBulkConfirm === 'delete' ? '🗑 حذف العملاء المحددين'
                : collOnlineBulkConfirm === 'pause' ? '⏸ وقف العملاء المحددين'
                : collOnlineBulkConfirm === 'assign' ? '👤 تعيين مسئول تحصيل'
                : '✅ إنهاء العملاء المحددين'}
            </div>
            <p className="text-sm text-gray-600 mb-4">
              {collOnlineBulkConfirm === 'delete'
                ? `هل أنت متأكد من حذف ${collOnlineSelected.size} عميل؟ هذا الإجراء لا يمكن التراجع عنه.`
                : collOnlineBulkConfirm === 'assign'
                ? `اختر مسئول التحصيل الجديد لـ ${collOnlineSelected.size} عميل:`
                : `هل تريد تغيير حالة ${collOnlineSelected.size} عميل إلى "${collOnlineBulkConfirm === 'pause' ? 'متوقف' : 'منتهي'}"؟`}
            </p>
            {collOnlineBulkConfirm === 'assign' && (
              <select value={collOnlineBulkAssignTo} onChange={e=>setCollOnlineBulkAssignTo(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-purple-300">
                <option value="">-- اختر مسئول --</option>
                {staffMembers.filter(s=>(s.role||'').toLowerCase()==='collection').map(s=>(
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setCollOnlineBulkConfirm(null); setCollOnlineBulkAssignTo(''); }} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200">إلغاء</button>
              <button onClick={async () => {
                const ids = [...collOnlineSelected];
                const succeeded = new Set<string>();
                const failed = new Set<string>();
                setSaving(true);
                try {
                  if (collOnlineBulkConfirm === 'delete') {
                    for (const id of ids) {
                      if (await deleteSubscriber(id)) succeeded.add(id);
                      else failed.add(id);
                    }
                    if (shouldUseScopedSubscribers) setSalesOwnSubscribers(prev => prev.filter(s => !succeeded.has(s.id)));
                  } else if (collOnlineBulkConfirm === 'assign') {
                    if (!collOnlineBulkAssignTo) return;
                    for (const id of ids) {
                      const sub = actionSubscribers.find(s=>s.id===id);
                      if (sub && await updateSubscriber({ ...sub, collectionStaffId: collOnlineBulkAssignTo })) succeeded.add(id);
                      else failed.add(id);
                    }
                    if (shouldUseScopedSubscribers) setSalesOwnSubscribers(prev=>prev.map(s=>succeeded.has(s.id)?{...s,collectionStaffId:collOnlineBulkAssignTo}:s));
                  } else {
                    const newStatus = collOnlineBulkConfirm === 'pause' ? 'paused' : 'finished';
                    for (const id of ids) {
                      const sub = actionSubscribers.find(s=>s.id===id);
                      if (sub && await updateSubscriber({ ...sub, clientStatus: newStatus })) succeeded.add(id);
                      else failed.add(id);
                    }
                    if (shouldUseScopedSubscribers) setSalesOwnSubscribers(prev=>prev.map(s=>succeeded.has(s.id)?{...s,clientStatus:newStatus}:s));
                  }
                  setCollOnlineSelected(failed);
                  setCollOnlineBulkConfirm(null);
                  setCollOnlineBulkAssignTo('');
                  notify(
                    failed.size > 0 ? 'error' : 'success',
                    failed.size > 0
                      ? `تم تنفيذ ${succeeded.size} وفشل ${failed.size}. بقيت السجلات الفاشلة محددة لإعادة المحاولة.`
                      : `✅ تم تنفيذ الإجراء على ${succeeded.size} عميل`
                  );
                } finally {
                  setSaving(false);
                }
              }} disabled={saving || (collOnlineBulkConfirm==='assign'&&!collOnlineBulkAssignTo)}
                className={`px-4 py-2 text-white rounded-lg text-sm font-bold disabled:opacity-40 ${
                  collOnlineBulkConfirm==='delete'?'bg-red-600 hover:bg-red-700':
                  collOnlineBulkConfirm==='assign'?'bg-purple-600 hover:bg-purple-700':
                  'bg-blue-600 hover:bg-blue-700'}`}>تأكيد</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
