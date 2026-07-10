import React from 'react';
import { MessageSquare, ChevronRight, Video, Calendar, Clock, User, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ConsultationsTabProps {
  userConsultations: any[];
  statusColors: Record<string, string>;
  statusLabels: Record<string, string>;
}

export const ConsultationsTab: React.FC<ConsultationsTabProps> = ({
  userConsultations,
  statusColors,
  statusLabels,
}) => {
  if (userConsultations.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center shadow-sm max-w-lg mx-auto">
        <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <MessageSquare size={28} className="text-blue-400" />
        </div>
        <p className="text-gray-600 font-bold mb-2">لا توجد استشارات مسجلة</p>
        <p className="text-gray-400 text-sm mb-6">احجز جلسة مع أحد معالجينا المعتمدين</p>
        <Link to="/consultations" className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-6 py-3 rounded-xl font-bold transition">
          احجز استشارة <ChevronRight size={16} className="rtl:rotate-180" />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {userConsultations.map(c => (
        <div key={c.id} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm flex flex-col sm:flex-row gap-4">
          <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Video size={22} className="text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <p className="font-bold text-gray-900">{c.therapistName}</p>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusColors[c.status] || 'bg-gray-100 text-gray-600'}`}>
                {statusLabels[c.status] || c.status}
              </span>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><Calendar size={11} /> {c.sessionDate}</span>
              {c.slotLabel && <span className="flex items-center gap-1"><Clock size={11} /> {c.slotLabel}</span>}
              {c.sessionType && (
                <span className="flex items-center gap-1">
                  <User size={11} />
                  {c.sessionType === 'individual' ? 'فردية' : c.sessionType === 'couple' ? 'ثنائية' : 'عائلية'}
                </span>
              )}
              {c.amount !== undefined && (
                <span className="flex items-center gap-1 font-bold text-primary-600">{c.amount} {c.currency || ''}</span>
              )}
            </div>
            {c.meetingLink && c.status === 'confirmed' && (
              <a
                href={c.meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg font-bold transition"
              >
                <Video size={14} /> انضم للجلسة
              </a>
            )}
          </div>
        </div>
      ))}
      <div className="pt-2">
        <Link to="/consultations" className="inline-flex items-center gap-2 text-primary-600 hover:text-primary-700 font-bold text-sm">
          <Phone size={15} /> احجز استشارة جديدة <ChevronRight size={14} className="rtl:rotate-180" />
        </Link>
      </div>
    </div>
  );
};
