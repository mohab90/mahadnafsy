'use strict';

// The institute certificate. The institute supplied the design as one picture
// (api/assets/certificate-template.jpg) and asked for it «مطابق 100%», so the design
// is not redrawn: it IS the picture, and only what changes from client to client is
// written over it. Two ways to print it:
//
//   design  the whole certificate — the picture with the client's name, the course,
//           its duration, the trainer, and the code that opens the public check.
//           What the client sees and downloads on the site.
//   form    the desk's own copy, printed onto the institute's pre-printed paper:
//           nothing but the client's name (17 cm from the top of the sheet) and the
//           course with its duration (22 cm), at a size and weight that suit the
//           design. The trainer is left empty for a pen.
//
// «اسم العميل من اعلى الشهادة على بعد حوالي 17 سم واسم الكورس على بعد 22 سم وتحته مدة الكورس».
// client/components/CertificateSheet.tsx writes the same text over the same picture.

const { escapeHtml } = require('./html');

const TEMPLATE_URL = '/api/certificate-template.jpg';

// The sheet's A4 size is 21 × 29.7 cm; the design canvas is 600 × 849 px.
const FORM_DEFAULTS = { nameTop: 17, courseTop: 22 };
const clampCm = (value, fallback) => {
  const cm = Number(value);
  return Number.isFinite(cm) && cm >= 3 && cm <= 28 ? cm : fallback;
};
/** The two distances from the top, as typed in the query (cm), kept inside the sheet. */
function formOffsets({ nameTop, courseTop } = {}) {
  return { nameTop: clampCm(nameTop, FORM_DEFAULTS.nameTop), courseTop: clampCm(courseTop, FORM_DEFAULTS.courseTop) };
}

// Bold capitals run about 0.74 em each: the name stays on one line, as large as fits.
const fitSize = (text, widthPx, maxPx, minPx) => Math.max(minPx, Math.min(maxPx, Math.floor(widthPx / (String(text).length * 0.74))));

const SERIF = "Georgia,'Times New Roman',serif";

/** The whole certificate: the picture, with the client's own lines written on it. */
function certificateHtml({ studentName, courseName, duration, trainer, serialNo, issuedAt, qrUrl, verifyUrl }) {
  const nameSize = fitSize(studentName, 470, 30, 14);
  const courseSize = fitSize(courseName, 470, 21, 13);
  const lines = [
    `<div style="position:absolute;left:57px;width:486px;top:402px;height:50px;display:flex;align-items:flex-end;justify-content:center;text-align:center;font-family:${SERIF};font-size:${nameSize}px;font-weight:700;color:#B3141B;letter-spacing:1px;line-height:1.2;padding-bottom:3px;white-space:nowrap">${escapeHtml(studentName)}</div>`,
    `<div style="position:absolute;left:57px;width:486px;top:604px;height:48px;display:flex;align-items:center;justify-content:center;text-align:center;font-family:${SERIF};font-size:${courseSize}px;font-weight:700;color:#111;line-height:1.2;white-space:nowrap">${escapeHtml(courseName)}</div>`,
    duration
      ? `<div style="position:absolute;left:57px;width:486px;top:652px;text-align:center;font-family:${SERIF};font-size:15px;font-weight:700;color:#444;letter-spacing:.5px">Duration: ${escapeHtml(duration)}</div>`
      : '',
    trainer
      ? `<div style="position:absolute;left:40px;width:196px;top:708px;height:26px;display:flex;align-items:flex-end;justify-content:center;text-align:center;font-family:${SERIF};font-size:14px;font-weight:700;color:#111;line-height:1.1;padding-bottom:2px">${escapeHtml(trainer)}</div>`
      : '',
  ].join('\n');

  return `<div class="cert" id="cert">
<img src="${TEMPLATE_URL}" alt="" style="position:absolute;left:0;top:0;width:600px;height:849px;display:block"/>
${lines}
<!-- verification: the serial and the code that opens the public check -->
<div style="position:absolute;left:230px;width:140px;top:760px;text-align:center">
  <a href="${escapeHtml(verifyUrl)}" target="_blank"><img src="${qrUrl}" alt="QR" style="width:44px;height:44px;display:inline-block"/></a>
  <div style="font-family:monospace;font-size:8px;color:#777;margin-top:2px;line-height:1.3">${escapeHtml(serialNo)}<br/>${escapeHtml(issuedAt)}</div>
</div>
</div>`;
}

/**
 * The desk's copy for the pre-printed paper: only the name and the course with its
 * duration, in centimetres from the top of an A4 sheet. On screen the picture shows
 * faintly behind them so the desk can see where they will land; it is not printed.
 */
function certificateFormHtml({ studentName, courseName, duration, nameTop, courseTop }) {
  const at = formOffsets({ nameTop, courseTop });
  // The sheet is 21 cm = 595 pt wide; the name may use 17 cm of it.
  const namePt = Math.max(15, Math.min(32, Math.floor(482 / (studentName.length * 0.74))));
  const coursePt = Math.max(13, Math.min(24, Math.floor(482 / (courseName.length * 0.7))));
  const band = (top, height, inner) =>
    `<div style="position:absolute;left:0;width:21cm;top:calc(${top}cm - ${height / 2}cm);height:${height}cm;display:flex;align-items:center;justify-content:center;text-align:center;white-space:nowrap">${inner}</div>`;
  return `<div class="form-sheet" id="cert">
<img class="guide" src="${TEMPLATE_URL}" alt="" style="position:absolute;left:0;top:0;width:21cm;height:29.7cm;opacity:.32"/>
${band(at.nameTop, 1.6, `<span style="font-family:${SERIF};font-size:${namePt}pt;font-weight:800;letter-spacing:.06em;color:#7E0F15">${escapeHtml(studentName)}</span>`)}
${band(at.courseTop, 1.4, `<span style="font-family:${SERIF};font-size:${coursePt}pt;font-weight:800;letter-spacing:.03em;color:#111">${escapeHtml(courseName)}</span>`)}
${duration ? band(at.courseTop + 1.15, 1, `<span style="font-family:${SERIF};font-size:14pt;font-weight:700;letter-spacing:.04em;color:#333">Duration: ${escapeHtml(duration)}</span>`) : ''}
</div>`;
}

module.exports = { certificateHtml, certificateFormHtml, formOffsets, FORM_DEFAULTS, TEMPLATE_URL };
