import React, { useEffect, useState } from 'react';
import { useEscapeKey } from '../../shared/ui/useEscapeKey';
import { X, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import CertificateSheet, { CERT_W, CERT_H } from './CertificateSheet';

interface CourseCertificateProps {
  studentName: string;
  studentNameEn?: string;   // English name shown on certificate
  courseName: string;
  courseNameEn?: string;    // English course name for certificate
  instructorName: string;
  lectureCount?: number;
  /** The course's hours: printed as «Duration: 60 Hours» (a change made at the desk wins). */
  hours?: number;
  /** What the desk changed on this certificate (api: course_completions.cert_*); empty = as the sources say. */
  edits?: { nameEn?: string | null; courseEn?: string | null; duration?: string | null; trainer?: string | null };
  certNumber: string;       // = clientCode (serial number)
  issuedAt: string;
  onClose: () => void;
}

// The certificate carries the name and the course in English only («مينفعش بالعربي
// في الشهادة دي»): Latin letters, no Arabic. The server holds the same rule
// (api/lib/certificateEnglish.js).
const englishOnly = (value?: string | null) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text && /[A-Za-z]/.test(text) && !/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text) ? text : '';
};

const CourseCertificate: React.FC<CourseCertificateProps> = ({
  studentName, studentNameEn, courseName, courseNameEn, instructorName, hours, edits,
  certNumber, issuedAt, onClose,
}) => {
  // The certificate itself, full-bleed on a dark ground. A viewer, not a
  // dialog — but Escape closes it now, which it did not.
  useEscapeKey(onClose);
  // Never the Arabic name or title: a certificate lacking either is not shown. The desk's
  // own change on this certificate comes first, as it does on the server's page.
  const certName  = (englishOnly(edits?.nameEn) || englishOnly(studentNameEn)).toUpperCase();
  const certCourse = englishOnly(edits?.courseEn) || englishOnly(courseNameEn) || englishOnly(courseName);
  const typedDuration = String(edits?.duration ?? '').replace(/\s+/g, ' ').trim();
  const duration = typedDuration
    ? (/[\u0600-\u06FF]/.test(typedDuration) ? '' : typedDuration)
    : (Number(hours) > 0 ? `${+Number(hours).toFixed(2)} Hours` : '');
  const trainer = String(edits?.trainer ?? '').replace(/\s+/g, ' ').trim() || String(instructorName || '').trim();
  const incomplete = !certName || !certCourse;

  // The sheet is a fixed 600 px canvas: on a narrower screen it is scaled down to fit.
  const [fit, setFit] = useState(() => Math.min(1, (window.innerWidth - 24) / CERT_W));
  useEffect(() => {
    const onResize = () => setFit(Math.min(1, (window.innerWidth - 24) / CERT_W));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Generated entirely client-side (qrcode npm package) — no network call, so the
  // student's name/course/certificate number is never sent to a third-party service.
  const [qrUrl, setQrUrl] = useState('');
  useEffect(() => {
    if (incomplete) return undefined;
    let cancelled = false;
    QRCode.toDataURL(`CERT:${certNumber}|${certName}|${certCourse}`, {
      width: 90, margin: 1, color: { dark: '#8B0000', light: '#ffffff' },
    }).then(url => { if (!cancelled) setQrUrl(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [certNumber, certName, certCourse, incomplete]);

  // «زر تحميل pdf بتاع العميل مش شغال»: the old button wrote the sheet into a blank window and printed it
  // after 700 ms — before the picture had arrived, and with nothing to say when a pop-up was refused.
  // It now opens the server's own printable page (api/routes/public.js), which prints itself once its
  // picture is loaded and counts the download; the person picks «Save as PDF» there.
  const handlePrint = () => {
    const url = `/api/completions/${encodeURIComponent(certNumber)}/certificate?print=1`;
    const win = window.open(url, '_blank');
    if (!win) window.location.assign(url);
  };

  if (incomplete) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3" onClick={onClose}>
        <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center" dir="rtl" onClick={event => event.stopPropagation()}>
          <h3 className="mb-2 text-lg font-extrabold text-amber-700">شهادتك لسه محتاجة بيانات</h3>
          <p className="text-sm leading-relaxed text-gray-600">
            شهادة المعهد بتتطبع بالإنجليزي فقط، وناقص {!certName ? 'اسمك بالإنجليزي' : 'اسم الكورس بالإنجليزي'}.
            ابعت اسمك بالإنجليزي لخدمة العملاء وهنفتحلك الشهادة فوراً.
          </p>
          <button onClick={onClose} className="mt-4 rounded-xl bg-gray-900 px-5 py-2 text-sm font-bold text-white">تمام</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 overflow-y-auto"
      onClick={onClose}
    >
      <div className="my-auto" style={{ width: CERT_W * fit }} onClick={e => e.stopPropagation()}>

        {/* Toolbar */}
        <div className="flex justify-between items-center mb-3">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 bg-white text-gray-800 font-bold px-5 py-2.5 rounded-xl hover:bg-gray-100 transition text-sm shadow"
          >
            <Printer size={16} /> Print / Save PDF
          </button>
          <button onClick={onClose} className="text-white/70 hover:text-white transition p-1">
            <X size={26} />
          </button>
        </div>

        {/* The sheet is a fixed 600 × 849 canvas (A4 portrait); the wrapper only scales it to the screen. */}
        <div style={{ width: CERT_W * fit, height: CERT_H * fit }}>
          <div style={{ width: CERT_W, height: CERT_H, transform: `scale(${fit})`, transformOrigin: 'top left' }}>
            <CertificateSheet
              certName={certName}
              certCourse={certCourse}
              duration={duration}
              trainer={trainer}
              certNumber={certNumber}
              issuedAt={issuedAt}
              qrUrl={qrUrl}
            />
          </div>
        </div>

      </div>
    </div>
  );
};

export default CourseCertificate;

