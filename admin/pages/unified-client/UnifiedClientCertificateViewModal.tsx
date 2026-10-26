import React from 'react';
import { Printer } from 'lucide-react';

import { Modal } from '../../../shared/ui/Modal';

import { mysqlAdmin } from '../../lib/mysqlapi';
import { SITE, certificateUrl, formPrintUrl } from '../../lib/certificateForm';
import type { Course, SubscriberCertificate, SubscriberItem } from '../../types';

interface UnifiedClientCertificateViewModalProps {
  certificateId: string | null;
  certificates: SubscriberCertificate[];
  subscriber: SubscriberItem | null | undefined;
  clientName: string;
  courses: Course[];
  onClose: () => void;
  /** After a print is recorded, so the page shows the «اتطبعت» mark. */
  onPrinted?: () => void | Promise<void>;
}

export const UnifiedClientCertificateViewModal: React.FC<UnifiedClientCertificateViewModalProps> = ({
  certificateId,
  certificates,
  subscriber,
  clientName,
  courses,
  onClose,
  onPrinted,
}) => {
  if (!certificateId || !subscriber) return null;
  const cert = certificates.find(c => c.id === certificateId);
  if (!cert) return null;
  const certCourse = courses.find(c => c.id === cert.courseId);
  const site = SITE;

  // «محتاج زر طباعة من هنا … وطباعة بالاسم والكورس والساعات فقط»: the full design, or only the name, the course and the hours on the
  // pre-printed form at the institute's saved measurements. Either one is recorded as printed at the institute.
  const print = async (mode: 'full' | 'form') => {
    const url = mode === 'form' ? formPrintUrl(site, cert.certificateNumber, true) : certificateUrl(cert.certificateNumber, true);
    window.open(url, '_blank', 'noopener,noreferrer');
    try {
      await mysqlAdmin.adminPost(`/admin/institute-certificates/${encodeURIComponent(cert.id)}/printed`, { mode });
      await onPrinted?.();
    } catch { /* the print is already open; the mark can be missed, the paper cannot */ }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={cert.isTrack ? 'شهادة إتمام المسار' : 'شهادة إتمام الكورس'}
      subtitle={`${clientName} — ${certCourse?.title || cert.title || cert.courseId}`}
      icon={<div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-lg shadow">🏆</div>}
      size="lg"
    >
      <div className="space-y-3">
        {/* The certificate itself, as the client sees it (embed=1 is no download). */}
        <div className="overflow-hidden rounded-xl border border-amber-200 bg-white">
          <iframe
            title={`الشهادة ${cert.certificateNumber}`}
            src={`${window.location.origin}/api/completions/${encodeURIComponent(cert.certificateNumber)}/certificate?staff=1&embed=1`}
            className="h-[26rem] w-full"
          />
        </div>
        <p className="text-center text-xs text-gray-500">
          رقم الشهادة <span className="font-mono font-bold text-gray-800">{cert.certificateNumber}</span> — صدرت في {cert.issuedAt}
          {cert.printedAt ? ` — اتطبعت في المعهد ${cert.printedAt.slice(0, 10)}` : ' — لسه ما اتطبعتش'}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button onClick={() => void print('full')} className="py-2.5 bg-gray-800 text-white rounded-xl text-sm font-bold hover:bg-gray-700 flex items-center justify-center gap-2">
            <Printer size={16} /> طباعة كاملة
          </button>
          <button onClick={() => void print('form')} className="py-2.5 bg-amber-600 text-white rounded-xl text-sm font-bold hover:bg-amber-500 flex items-center justify-center gap-2">
            <Printer size={16} /> طباعة الاسم والكورس والساعات فقط
          </button>
        </div>
      </div>
    </Modal>
  );
};
