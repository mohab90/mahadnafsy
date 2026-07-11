import React from 'react';
import { Plus, Calendar, CheckCircle, XCircle, X } from 'lucide-react';
import type { StaffMember } from '../../../../types';
import { LEAVE_TYPE_LABELS, LEAVE_TYPE_COLORS, LEAVE_STATUS_LABELS, LEAVE_STATUS_COLORS, type LeavesFilter, type LeaveForm } from './shared';

interface Props {
  leavesFilter: LeavesFilter;
  setLeavesFilter: React.Dispatch<React.SetStateAction<LeavesFilter>>;
  leaves: any[];
  loadingLeaves: boolean;
  updateLeaveStatus: (leaveId: string, status: 'APPROVED' | 'REJECTED') => void;
  showLeaveForm: boolean;
  setShowLeaveForm: React.Dispatch<React.SetStateAction<boolean>>;
  leaveForm: LeaveForm;
  setLeaveForm: React.Dispatch<React.SetStateAction<LeaveForm>>;
  submitLeaveRequest: () => void;
  safeStaff: StaffMember[];
}

const LeavesTab: React.FC<Props> = ({
  leavesFilter, setLeavesFilter, leaves, loadingLeaves, updateLeaveStatus,
  showLeaveForm, setShowLeaveForm, leaveForm, setLeaveForm, submitLeaveRequest, safeStaff,
}) => (
  <div className="space-y-4">
    {/* Filter bar */}
    <div className="flex flex-wrap gap-2 items-center">
      {(['PENDING', 'APPROVED', 'REJECTED', 'all'] as const).map(s => (
        <button key={s} onClick={() => setLeavesFilter(s)} className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${leavesFilter === s ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-gray-600 border-gray-200 hover:border-slate-400'}`}>
          {s === 'PENDING' ? '⏳ معلق' : s === 'APPROVED' ? '✅ موافق' : s === 'REJECTED' ? '❌ مرفوض' : '📋 الكل'}
        </button>
      ))}
      <button onClick={() => setShowLeaveForm(true)} className="mr-auto px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition flex items-center gap-2"><Plus size={14}/> طلب إجازة</button>
    </div>

    {loadingLeaves ? (
      <div className="text-center py-12 text-gray-400">
        <div className="animate-spin w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full mx-auto mb-3"/>
        <p className="text-sm">جاري تحميل طلبات الإجازات...</p>
      </div>
    ) : (
      <div className="space-y-2">
        {leaves.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Calendar size={40} className="mx-auto mb-3 opacity-20"/>
            <p className="text-sm">لا توجد إجازات{leavesFilter !== 'all' ? ` بحالة "${LEAVE_STATUS_LABELS[leavesFilter]}"` : ''}</p>
          </div>
        ) : leaves.map(leave => (
          <div key={leave.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                <span className="font-bold text-sm text-gray-800">{leave.staff_name || 'موظف'}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${LEAVE_TYPE_COLORS[leave.leave_type] || 'bg-gray-100 text-gray-600'}`}>{LEAVE_TYPE_LABELS[leave.leave_type] || leave.leave_type}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${LEAVE_STATUS_COLORS[leave.status] || ''}`}>{LEAVE_STATUS_LABELS[leave.status] || leave.status}</span>
              </div>
              <p className="text-xs text-gray-500">{leave.start_date?.slice(0, 10)} — {leave.end_date?.slice(0, 10)} · <strong>{leave.total_days}</strong> {leave.total_days === 1 ? 'يوم' : 'أيام'}</p>
              {leave.reason && <p className="text-xs text-gray-400 mt-0.5 truncate">{leave.reason}</p>}
              {leave.approved_by_name && <p className="text-[10px] text-gray-400 mt-0.5">بواسطة: {leave.approved_by_name}</p>}
            </div>
            {leave.status === 'PENDING' && (
              <div className="flex gap-2 shrink-0">
                <button onClick={() => updateLeaveStatus(leave.id, 'APPROVED')} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition flex items-center gap-1"><CheckCircle size={12}/> موافقة</button>
                <button onClick={() => updateLeaveStatus(leave.id, 'REJECTED')} className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-bold hover:bg-red-200 transition flex items-center gap-1"><XCircle size={12}/> رفض</button>
              </div>
            )}
          </div>
        ))}
      </div>
    )}

    {/* Leave request form modal */}
    {showLeaveForm && (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowLeaveForm(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><Calendar size={16}/> طلب إجازة جديدة</h3>
            <button onClick={() => setShowLeaveForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
          </div>
          <div className="space-y-3">
            <select value={leaveForm.staff_id} onChange={e => setLeaveForm(f => ({ ...f, staff_id: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
              <option value="">اختر موظف</option>
              {safeStaff.filter(s => s.status === 'active').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={leaveForm.type} onChange={e => setLeaveForm(f => ({ ...f, type: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
              {Object.entries(LEAVE_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-gray-500 mb-1 block">من تاريخ</label><input type="date" value={leaveForm.start_date} onChange={e => setLeaveForm(f => ({ ...f, start_date: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/></div>
              <div><label className="text-xs text-gray-500 mb-1 block">إلى تاريخ</label><input type="date" value={leaveForm.end_date} onChange={e => setLeaveForm(f => ({ ...f, end_date: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/></div>
            </div>
            <textarea placeholder="سبب الإجازة" value={leaveForm.reason} onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none"/>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={submitLeaveRequest} disabled={!leaveForm.staff_id || !leaveForm.start_date || !leaveForm.end_date} className="flex-1 py-2 bg-slate-700 text-white rounded-xl font-bold hover:bg-slate-800 transition disabled:opacity-50">إرسال الطلب</button>
            <button onClick={() => setShowLeaveForm(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">إلغاء</button>
          </div>
        </div>
      </div>
    )}
  </div>
);

export default LeavesTab;
