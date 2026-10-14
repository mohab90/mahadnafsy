'use strict';

// The institute certificate, drawn as the design the institute supplied
// («شكل الشهادة … بالظبط وبالحرف»): a red bowl with the gold medal at the top,
// «INSTITUTE OF PSYCHOLOGICAL STUDIES», the CERTIFICATE heading, «PSYCHOLOGY
// INSTITUTE IS PROUDLY PRESENTED TO», a dotted line for the name, «FOR THE
// SUCCESSFUL COMPLETION OF THE TRAINING COURSE», then Trainer (with the
// institute badge) and Training manager (signature and stamp) at the foot.
//
// One fixed canvas of 600 × 849 (A4 portrait). Every fixed line of text is SVG
// text with a set width, so it sits where the design has it whatever font the
// viewer has; only the name and the course are HTML, so they can wrap.
// client/components/CourseCertificate.tsx draws the same canvas.

const { escapeHtml, safeUrl } = require('./html');

const RED = '#C8161D';
const INK = '#222';

const PATTERN = `
  <defs>
    <pattern id="psy-arcs" width="64" height="64" patternUnits="userSpaceOnUse">
      <circle cx="0" cy="0" r="30" fill="none" stroke="#ececec" stroke-width="1"/>
      <circle cx="0" cy="0" r="20" fill="none" stroke="#ececec" stroke-width="1"/>
      <circle cx="64" cy="64" r="30" fill="none" stroke="#ececec" stroke-width="1"/>
      <circle cx="64" cy="64" r="20" fill="none" stroke="#ececec" stroke-width="1"/>
    </pattern>
    <radialGradient id="psy-gold" cx="38%" cy="32%" r="75%">
      <stop offset="0%" stop-color="#FFF1A6"/>
      <stop offset="45%" stop-color="#E9B80F"/>
      <stop offset="100%" stop-color="#9C6A00"/>
    </radialGradient>
    <linearGradient id="psy-swoosh" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#E4E4E4"/>
      <stop offset="60%" stop-color="#F4F4F4"/>
      <stop offset="100%" stop-color="#EAEAEA"/>
    </linearGradient>
  </defs>`;

// The scalloped medal's edge: 28 points around a circle.
function medalEdge(cx, cy, outer, inner, points) {
  const parts = [];
  for (let i = 0; i < points * 2; i += 1) {
    const angle = (Math.PI * i) / points;
    const radius = i % 2 === 0 ? outer : inner;
    parts.push(`${(cx + radius * Math.sin(angle)).toFixed(1)},${(cy - radius * Math.cos(angle)).toFixed(1)}`);
  }
  return parts.join(' ');
}

/**
 * The certificate's canvas as an HTML string.
 *   studentName, courseName  English only (certificateEnglish.js)
 *   instituteName            «PSYCHOLOGY INSTITUTE» line is fixed by the design
 */
