import React from 'react';
import { Activity } from 'lucide-react';
import { ConsultationItem } from '../../types';

interface Props {
  subConsults: ConsultationItem[];
}

/** Read-only list of a client's consultations (extracted from UnifiedClientPage). */
export default function ConsultationsTab({ subConsults }: Props) {
  return (
    <div id="section-consultations" className="space-y-3">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-1 h-5 rounded-full bg-teal-500 flex-shrink-0" />
        <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-2 flex-1">
          <Activity size={14} className="text-teal-500" /> الاستشارات
        </h3>
        <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{subConsults.length}</span>
      </div>
      {subConsults.length === 0 ? (
        <div className="text-center py-10 text-gray-400"><Activity size={40} className="mx-auto mb-2 text-gray-200" /><p>لا توجد استشارات</p></div>
      ) : subConsults.map(c => (
        <div key={c.id} className="border border-gray-100 rounded-xl p-4 bg-white shadow-sm flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-gray-800">{c.therapistName}</p>
            <p className="text-xs text-gray-500 mt-0.5">{c.sessionDate} · {c.sessionType === 'individual' ? 'فردية' : c.sessionType === 'couple' ? 'زوجية' : 'عائلية'}</p>
          </div>
          <span className={`px-2 py-0.5 rounded text-[11px] font-bold shrink-0 ${c.status === 'completed' ? 'bg-green-100 text-green-700' : c.status === 'confirmed' ? 'bg-blue-100 text-blue-700' : c.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
            {c.status === 'completed' ? 'مكتملة' : c.status === 'confirmed' ? 'مؤكدة' : c.status === 'cancelled' ? 'ملغاة' : 'معلقة'}
          </span>
        </div>
      ))}
    </div>
  );
}
