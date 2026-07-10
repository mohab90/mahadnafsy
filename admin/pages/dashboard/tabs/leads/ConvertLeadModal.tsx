import React from 'react';
import { CheckCircle } from 'lucide-react';
import type { AccessMode, Course, LeadItem } from '../../../../types';

interface ConvertLeadModalState {
  lead: LeadItem | null;
  courseId: string;
  accessMode: AccessMode;
}

interface ConvertLeadModalProps {
  convertLeadModal: ConvertLeadModalState;
  setConvertLeadModal: (state: ConvertLeadModalState) => void;
  courses: Course[];
  convertLeadToSubscriber: () => void;
}

// "Convert lead to subscriber" confirmation modal. Extracted verbatim from LeadsTab
// (including the pre-existing garbled Arabic strings — not this refactor's concern).
export function ConvertLeadModal({ convertLeadModal, setConvertLeadModal, courses, convertLeadToSubscriber }: ConvertLeadModalProps) {
  if (!convertLeadModal.lead) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setConvertLeadModal({ lead: null, courseId: '', accessMode: 'full' })}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 text-lg mb-1">????? ???? ??????</h3>
        <p className="text-sm text-gray-500 mb-4">???? ????? <span className="font-bold text-gray-800">{convertLeadModal.lead.name}</span> ?????? ???? ?? ?????? ???? ??????.</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">?????? ????????</label>
            <select className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm" value={convertLeadModal.courseId} onChange={(e) => setConvertLeadModal({ ...convertLeadModal, courseId: e.target.value })}>
              <option value="">???? ??????...</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">??? ??????</label>
            <select className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm" value={convertLeadModal.accessMode} onChange={(e) => setConvertLeadModal({ ...convertLeadModal, accessMode: e.target.value as AccessMode })}>
              <option value="full">???? ????</option>
              <option value="trial">??????</option>
              <option value="limited">?????</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={convertLeadToSubscriber} disabled={!convertLeadModal.courseId} className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-1.5">
            <CheckCircle size={16} /> ????? ??????
          </button>
          <button onClick={() => setConvertLeadModal({ lead: null, courseId: '', accessMode: 'full' })} className="flex-1 border border-gray-300 text-gray-700 font-bold py-2.5 rounded-xl text-sm hover:bg-gray-50">
            ?????
          </button>
        </div>
      </div>
    </div>
  );
}
