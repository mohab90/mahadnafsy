import React from 'react';
import { X, Printer } from 'lucide-react';
import type { SubscriberCertificate, Course } from '../../types';

interface Props {
  viewCertId: string;
  subCerts: SubscriberCertificate[];
  courses: Course[];
  subscriberName: string;
  clientName: string;
  onClose: () => void;
}

/** Certificate-view (print) modal — extracted from UnifiedClientPage. Returns null if cert not found. */
export default function CertificateViewModal({ viewCertId, subCerts, courses, subscriberName, clientName, onClose }: Props) {
  const cert = subCerts.find(c => c.id === viewCertId);
  if (!cert) return null;
  const certCourse = courses.find(c => c.id === cert.courseId);
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-lg shadow">🏆</div>
            <div>
              <p className="font-extrabold text-gray-900 text-sm">شهادة إتمام الكورس</p>
              <p className="text-[11px] text-gray-400">{clientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-5 text-center space-y-3">
            <div className="text-4xl">🏆</div>
            <div>
              <p className="font-extrabold text-gray-900 text-lg">{subscriberName}</p>
              <p className="text-sm text-gray-500 mt-1">أتمّ بنجاح كورس</p>
              <p className="font-bold text-amber-700 text-base mt-1">{certCourse?.title || cert.courseId}</p>
            </div>
            <div className="pt-2 border-t border-amber-200 space-y-1">
              <p className="text-xs text-gray-500">رقم الشهادة</p>
              <p className="font-mono font-bold text-gray-800 text-sm bg-white border border-amber-200 rounded-lg px-3 py-1.5 inline-block">{cert.certificateNumber}</p>
            </div>
            <p className="text-xs text-gray-400">صدرت في {cert.issuedAt}</p>
          </div>
          <button onClick={() => window.print()} className="w-full py-2.5 bg-gray-800 text-white rounded-xl text-sm font-bold hover:bg-gray-700 flex items-center justify-center gap-2">
            <Printer size={16} /> طباعة الشهادة
          </button>
        </div>
      </div>
    </div>
  );
}
