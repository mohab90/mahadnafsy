import { Award, Ban, Eye, Plus, RotateCcw } from 'lucide-react';
import type { Course, ExtraCertificateRequest, SubscriberCertificate, SubscriberItem } from '../../types';
import { EXTRA_TYPE_LABELS } from './constants';

interface UnifiedClientCertificatesPanelProps {
  subscriber: SubscriberItem;
  courses: Course[];
  certificates: SubscriberCertificate[];
  extraRequests: ExtraCertificateRequest[];
  onRequestExtraCertificate: () => void;
  onViewCertificate: (certificateId: string) => void;
  onRevokeCertificate: (certificateId: string) => void;
  onReissueCertificate: (certificateId: string) => void;
}

function extraStatusClass(status?: string) {
  if (status === 'issued') return 'border-green-200 bg-green-50';
  if (status === 'paid') return 'border-blue-200 bg-blue-50';
  if (status === 'priced') return 'border-amber-200 bg-amber-50';
  return 'border-gray-200 bg-gray-50';
}

function extraStatusBadge(status?: string) {
  if (status === 'issued') return 'bg-green-100 text-green-700';
  if (status === 'paid') return 'bg-blue-100 text-blue-700';
  if (status === 'priced') return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-600';
}

function extraStatusLabel(status?: string) {
  if (status === 'issued') return '✅ صدرت';
  if (status === 'paid') return '💳 مدفوعة';
  if (status === 'priced') return '💰 بانتظار الدفع';
  return '⏳ قيد المراجعة';
}

function nationalityLabel(nationality?: string) {
  if (nationality === 'egyptian') return '🇪🇬 مصري';
  if (nationality === 'non_egyptian_egypt') return '👤 غير مصري مقيم في مصر';
  if (nationality === 'saudi_resident') return '🇸🇦 مقيم في السعودية';
  if (nationality) return '✈️ دولي';
  return '';
}

export function UnifiedClientCertificatesPanel({
  subscriber,
  courses,
  certificates,
  extraRequests,
  onRequestExtraCertificate,
  onViewCertificate,
  onRevokeCertificate,
  onReissueCertificate,
}: UnifiedClientCertificatesPanelProps) {
  return (
    <div id="section-certificates" className="space-y-3">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-1 h-5 rounded-full bg-amber-500 flex-shrink-0" />
        <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-2 flex-1">
          <Award size={14} className="text-amber-500" /> الشهادات
        </h3>
        <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
          {certificates.length + extraRequests.length}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <p className="font-bold text-gray-700 text-sm">شهادات الكورسات ({certificates.length})</p>
        {subscriber.enrolledCourseIds.length > 0 && (
          <button
            onClick={onRequestExtraCertificate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-100 border border-emerald-200"
          >
            <Plus size={12} /> طلب شهادة إضافية
          </button>
        )}
      </div>

      {certificates.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <Award size={36} className="mx-auto mb-2 text-gray-200" />
          <p>لا توجد شهادات</p>
        </div>
      ) : certificates.map((cert) => {
        const certCourse = courses.find((course) => course.id === cert.courseId);
        const isRevoked = cert.status === 'revoked';
        return (
          <div key={cert.id} className={`border rounded-xl p-4 group flex items-start justify-between gap-3 ${isRevoked ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
            <div className="flex gap-3">
              <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-base flex-shrink-0">🏆</div>
              <div>
                <p className="font-bold text-emerald-800 text-sm">{certCourse?.title || cert.courseId}</p>
                <p className="text-xs font-mono bg-emerald-100 inline-block px-2 py-0.5 rounded mt-0.5">{cert.certificateNumber}</p>
                <p className="text-xs text-gray-500 mt-0.5">صدرت في {cert.issuedAt}</p>
                <p className={`text-[11px] font-bold mt-1 ${isRevoked ? 'text-red-700' : 'text-emerald-700'}`}>
                  {isRevoked ? `ملغاة${cert.revokeReason ? ` — ${cert.revokeReason}` : ''}` : `سارية — إصدار ${cert.version || 1}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {!isRevoked && <button
                onClick={() => onViewCertificate(cert.id)}
                className="flex items-center gap-1 px-3 py-1.5 bg-white border border-emerald-300 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-100"
              >
                <Eye size={12} /> عرض
              </button>}
              {isRevoked ? (
                <button onClick={() => onReissueCertificate(cert.id)} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-blue-300 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-50">
                  <RotateCcw size={12} /> إعادة إصدار
                </button>
              ) : (
                <button onClick={() => onRevokeCertificate(cert.id)} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-red-300 text-red-700 rounded-lg text-xs font-bold hover:bg-red-50">
                  <Ban size={12} /> إلغاء
                </button>
              )}
            </div>
          </div>
        );
      })}

      {extraRequests.length > 0 && (
        <>
          <p className="font-bold text-gray-700 text-sm mt-4">الشهادات الإضافية ({extraRequests.length})</p>
          {extraRequests.map((request) => {
            const remaining = (request.price || 0) - (request.paidAmount || 0);
            return (
              <div key={request.id} className={`border rounded-xl p-4 ${extraStatusClass(request.status)}`}>
                <div className="flex justify-between items-start">
                  <p className="font-bold text-sm text-gray-900">{request.customName || EXTRA_TYPE_LABELS[request.type]}</p>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${extraStatusBadge(request.status)}`}>
                    {extraStatusLabel(request.status)}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">طُلبت في {request.requestedAt}</p>
                {request.price && request.price > 0 && (
                  <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
                    <span className="text-gray-600">السعر: <span className="font-bold">{request.price.toLocaleString()} {request.currency || 'ج.م'}</span></span>
                    {request.paidAmount != null && <span className="text-green-700">مدفوع: <span className="font-bold">{request.paidAmount.toLocaleString()}</span></span>}
                    {request.paidAmount != null && remaining > 0 && <span className="text-red-600 font-bold">متبقي: {remaining.toLocaleString()}</span>}
                    {request.paidAmount != null && remaining <= 0 && <span className="text-emerald-600 font-bold">✅ مكتمل</span>}
                  </div>
                )}
                {nationalityLabel(request.nationality) && <p className="text-xs text-gray-500 mt-0.5">{nationalityLabel(request.nationality)}</p>}
                {request.idNumber && <p className="text-xs font-mono text-gray-600 mt-0.5">🪪 {request.idNumber}</p>}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
