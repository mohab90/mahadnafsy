import React from 'react';

// The institute certificate. The institute supplied the design as one picture
// («مطابق 100%»), so it is not redrawn: the picture is the certificate, and only
// what changes from client to client is written over it — the client's name above
// the dotted line, the course and its duration under «OF THE TRAINING COURSE», the
// trainer's name on the trainer's line, and the code that opens the public check.
// api/lib/certificateHtml.js writes the same lines over the same picture.

export const CERT_W = 600;
export const CERT_H = 849;
export const CERT_TEMPLATE = '/api/certificate-template.jpg';

const SERIF = "Georgia, 'Times New Roman', serif";

// Bold capitals run about 0.74 em each: a line stays on one line, as large as fits.
const fitSize = (text: string, width: number, max: number, min: number) =>
  Math.max(min, Math.min(max, Math.floor(width / (text.length * 0.74))));

interface CertificateSheetProps {
  certName: string;
  certCourse: string;
  /** «60 Hours» — empty when the course has none. */
  duration: string;
  /** The course's trainer; empty leaves the line for a pen. */
  trainer: string;
  certNumber: string;
  issuedAt: string;
  qrUrl: string;
}

/** «completed 60 training hours in 2026»: the hours of «60 Hours», the year of the issue date. */
const trainingLine = (duration: string, issuedAt: string) => {
  const text = duration.trim();
  if (!text) return '';
  const year = /\b(20\d{2})\b/.exec(issuedAt)?.[1];
  const hours = /^(\d+(?:\.\d+)?)\s*hours?$/i.exec(text);
  return hours ? `completed ${hours[1]} training hours${year ? ` in ${year}` : ''}` : `completed ${text} of training${year ? ` in ${year}` : ''}`;
};

const CertificateSheet: React.FC<CertificateSheetProps> = ({ certName, certCourse, duration, trainer, certNumber, issuedAt, qrUrl }) => {
  const courseSize = fitSize(certCourse, 480, 29, 15);
  const line = trainingLine(duration, issuedAt);
  return (
  <div
    id="psy-cert-printable"
    style={{ width: CERT_W, height: CERT_H, background: '#fff', position: 'relative', overflow: 'hidden', fontFamily: SERIF }}
  >
    <img src={CERT_TEMPLATE} alt="" style={{ position: 'absolute', left: 0, top: 0, width: CERT_W, height: CERT_H, display: 'block' }} />

    <div style={{
      position: 'absolute', left: 57, width: 486, top: 373, height: 50,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', textAlign: 'center',
      fontSize: fitSize(certName, 470, 30, 14), fontWeight: 700, color: '#B3141B', letterSpacing: 1,
      lineHeight: 1.2, paddingBottom: 3, whiteSpace: 'nowrap',
    }}>{certName}</div>
    {/* The course: larger, solid black, lower; the sentence under it in the same lettering, a little smaller;
        then the certificate's own code (api/lib/certificateHtml.js writes the same). */}
    <div style={{
      position: 'absolute', left: 57, width: 486, top: 604, height: 54,
      display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
      fontSize: courseSize, fontWeight: 900, color: '#000', lineHeight: 1.15, whiteSpace: 'nowrap',
    }}>{certCourse}</div>
    {line && (
      <div style={{ position: 'absolute', left: 57, width: 486, top: 658, textAlign: 'center', fontSize: Math.max(11, Math.round(courseSize * 0.62)), fontWeight: 900, color: '#000', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
        {line}
      </div>
    )}
    {certNumber && (
      <div style={{ position: 'absolute', left: 57, width: 486, top: line ? 681 : 664, textAlign: 'center', fontFamily: 'monospace', fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: '#333' }}>{certNumber}</div>
    )}
    {trainer && (
      <div style={{
        position: 'absolute', left: 40, width: 196, top: 708, height: 26,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', textAlign: 'center',
        fontSize: 14, fontWeight: 700, color: '#111', lineHeight: 1.1, paddingBottom: 2,
      }}>{trainer}</div>
    )}

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
