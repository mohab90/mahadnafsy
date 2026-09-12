import React from 'react';
import { Printer } from 'lucide-react';

import { Modal } from '../../../shared/ui/Modal';

import type { Course, SubscriberCertificate, SubscriberItem } from '../../types';

interface UnifiedClientCertificateViewModalProps {
  certificateId: string | null;
  certificates: SubscriberCertificate[];
  subscriber: SubscriberItem | null | undefined;
  clientName: string;
  courses: Course[];
  onClose: () => void;
}

export const UnifiedClientCertificateViewModal: React.FC<UnifiedClientCertificateViewModalProps> = ({
  certificateId,
  certificates,
  subscriber,
  clientName,
  courses,
  onClose,
}) => {
  if (!certificateId || !subscriber) return null;
  const cert = certificates.find(c => c.id === certificateId);
  if (!cert) return null;
  const certCourse = courses.find(c => c.id === cert.courseId);

  return (
    <Modal
      open
      onClose={onClose}
      title="شهادة إتمام الكورس"
      subtitle={clientName}
      icon={<div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-lg shadow">🏆</div>}
      size="sm"
    >
        <div className="space-y-4">
          <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-5 text-center space-y-3">
            <div className="text-4xl">🏆</div>
            <div>
              <p className="font-extrabold text-gray-900 text-lg">{subscriber.name}</p>
              <p className="text-sm text-gray-500 mt-1">أتم بنجاح كورس</p>
              <p className="font-bold text-amber-700 text-base mt-1">{certCourse?.title || cert.courseId}</p>
            </div>
            <div className="pt-2 border-t border-amber-200 space-y-1">
              <p className="text-xs text-gray-500">رقم الشهادة</p>
              <p className="font-mono font-bold text-gray-800 text-sm bg-white border border-amber-200 rounded-lg px-3 py-1.5 inline-block">{cert.certificateNumber}</p>
            </div>
            <p className="text-xs text-gray-400">صدرت في {cert.issuedAt}</p>
          </div>
          <button onClick={() => window.open(`/api/completions/${encodeURIComponent(cert.certificateNumber)}/certificate`, '_blank', 'noopener,noreferrer')} className="w-full py-2.5 bg-gray-800 text-white rounded-xl text-sm font-bold hover:bg-gray-700 flex items-center justify-center gap-2">
            <Printer size={16} /> طباعة الشهادة
          </button>
        </div>
    </Modal>
  );
};
