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

const CertificateSheet: React.FC<CertificateSheetProps> = ({ certName, certCourse, duration, trainer, certNumber, issuedAt, qrUrl }) => (
  <div
    id="psy-cert-printable"
    style={{ width: CERT_W, height: CERT_H, background: '#fff', position: 'relative', overflow: 'hidden', fontFamily: SERIF }}
  >
    <img src={CERT_TEMPLATE} alt="" style={{ position: 'absolute', left: 0, top: 0, width: CERT_W, height: CERT_H, display: 'block' }} />

    <div style={{
      position: 'absolute', left: 57, width: 486, top: 402, height: 50,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', textAlign: 'center',
      fontSize: fitSize(certName, 470, 30, 14), fontWeight: 700, color: '#B3141B', letterSpacing: 1,
      lineHeight: 1.2, paddingBottom: 3, whiteSpace: 'nowrap',
    }}>{certName}</div>
    <div style={{
      position: 'absolute', left: 57, width: 486, top: 604, height: 48,
      display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
      fontSize: fitSize(certCourse, 470, 21, 13), fontWeight: 700, color: '#111', lineHeight: 1.2, whiteSpace: 'nowrap',
    }}>{certCourse}</div>
    {duration && (
      <div style={{ position: 'absolute', left: 57, width: 486, top: 652, textAlign: 'center', fontSize: 15, fontWeight: 700, color: '#444', letterSpacing: 0.5 }}>
        Duration: {duration}
      </div>
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

export default CertificateSheet;
