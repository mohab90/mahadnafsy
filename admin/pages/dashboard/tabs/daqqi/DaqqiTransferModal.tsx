import React from 'react';
import { ArrowLeftRight, X } from 'lucide-react';
import type { DaqqiRound, SubscriberItem, Course } from '../../../../types';

interface TransferModalData {
  subscriberId: string;
  fromRoundId: string;
}

interface Props {
  modal: TransferModalData;
  targetId: string;
  onTargetChange: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  rounds: DaqqiRound[];
  subscribers: SubscriberItem[];
  courses: Course[];
}

export function DaqqiTransferModal({ modal, targetId, onTargetChange, onClose, onConfirm, rounds, subscribers, courses }: Props) {
  const fromRound = rounds.find(r => r.id === modal.fromRoundId);
  const sub = subscribers.find(s => s.id === modal.subscriberId);
  const available = rounds.filter(r => r.id !== modal.fromRoundId && !r.attendees.find(a => a.subscriberId === modal.subscriberId));
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-extrabold text-gray-900 text-lg flex items-center gap-2"><ArrowLeftRight size={18} className="text-amber-500" />نقل لروند أخرى</h4>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 mb-4">
          <p className="font-bold text-gray-800 text-sm">{sub?.name || modal.subscriberId}</p>
          <p className="text-xs text-gray-500 mt-0.5">من: {fromRound?.code} — {courses.find(c => c.id === fromRound?.courseId)?.titleAr || fromRound?.courseId}</p>
        </div>
        <div>
          <label className="text-xs text-gray-600 font-bold mb-2 block">اختر الروند المستهدف</label>
          {available.length === 0 ? <p className="text-sm text-gray-400 italic py-6 text-center">لا توجد روندات أخرى متاحة للنقل.</p> : (
            <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
              {available.map(r => {
                const c = courses.find(x => x.id === r.courseId);
                return (
                  <div key={r.id} onClick={() => onTargetChange(r.id)} className={`flex items-center gap-3 border rounded-xl px-3 py-2.5 cursor-pointer transition ${targetId === r.id ? 'border-amber-400 bg-amber-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-800 truncate">{c?.titleAr || c?.title || r.courseId} <span className="text-xs text-gray-400 font-mono">{r.code}</span></p>
                      <p className="text-xs text-gray-500">{r.dayOfWeek} — {r.timeSlot} — {r.startDate}</p>
                    </div>
                    <span className="text-xs bg-green-50 text-green-700 font-bold px-2 py-0.5 rounded-full flex-shrink-0">{r.attendees.length} حاضر</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
          <button onClick={onConfirm} disabled={!targetId} className="flex-1 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 disabled:opacity-40 transition">تأكيد النقل</button>
        </div>
      </div>
    </div>
  );
}
