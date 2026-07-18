import { Activity } from 'lucide-react';
import type { ConsultationItem } from '../../types';

interface UnifiedClientConsultationsPanelProps {
  consultations: ConsultationItem[];
}

const consultationStatusClass: Record<ConsultationItem['status'], string> = {
  scheduled: 'bg-indigo-100 text-indigo-700',
  completed: 'bg-green-100 text-green-700',
  confirmed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
};

const consultationStatusLabel: Record<ConsultationItem['status'], string> = {
  scheduled: 'Scheduled',
  completed: 'مكتملة',
  confirmed: 'مؤكدة',
  cancelled: 'ملغاة',
  pending: 'معلقة',
};

const sessionTypeLabel: Record<ConsultationItem['sessionType'], string> = {
  individual: 'فردية',
  couple: 'زوجية',
  family: 'عائلية',
};

export function UnifiedClientConsultationsPanel({ consultations }: UnifiedClientConsultationsPanelProps) {
  return (
    <div id="section-consultations" className="space-y-3">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-1 h-5 rounded-full bg-teal-500 flex-shrink-0" />
        <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-2 flex-1">
          <Activity size={14} className="text-teal-500" /> الاستشارات
        </h3>
        <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{consultations.length}</span>
      </div>

      {consultations.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <Activity size={40} className="mx-auto mb-2 text-gray-200" />
          <p>لا توجد استشارات</p>
        </div>
      ) : consultations.map(consultation => (
        <div key={consultation.id} className="border border-gray-100 rounded-xl p-4 bg-white shadow-sm flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-gray-800">{consultation.therapistName}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {consultation.sessionDate} · {sessionTypeLabel[consultation.sessionType]}
            </p>
          </div>
          <span className={`px-2 py-0.5 rounded text-[11px] font-bold shrink-0 ${consultationStatusClass[consultation.status]}`}>
            {consultationStatusLabel[consultation.status]}
          </span>
        </div>
      ))}
    </div>
  );
}
