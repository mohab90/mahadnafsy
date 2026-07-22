import React, { useEffect, useState } from 'react';
import { X, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { useSiteData } from '../context/SiteDataContext';

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
}

const FALLBACK_LOGO = 'https://h.top4top.io/p_3734xfq501.png';

const CourseCertificate: React.FC<CourseCertificateProps> = ({
  studentName, studentNameEn, courseName, courseNameEn,
  certNumber, issuedAt, onClose,
}) => {
  const { content } = useSiteData();
  const LOGO_URL = content['institute.logo'] || FALLBACK_LOGO;
  const certName  = (studentNameEn || studentName).toUpperCase();
  const certCourse = courseNameEn || courseName;

  // Generated entirely client-side (qrcode npm package) — no network call, so the
  // student's name/course/certificate number is never sent to a third-party service.
  const [qrUrl, setQrUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(`CERT:${certNumber}|${certName}|${certCourse}`, {
      width: 90, margin: 1, color: { dark: '#8B0000', light: '#ffffff' },
    }).then(url => { if (!cancelled) setQrUrl(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [certNumber, certName, certCourse]);

  const handlePrint = () => {
    const el = document.getElementById('psy-cert-printable');
    if (!el) return;
    const win = window.open('', '_blank', 'width=700,height=1050');
    if (!win) { window.print(); return; }
    win.document.write(`<!DOCTYPE html>
      <html lang="en"><head>
        <meta charset="UTF-8"/>
        <title>Certificate – ${certName}</title>
        <style>
          @page { size: A4 portrait; margin: 5mm; }
          body { margin:0; padding:0; background:white; }
          * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        </style>
      </head>
      <body>${el.outerHTML}</body>
    </html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 700);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 overflow-y-auto"
      onClick={onClose}
    >
      <div className="w-full max-w-[600px] my-auto" onClick={e => e.stopPropagation()}>

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

        {/* ══════════════ CERTIFICATE ══════════════ */}
        <div
          id="psy-cert-printable"
          style={{
            background: 'white',
            fontFamily: "Georgia, 'Times New Roman', serif",
            position: 'relative',
            overflow: 'hidden',
            border: '1px solid #e0e0e0',
          }}
        >
          {/* ── Top swoosh ── */}
          <svg
            viewBox="0 0 595 210"
            xmlns="http://www.w3.org/2000/svg"
            style={{ display: 'block', width: '100%', marginBottom: -2 }}
            preserveAspectRatio="none"
          >
            {/* Amber/gold backing ribbon */}
            <path d="M 0 0 L 0 205 Q 100 155 297 172 Q 494 189 595 148 L 595 0 Z" fill="#D97706"/>
            {/* Red main swoosh */}
            <path d="M 0 0 L 0 188 Q 100 138 297 155 Q 494 172 595 132 L 595 0 Z" fill="#B91C1C"/>
            {/* Amber accent — top-left wing */}
            <path d="M 0 0 L 152 12 Q 68 58 0 120 Z" fill="#F59E0B" opacity="0.55"/>
            {/* Amber accent — top-right wing */}
            <path d="M 595 0 L 443 12 Q 527 58 595 120 Z" fill="#F59E0B" opacity="0.55"/>
          </svg>

          {/* Gold medal — floats over the swoosh */}
          <div style={{
            position: 'absolute', top: '22px', left: '50%',
            transform: 'translateX(-50%)',
            width: '82px', height: '82px', borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 32%, #FEF3C7, #F59E0B 52%, #92400E)',
            boxShadow: '0 4px 18px rgba(0,0,0,0.45), 0 0 0 4px #FCD34D',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10,
          }}>
            <img
              src={LOGO_URL}
              style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'contain' }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>

          {/* ── Body ── */}
          <div style={{ padding: '24px 50px 0', textAlign: 'center' }}>

            {/* CERTIFICATE heading */}
            <div style={{ fontSize: '42px', fontWeight: '900', letterSpacing: '7px', color: '#111', lineHeight: 1 }}>
              CERTIFICATE
            </div>
            <div style={{ fontSize: '14px', letterSpacing: '8px', color: '#666', marginTop: '5px', marginBottom: '12px', fontStyle: 'italic' }}>
              OF ACHIEVEMENT
            </div>

            {/* Decorative divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '0 40px 14px' }}>
              <div style={{ flex: 1, height: '2px', background: 'linear-gradient(to right, transparent, #B91C1C)' }} />
              <div style={{ display: 'flex', gap: '4px' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#D97706' }} />
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#B91C1C' }} />
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#D97706' }} />
              </div>
              <div style={{ flex: 1, height: '2px', background: 'linear-gradient(to left, transparent, #B91C1C)' }} />
            </div>

            {/* Institute name */}
            <div style={{ fontSize: '22px', fontWeight: '900', color: '#B91C1C', letterSpacing: '2px', marginBottom: '5px' }}>
              PSYCHOLOGY INSTITUTE
            </div>
            <div style={{ fontSize: '11px', letterSpacing: '5px', color: '#777', marginBottom: '16px' }}>
              IS PROUDLY PRESENTED TO
            </div>

            {/* Student name */}
            <div style={{
              fontSize: certName.length > 28 ? '20px' : '27px',
              fontWeight: '900', color: '#B91C1C', letterSpacing: '2px',
              padding: '10px 16px',
              borderTop: '2px solid #B91C1C', borderBottom: '2px solid #B91C1C',
              margin: '0 24px 16px', lineHeight: 1.4,
              minHeight: '54px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {certName}
            </div>

            {/* Completion text */}
            <div style={{ fontSize: '12px', color: '#444', letterSpacing: '2px', lineHeight: 2 }}>
              FOR THE SUCCESSFUL COMPLETION
            </div>
            <div style={{ fontSize: '12px', color: '#444', letterSpacing: '2px', lineHeight: 2, marginBottom: '10px' }}>
              OF THE TRAINING COURSE
            </div>

            {/* Course name */}
            <div style={{
              fontSize: certCourse.length > 50 ? '13px' : '16px',
              fontWeight: '700', color: '#1a1a1a',
              margin: '0 16px 16px', letterSpacing: '0.5px', lineHeight: 1.5,
              padding: '8px 16px',
              background: '#fafafa', border: '1px solid #eee', borderRadius: '4px',
            }}>
              {certCourse}
            </div>
          </div>

          {/* ── Footer ── */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
            padding: '8px 36px 0', borderTop: '1px solid #eee', gap: '8px',
          }}>

            {/* Trainer */}
            <div style={{ textAlign: 'center', minWidth: '135px' }}>
              <div style={{ fontSize: '13px', fontWeight: '800', marginBottom: '10px', letterSpacing: '0.5px' }}>Trainer</div>
              <div style={{ width: '88px', height: '30px', borderBottom: '2px solid #333', margin: '0 auto 8px' }} />
              <div style={{
                border: '1px solid #ccc', borderRadius: '4px', padding: '5px 8px',
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                fontSize: '10px', color: '#555', direction: 'rtl',
              }}>
                <img
                  src={LOGO_URL}
                  style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'contain', flexShrink: 0 }}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                معهد الدراسات النفسية
              </div>
            </div>

            {/* Center: ribbon badge + serial */}
            <div style={{ textAlign: 'center', flex: 1 }}>
              <svg width="52" height="68" viewBox="0 0 52 68" style={{ display: 'block', margin: '0 auto 6px' }}>
                <defs>
                  <radialGradient id="mg" cx="35%" cy="32%">
                    <stop offset="0%" stopColor="#FEF3C7"/>
                    <stop offset="55%" stopColor="#F59E0B"/>
                    <stop offset="100%" stopColor="#92400E"/>
                  </radialGradient>
                </defs>
                <circle cx="26" cy="22" r="20" fill="url(#mg)" stroke="#B45309" strokeWidth="2"/>
                <text x="26" y="29" textAnchor="middle" fontSize="20" fill="#7C2D12" fontWeight="bold">★</text>
                {/* ribbon left */}
                <polygon points="14,40 20,40 17,68 9,60" fill="#B91C1C"/>
                {/* ribbon right */}
                <polygon points="32,40 38,40 43,60 35,68" fill="#B91C1C"/>
              </svg>
              <div style={{ fontSize: '8px', color: '#999', letterSpacing: '1px', textTransform: 'uppercase' }}>Serial No.</div>
              <div style={{ fontSize: '11px', fontWeight: '700', fontFamily: 'monospace', color: '#B91C1C', marginTop: '2px' }}>
                {certNumber}
              </div>
              <div style={{ fontSize: '8px', color: '#aaa', marginTop: '2px' }}>{issuedAt}</div>
            </div>

            {/* Training Manager */}
            <div style={{ textAlign: 'center', minWidth: '135px' }}>
              <div style={{ fontSize: '13px', fontWeight: '800', marginBottom: '10px', letterSpacing: '0.5px' }}>Training Manager</div>
              <div style={{ width: '88px', height: '30px', borderBottom: '2px solid #333', margin: '0 auto 8px' }} />
              <div style={{
                border: '1px solid #ccc', borderRadius: '4px', padding: '5px 8px',
                fontSize: '9px', color: '#555', lineHeight: '1.5',
              }}>
                <div style={{ fontWeight: '800' }}>WALID ABDRAHMAN</div>
                <div>PSY TRAINING MANAGER</div>
              </div>
            </div>
          </div>

          {/* QR row */}
          <div style={{ textAlign: 'center', padding: '10px 0 0' }}>
            <img src={qrUrl} alt="QR" style={{ width: '54px', height: '54px', display: 'inline-block' }} />
            <div style={{ fontSize: '8px', color: '#bbb', marginTop: '2px' }}>Scan to verify certificate authenticity</div>
          </div>

          {/* ── Bottom swoosh ── */}
          <svg
            viewBox="0 0 595 62"
            xmlns="http://www.w3.org/2000/svg"
            style={{ display: 'block', width: '100%', marginTop: -1 }}
            preserveAspectRatio="none"
          >
            <path d="M 0 62 L 0 32 Q 150 2 297 22 Q 444 42 595 12 L 595 62 Z" fill="#D97706"/>
            <path d="M 0 62 L 0 42 Q 150 12 297 32 Q 444 52 595 22 L 595 62 Z" fill="#B91C1C"/>
          </svg>
        </div>

      </div>
    </div>
  );
};

export default CourseCertificate;

