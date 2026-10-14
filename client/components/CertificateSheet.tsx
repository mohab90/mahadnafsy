import React from 'react';
import { certificateLogoError } from '../lib/certificateLogo';

// The institute certificate, drawn as the design the institute supplied
// («شكل الشهاده … بالظبط وبالحرف»). One fixed canvas of 600 × 849 (A4 portrait);
// every fixed line of text is SVG text with a set width, so it sits where the
// design has it whatever font the viewer has. Only the name and the course are
// HTML, so they can shrink to fit. api/lib/certificateHtml.js draws the same sheet.

export const CERT_W = 600;
export const CERT_H = 849;

const RED = '#C8161D';
const INK = '#222';
const SERIF = "Georgia, 'Times New Roman', serif";
const HEAVY = "Impact, 'Arial Black', Arial, sans-serif";

// The scalloped medal's edge: 26 points around a circle.
const MEDAL_EDGE = Array.from({ length: 52 }, (_, i) => {
  const angle = (Math.PI * i) / 26;
  const radius = i % 2 === 0 ? 52 : 47;
  return `${(300 + radius * Math.sin(angle)).toFixed(1)},${(96 - radius * Math.cos(angle)).toFixed(1)}`;
}).join(' ');

interface CertificateSheetProps {
  certName: string;
  certCourse: string;
  certNumber: string;
  issuedAt: string;
  logoUrl: string;
  qrUrl: string;
  trainingManager?: string;
}

