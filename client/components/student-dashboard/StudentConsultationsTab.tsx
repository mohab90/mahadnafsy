import { Link } from 'react-router-dom';
import { Calendar, ChevronRight, Clock, MessageSquare, Phone, User, Video } from 'lucide-react';

type Consultation = {
  id: string;
  therapistName?: string;
  status?: string;
  sessionDate?: string;
  slotLabel?: string;
  sessionType?: string;
  amount?: number;
  currency?: string;
  meetingLink?: string;
};

type StudentConsultationsTabProps = {
  consultations: Consultation[];
};

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

const statusLabels: Record<string, string> = {
  pending: 'قيد الانتظار',
  confirmed: 'مؤكدة',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

const sessionTypeLabels: Record<string, string> = {
  individual: 'فردية',
  couple: 'ثنائية',
  family: 'عائلية',
};

export function StudentConsultationsTab({ consultations }: StudentConsultationsTabProps) {
  if (consultations.length === 0) {
    return (
      <div className="glass-card-premium mx-auto max-w-lg rounded-2xl border border-white/50 bg-white/70 p-12 text-center shadow-xl shadow-gray-200/50 backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-primary-500/20">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
          <MessageSquare size={28} className="text-blue-400" />
        </div>
        <p className="mb-2 font-bold text-gray-600">لا توجد استشارات مسجلة</p>
        <p className="mb-6 text-sm text-gray-400">احجز جلسة مع أحد معالجينا المعتمدين</p>
        <Link
          to="/consultations"
          className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-6 py-3 font-bold text-white transition hover:bg-primary-700"
        >
          احجز استشارة <ChevronRight size={16} className="rtl:rotate-180" />
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      {consultations.map((consultation) => (
        <div
          key={consultation.id}
          className="glass-card-premium flex flex-col gap-4 rounded-2xl border border-white/50 bg-white/70 p-5 shadow-xl shadow-gray-200/50 backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-primary-500/20 sm:flex-row"
        >
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <Video size={22} className="text-primary-600" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="font-bold text-gray-900">{consultation.therapistName || 'استشارة'}</p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusColors[consultation.status || ''] || 'bg-gray-100 text-gray-600'}`}>
                {statusLabels[consultation.status || ''] || consultation.status || 'غير محدد'}
              </span>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-gray-500">
              {consultation.sessionDate && (
                <span className="flex items-center gap-1"><Calendar size={11} /> {consultation.sessionDate}</span>
              )}
              {consultation.slotLabel && (
                <span className="flex items-center gap-1"><Clock size={11} /> {consultation.slotLabel}</span>
              )}
              {consultation.sessionType && (
                <span className="flex items-center gap-1">
                  <User size={11} />
                  {sessionTypeLabels[consultation.sessionType] || consultation.sessionType}
                </span>
              )}
              {consultation.amount !== undefined && (
                <span className="flex items-center gap-1 font-bold text-primary-600">
                  {consultation.amount} {consultation.currency || ''}
                </span>
              )}
            </div>
            {consultation.meetingLink && consultation.status === 'confirmed' && (
              <a
                href={consultation.meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-bold text-white transition hover:bg-green-700"
              >
                <Video size={14} /> انضم للجلسة
              </a>
            )}
          </div>
        </div>
      ))}
      <div className="pt-2">
        <Link to="/consultations" className="inline-flex items-center gap-2 text-sm font-bold text-primary-600 hover:text-primary-700">
          <Phone size={15} /> احجز استشارة جديدة <ChevronRight size={14} className="rtl:rotate-180" />
        </Link>
      </div>
    </div>
  );
}
