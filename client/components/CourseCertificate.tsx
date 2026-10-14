import React, { useEffect, useState } from 'react';
import { useEscapeKey } from '../../shared/ui/useEscapeKey';
import { X, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { useSiteData } from '../context/SiteDataContext';
import { BRAND_LOGO } from '../lib/brand';
import CertificateSheet, { CERT_W, CERT_H } from './CertificateSheet';

interface CourseCertificateProps {
  studentName: string;
  studentNameEn?: string;   // English name shown on certificate
  courseName: string;
  courseNameEn?: string;    // English course name for certificate
  instructorName: string;
  lectureCount?: number;
  hoursLabel?: string;
  certNumber: string;       // = clientCode (serial number)
  issuedAt: string;
  onClose: () => void;
  /** Told when the client prints or saves it (the desk sees it as downloaded). */
  onPrinted?: () => void;
}

// The certificate carries the name and the course in English only («مينفعش بالعربي
// في الشهادة دي»): Latin letters, no Arabic. The server holds the same rule
// (api/lib/certificateEnglish.js).
const englishOnly = (value?: string | null) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text && /[A-Za-z]/.test(text) && !/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text) ? text : '';
};

const CourseCertificate: React.FC<CourseCertificateProps> = ({
  studentName, studentNameEn, courseName, courseNameEn,
  certNumber, issuedAt, onClose, onPrinted,
}) => {
  // The certificate itself, full-bleed on a dark ground. A viewer, not a
  // dialog — but Escape closes it now, which it did not.
  useEscapeKey(onClose);
  const { content } = useSiteData();
  const LOGO_URL = content['institute.logo'] || BRAND_LOGO;
  // Never the Arabic name or title: a certificate lacking either is not shown.
  const certName  = englishOnly(studentNameEn).toUpperCase();
  const certCourse = englishOnly(courseNameEn) || englishOnly(courseName);
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

  const handlePrint = () => {
    const el = document.getElementById('psy-cert-printable');
    if (!el) return;
    onPrinted?.();
    const win = window.open('', '_blank', 'width=700,height=1050');
    if (!win) { window.print(); return; }
    win.document.write(`<!DOCTYPE html>
      <html lang="en"><head>
        <meta charset="UTF-8"/>
        <title>Certificate – ${certName}</title>
        <style>
          @page { size: A4 portrait; margin: 0; }
          body { margin:0; padding:0; background:white; }
          #psy-cert-printable { zoom: 1.32; }
          * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        </style>
      </head>
      <body>${el.outerHTML}</body>
    </html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 700);
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
              certNumber={certNumber}
              issuedAt={issuedAt}
              logoUrl={LOGO_URL}
              qrUrl={qrUrl}
            />
          </div>
        </div>

      </div>
    </div>
  );
};

export default CourseCertificate;

