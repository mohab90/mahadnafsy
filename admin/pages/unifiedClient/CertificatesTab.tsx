import React from 'react';
import { Award, Plus, Eye, Trash2 } from 'lucide-react';
import { Course, SubscriberItem, SubscriberCertificate, ExtraCertificateRequest } from '../../types';
import { EXTRA_TYPE_LABELS } from '../unifiedClient.constants';

interface Props {
  subscriber: SubscriberItem;
  subCerts: SubscriberCertificate[];
  extraReqs: ExtraCertificateRequest[];
  courses: Course[];
  onRequestExtra: () => void;
  onView: (certId: string) => void;
  onDeleteCert: (certId: string) => void;
}

// Certificates tab — extracted verbatim from UnifiedClientPage (Refactor #1).
const CertificatesTab: React.FC<Props> = ({ subscriber, subCerts, extraReqs, courses, onRequestExtra, onView, onDeleteCert }) => (
  <div id="section-certificates" className="space-y-3">
    <div className="flex items-center gap-3 mb-4">
      <div className="w-1 h-5 rounded-full bg-amber-500 flex-shrink-0" />
      <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-2 flex-1">
        <Award size={14} className="text-amber-500" /> الشهادات
      </h3>
      <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{subCerts.length + extraReqs.length}</span>
    </div>
    {/* Extra cert request form */}
    <div className="flex items-center justify-between">
      <p className="font-bold text-gray-700 text-sm">شهادات الكورسات ({subCerts.length})</p>
      {subscriber.enrolledCourseIds.length > 0 && (
        <button onClick={onRequestExtra}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-100 border border-emerald-200">
          <Plus size={12} /> طلب شهادة إضافية
        </button>
      )}
    </div>

    {subCerts.length === 0 ? (
      <div className="text-center py-8 text-gray-400"><Award size={36} className="mx-auto mb-2 text-gray-200" /><p>لا توجد شهادات</p></div>
    ) : subCerts.map(cert => {
      const certCourse = courses.find(c => c.id === cert.courseId);
      return (
        <div key={cert.id} className="border border-emerald-200 bg-emerald-50 rounded-xl p-4 group flex items-start justify-between gap-3">
          <div className="flex gap-3">
            <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-base flex-shrink-0">🏆</div>
            <div>
              <p className="font-bold text-emerald-800 text-sm">{certCourse?.title || cert.courseId}</p>
              <p className="text-xs font-mono bg-emerald-100 inline-block px-2 py-0.5 rounded mt-0.5">{cert.certificateNumber}</p>
              <p className="text-xs text-gray-500 mt-0.5">صدرت في {cert.issuedAt}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => onView(cert.id)}
              className="flex items-center gap-1 px-3 py-1.5 bg-white border border-emerald-300 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-100">
              <Eye size={12} /> عرض
            </button>
            <button onClick={() => onDeleteCert(cert.id)}
              className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
          </div>
        </div>
      );
    })}
    {/* Extra cert requests */}
    {extraReqs.length > 0 && (
      <>
        <p className="font-bold text-gray-700 text-sm mt-4">الشهادات الإضافية ({extraReqs.length})</p>
        {extraReqs.map(req => (
          <div key={req.id} className={`border rounded-xl p-4 ${req.status === 'issued' ? 'border-green-200 bg-green-50' : req.status === 'paid' ? 'border-blue-200 bg-blue-50' : req.status === 'priced' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
            <div className="flex justify-between items-start">
              <p className="font-bold text-sm text-gray-900">{req.customName || EXTRA_TYPE_LABELS[req.type]}</p>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${req.status === 'issued' ? 'bg-green-100 text-green-700' : req.status === 'paid' ? 'bg-blue-100 text-blue-700' : req.status === 'priced' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                {req.status === 'issued' ? '✅ صدرت' : req.status === 'paid' ? '💳 مدفوعة' : req.status === 'priced' ? '💰 بانتظار الدفع' : '⏳ قيد المراجعة'}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">طُلبت في {req.requestedAt}</p>
            {req.price && req.price > 0 && (
              <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
                <span className="text-gray-600">السعر: <span className="font-bold">{req.price.toLocaleString()} {req.currency || 'ج.م'}</span></span>
                {req.paidAmount != null && <span className="text-green-700">مدفوع: <span className="font-bold">{req.paidAmount.toLocaleString()}</span></span>}
                {req.paidAmount != null && req.price > req.paidAmount && <span className="text-red-600 font-bold">متبقي: {(req.price - req.paidAmount).toLocaleString()}</span>}
                {req.paidAmount != null && req.paidAmount >= req.price && <span className="text-emerald-600 font-bold">✅ مكتمل</span>}
              </div>
            )}
            {req.nationality && <p className="text-xs text-gray-500 mt-0.5">{req.nationality === 'egyptian' ? '🇪🇬 مصري' : req.nationality === 'non_egyptian_egypt' ? '👤 غير مصري مقيم في مصر' : req.nationality === 'saudi_resident' ? '🇸🇦 مقيم في السعودية' : '✈️ دولي'}</p>}
            {req.idNumber && <p className="text-xs font-mono text-gray-600 mt-0.5">🪪 {req.idNumber}</p>}
          </div>
        ))}
      </>
    )}
  </div>
);

export default CertificatesTab;