const CertificateSheet: React.FC<CertificateSheetProps> = ({
  certName, certCourse, certNumber, issuedAt, logoUrl, qrUrl, trainingManager = 'WALID ABDRAHMAN',
}) => {
  // Bold capitals run about 0.74 em each: the name stays on one line, as large as fits.
  const nameSize = Math.max(14, Math.min(30, Math.floor(470 / (certName.length * 0.74))));
  const courseSize = certCourse.length > 64 ? 14 : certCourse.length > 44 ? 17 : 21;
  // The logo is an <img> over the drawing, so a missing file can fall back to the old one.
  const logo = (x: number, y: number, size: number) => (
    <img
      src={logoUrl}
      alt=""
      onError={certificateLogoError}
      style={{ position: 'absolute', left: x, top: y, width: size, height: size, objectFit: 'contain' }}
    />
  );

  return (
    <div
      id="psy-cert-printable"
      style={{ width: CERT_W, height: CERT_H, background: '#fff', position: 'relative', overflow: 'hidden', fontFamily: SERIF }}
    >
      <svg viewBox="0 0 600 849" width={CERT_W} height={CERT_H} xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', left: 0, top: 0, display: 'block' }}>
        <defs>
          <pattern id="psy-arcs" width="64" height="64" patternUnits="userSpaceOnUse">
            <circle cx="0" cy="0" r="30" fill="none" stroke="#ececec" strokeWidth="1" />
            <circle cx="0" cy="0" r="20" fill="none" stroke="#ececec" strokeWidth="1" />
            <circle cx="64" cy="64" r="30" fill="none" stroke="#ececec" strokeWidth="1" />
            <circle cx="64" cy="64" r="20" fill="none" stroke="#ececec" strokeWidth="1" />
          </pattern>
          <radialGradient id="psy-gold" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#FFF1A6" />
            <stop offset="45%" stopColor="#E9B80F" />
            <stop offset="100%" stopColor="#9C6A00" />
          </radialGradient>
          <linearGradient id="psy-swoosh" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#E4E4E4" />
            <stop offset="60%" stopColor="#F4F4F4" />
            <stop offset="100%" stopColor="#EAEAEA" />
          </linearGradient>
        </defs>
        <rect width="600" height="849" fill="#fff" />
        <rect width="600" height="849" fill="url(#psy-arcs)" />
        <path d="M0 520 C150 565 300 665 600 565 L600 635 C330 735 170 625 0 565 Z" fill="url(#psy-swoosh)" opacity="0.6" />

        {/* the red bowl and its gold thread */}
        <path d="M52 0 C128 64 214 80 300 80 C386 80 472 64 548 0 Z" fill={RED} />
        <path d="M96 0 C160 54 228 70 300 70 C372 70 440 54 504 0" fill="none" stroke="#E9B80F" strokeWidth="1.4" />

        {/* the gold medal */}
        <polygon points={MEDAL_EDGE} fill="url(#psy-gold)" stroke="#B88400" strokeWidth="1" />
        <circle cx="300" cy="96" r="39" fill="none" stroke="#FFF1A6" strokeWidth="1.2" opacity="0.8" />
        <circle cx="300" cy="96" r="37" fill="#F4CB3A" opacity="0.55" />

        {/* the heading */}
        <g fontFamily={SERIF} fill={INK} textAnchor="middle">
          <text x="300" y="166" fontSize="22" textLength="154" lengthAdjust="spacingAndGlyphs">INSTITUTE OF</text>
          <text x="300" y="191" fontSize="22" textLength="292" lengthAdjust="spacingAndGlyphs">PSYCHOLOGICAL STUDIES</text>
        </g>
        <g stroke="#8B6B4A" strokeWidth="1" fill="none">
          <line x1="178" y1="214" x2="252" y2="214" />
          <line x1="348" y1="214" x2="425" y2="214" />
          <path d="M262 214 C270 205 280 205 285 212 C292 218 296 208 300 206 C304 208 308 218 315 212 C320 205 330 205 338 214 C330 223 320 223 315 216 C308 222 304 214 300 212 C296 214 292 222 285 216 C280 223 270 223 262 214 Z" />
        </g>
        <circle cx="172" cy="214" r="2" fill="#8B6B4A" />
        <circle cx="431" cy="214" r="2" fill="#8B6B4A" />
        <text x="300" y="271" fontFamily={HEAVY} fontWeight={900} fontSize="46" fill={RED} textAnchor="middle" textLength="300" lengthAdjust="spacingAndGlyphs">CERTIFICATE</text>
        <line x1="166" y1="293" x2="205" y2="293" stroke={RED} strokeWidth="3" />
        <line x1="396" y1="293" x2="432" y2="293" stroke={RED} strokeWidth="3" />
        <text x="300" y="300" fontFamily={HEAVY} fontWeight={900} fontSize="17" fill={INK} textAnchor="middle" textLength="178" lengthAdjust="spacingAndGlyphs">OF ACHIEVEMENT</text>
        <g fontFamily={SERIF} textAnchor="middle">
          <text x="300" y="353" fontSize="40" fill={RED} textLength="488" lengthAdjust="spacingAndGlyphs">PSYCHOLOGY INSTITUTE</text>
          <text x="300" y="394" fontSize="28" fill={INK} textLength="356" lengthAdjust="spacingAndGlyphs">IS PROUDLY PRESENTED TO</text>
          <text x="300" y="531" fontSize="28" fill={INK} textLength="446" lengthAdjust="spacingAndGlyphs">FOR THE SUCCESSFUL COMPLETION</text>
          <text x="300" y="572" fontSize="28" fill={INK} textLength="344" lengthAdjust="spacingAndGlyphs">OF THE TRAINING COURSE</text>
        </g>
        <line x1="57" y1="457" x2="545" y2="457" stroke="#555" strokeWidth="1.6" strokeDasharray="1.6 2.2" />

        {/* Trainer, with the institute's badge */}
        <text x="138" y="708" fontFamily={HEAVY} fontWeight={900} fontSize="25" fill="#111" textAnchor="middle" textLength="74" lengthAdjust="spacingAndGlyphs">Trainer</text>
        <line x1="81" y1="736" x2="194" y2="736" stroke="#222" strokeWidth="1.4" />
        <rect x="59" y="759" width="153" height="49" rx="14" fill="#fff" stroke={RED} strokeWidth="1.4" />
        <g fontFamily="Tahoma, Arial, sans-serif" fontWeight={700} fontSize="13" fill={RED} textAnchor="end">
          <text x="160" y="780">معهد الدراسات</text>
          <text x="160" y="797">النفسية</text>
        </g>

        {/* Training manager, with signature and stamp */}
        <text x="449" y="705" fontFamily={HEAVY} fontWeight={900} fontSize="25" fill="#111" textAnchor="middle" textLength="190" lengthAdjust="spacingAndGlyphs">Training manager</text>
        <line x1="398" y1="735" x2="509" y2="735" stroke="#222" strokeWidth="1.2" />
        <path transform="translate(0 735) scale(1 0.72) translate(0 -735)" d="M404 733 C412 722 424 721 432 727 C438 731 440 723 446 727 C452 731 458 722 466 718 C470 715 474 706 479 702 C484 700 482 712 476 722 C472 730 476 738 482 733" fill="none" stroke="#1d3e8a" strokeWidth="1.5" strokeLinecap="round" />
        <g transform="rotate(-4 451 775)">
          <rect x="372" y="752" width="158" height="46" rx="13" fill="none" stroke={RED} strokeWidth="1.4" opacity="0.9" />
          <g fontFamily="Arial, sans-serif" fontWeight={700} fontSize="10" fill={RED} textAnchor="middle" opacity="0.92">
            <text x="451" y="772" textLength="116" lengthAdjust="spacingAndGlyphs">{trainingManager.toUpperCase()}</text>
            <text x="451" y="787" textLength="124" lengthAdjust="spacingAndGlyphs">PSY TRAINING MANAGER</text>
          </g>
        </g>
      </svg>

      {logo(272, 68, 56)}
      {logo(164, 768, 32)}

      {/* the name, above its dotted line; the course, under the completion line */}
      <div style={{
        position: 'absolute', left: 57, width: 486, top: 402, height: 50,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', textAlign: 'center',
        fontFamily: SERIF, fontSize: nameSize, fontWeight: 700, color: RED, letterSpacing: 1,
        lineHeight: 1.2, paddingBottom: 3, whiteSpace: 'nowrap',
      }}>{certName}</div>
      <div style={{
        position: 'absolute', left: 57, width: 486, top: 588, height: 62,
        display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        fontFamily: SERIF, fontSize: courseSize, fontWeight: 700, color: '#111', lineHeight: 1.3,
      }}>{certCourse}</div>

      {/* verification: the serial, and the code that opens the public check */}
      <div style={{ position: 'absolute', left: 230, width: 140, top: 760, textAlign: 'center' }}>
        {qrUrl && <img src={qrUrl} alt="QR" style={{ width: 44, height: 44, display: 'inline-block' }} />}
        <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#777', marginTop: 2, lineHeight: 1.3 }}>
          {certNumber}<br />{issuedAt}
        </div>
      </div>
    </div>
  );
};

export default CertificateSheet;