function certificateHtml({ studentName, courseName, trainingManager, serialNo, issuedAt, logoUrl, qrUrl, verifyUrl }) {
  const logo = safeUrl(logoUrl);
  // Bold capitals run about 0.74 em each: the name stays on one line, as large as fits.
  const nameSize = Math.max(14, Math.min(30, Math.floor(470 / (studentName.length * 0.74))));
  const courseSize = courseName.length > 64 ? 14 : courseName.length > 44 ? 17 : 21;
  const manager = String(trainingManager || 'WALID ABDRAHMAN').toUpperCase();
  const logoImage = logo
    ? (x, y, size) => `<image href="${escapeHtml(logo)}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`
    : () => '';

  return `<div class="cert" id="cert">
<svg viewBox="0 0 600 849" width="600" height="849" xmlns="http://www.w3.org/2000/svg" style="position:absolute;left:0;top:0;display:block">${PATTERN}
  <rect width="600" height="849" fill="#fff"/>
  <rect width="600" height="849" fill="url(#psy-arcs)"/>
  <path d="M0 520 C150 565 300 665 600 565 L600 635 C330 735 170 625 0 565 Z" fill="url(#psy-swoosh)" opacity="0.6"/>

  <!-- the red bowl and its gold thread -->
  <path d="M52 0 C128 64 214 80 300 80 C386 80 472 64 548 0 Z" fill="${RED}"/>
  <path d="M96 0 C160 54 228 70 300 70 C372 70 440 54 504 0" fill="none" stroke="#E9B80F" stroke-width="1.4"/>

  <!-- the gold medal -->
  <polygon points="${medalEdge(300, 96, 52, 47, 26)}" fill="url(#psy-gold)" stroke="#B88400" stroke-width="1"/>
  <circle cx="300" cy="96" r="39" fill="none" stroke="#FFF1A6" stroke-width="1.2" opacity="0.8"/>
  <circle cx="300" cy="96" r="37" fill="#F4CB3A" opacity="0.55"/>
  ${logoImage(272, 68, 56)}

  <!-- the heading -->
  <g font-family="Georgia,'Times New Roman',serif" fill="${INK}" text-anchor="middle">
    <text x="300" y="166" font-size="22" textLength="154" lengthAdjust="spacingAndGlyphs">INSTITUTE OF</text>
    <text x="300" y="191" font-size="22" textLength="292" lengthAdjust="spacingAndGlyphs">PSYCHOLOGICAL STUDIES</text>
  </g>
  <g stroke="#8B6B4A" stroke-width="1" fill="none">
    <line x1="178" y1="214" x2="252" y2="214"/>
    <line x1="348" y1="214" x2="425" y2="214"/>
    <path d="M262 214 C270 205 280 205 285 212 C292 218 296 208 300 206 C304 208 308 218 315 212 C320 205 330 205 338 214 C330 223 320 223 315 216 C308 222 304 214 300 212 C296 214 292 222 285 216 C280 223 270 223 262 214 Z"/>
  </g>
  <circle cx="172" cy="214" r="2" fill="#8B6B4A"/><circle cx="431" cy="214" r="2" fill="#8B6B4A"/>
  <text x="300" y="271" font-family="Impact,'Arial Black','Arial Narrow',sans-serif" font-weight="900" font-size="46" fill="${RED}" text-anchor="middle" textLength="300" lengthAdjust="spacingAndGlyphs">CERTIFICATE</text>
  <line x1="166" y1="293" x2="205" y2="293" stroke="${RED}" stroke-width="3"/>
  <line x1="396" y1="293" x2="432" y2="293" stroke="${RED}" stroke-width="3"/>
  <text x="300" y="300" font-family="Impact,'Arial Black',Arial,sans-serif" font-weight="900" font-size="17" fill="${INK}" text-anchor="middle" textLength="178" lengthAdjust="spacingAndGlyphs">OF ACHIEVEMENT</text>
  <g font-family="Georgia,'Times New Roman',serif" text-anchor="middle">
    <text x="300" y="353" font-size="40" fill="${RED}" textLength="488" lengthAdjust="spacingAndGlyphs">PSYCHOLOGY INSTITUTE</text>
    <text x="300" y="394" font-size="28" fill="${INK}" textLength="356" lengthAdjust="spacingAndGlyphs">IS PROUDLY PRESENTED TO</text>
    <text x="300" y="531" font-size="28" fill="${INK}" textLength="446" lengthAdjust="spacingAndGlyphs">FOR THE SUCCESSFUL COMPLETION</text>
    <text x="300" y="572" font-size="28" fill="${INK}" textLength="344" lengthAdjust="spacingAndGlyphs">OF THE TRAINING COURSE</text>
  </g>
  <line x1="57" y1="457" x2="545" y2="457" stroke="#555" stroke-width="1.6" stroke-dasharray="1.6 2.2"/>

  <!-- Trainer, with the institute's badge -->
  <text x="138" y="708" font-family="Impact,'Arial Black',Arial,sans-serif" font-weight="900" font-size="25" fill="#111" text-anchor="middle" textLength="74" lengthAdjust="spacingAndGlyphs">Trainer</text>
  <line x1="81" y1="736" x2="194" y2="736" stroke="#222" stroke-width="1.4"/>
  <rect x="59" y="759" width="153" height="49" rx="14" fill="#fff" stroke="${RED}" stroke-width="1.4"/>
  <g font-family="Tahoma,Arial,sans-serif" font-weight="700" font-size="13" fill="${RED}" text-anchor="end">
    <text x="160" y="780">معهد الدراسات</text>
    <text x="160" y="797">النفسية</text>
  </g>
  ${logoImage(164, 768, 32)}

  <!-- Training manager, with signature and stamp -->
  <text x="449" y="705" font-family="Impact,'Arial Black',Arial,sans-serif" font-weight="900" font-size="25" fill="#111" text-anchor="middle" textLength="190" lengthAdjust="spacingAndGlyphs">Training manager</text>
  <line x1="398" y1="735" x2="509" y2="735" stroke="#222" stroke-width="1.2"/>
  <path transform="translate(0 735) scale(1 0.72) translate(0 -735)" d="M404 733 C412 722 424 721 432 727 C438 731 440 723 446 727 C452 731 458 722 466 718 C470 715 474 706 479 702 C484 700 482 712 476 722 C472 730 476 738 482 733" fill="none" stroke="#1d3e8a" stroke-width="1.5" stroke-linecap="round"/>
  <g transform="rotate(-4 451 775)">
    <rect x="372" y="752" width="158" height="46" rx="13" fill="none" stroke="${RED}" stroke-width="1.4" opacity="0.9"/>
    <g font-family="Arial,sans-serif" font-weight="700" font-size="10" fill="${RED}" text-anchor="middle" opacity="0.92">
      <text x="451" y="772" textLength="116" lengthAdjust="spacingAndGlyphs">${escapeHtml(manager)}</text>
      <text x="451" y="787" textLength="124" lengthAdjust="spacingAndGlyphs">PSY TRAINING MANAGER</text>
    </g>
  </g>
</svg>

<!-- the name, above its dotted line; the course, under the completion line -->
<div style="position:absolute;left:57px;width:486px;top:402px;height:50px;display:flex;align-items:flex-end;justify-content:center;text-align:center;font-family:Georgia,'Times New Roman',serif;font-size:${nameSize}px;font-weight:700;color:${RED};letter-spacing:1px;line-height:1.2;padding-bottom:3px;white-space:nowrap">${escapeHtml(studentName)}</div>
<div style="position:absolute;left:57px;width:486px;top:588px;height:62px;display:flex;align-items:center;justify-content:center;text-align:center;font-family:Georgia,'Times New Roman',serif;font-size:${courseSize}px;font-weight:700;color:#111;line-height:1.3">${escapeHtml(courseName)}</div>

<!-- verification: the serial and the code that opens the public check -->
<div style="position:absolute;left:230px;width:140px;top:760px;text-align:center">
  <a href="${escapeHtml(verifyUrl)}" target="_blank"><img src="${qrUrl}" alt="QR" style="width:44px;height:44px;display:inline-block"/></a>
  <div style="font-family:monospace;font-size:8px;color:#777;margin-top:2px;line-height:1.3">${escapeHtml(serialNo)}<br/>${escapeHtml(issuedAt)}</div>
</div>
</div>`;
}

module.exports = { certificateHtml };
