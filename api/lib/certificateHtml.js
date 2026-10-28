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
// «اسم العميل بيظهر تحت الخط شوية محتاجين نرفعه 1 سم» (15 Oct 2026): the name sits at 16 cm now, the course a little lower.
const FORM_DEFAULTS = { nameTop: 16, courseTop: 22.6 };
const clampCm = (value, fallback) => {
  const cm = Number(value);
  return Number.isFinite(cm) && cm >= 3 && cm <= 28 ? cm : fallback;
};
/** The two distances from the top, as typed in the query (cm), kept inside the sheet. */
function formOffsets({ nameTop, courseTop } = {}) {
  return { nameTop: clampCm(nameTop, FORM_DEFAULTS.nameTop), courseTop: clampCm(courseTop, FORM_DEFAULTS.courseTop) };
}

/**
 * All four distances from the top (cm), for the layout the desk fixed (tenant setting `certificate_form_layout`): the name, the course, the
 * training hours under it and the certificate's code. Unset hours sit 1.25 cm under the course and the code 0.8 cm under the hours.
 */
function formLayout({ nameTop, courseTop, hoursTop, codeTop } = {}) {
  const base = formOffsets({ nameTop, courseTop });
  const hours = clampCm(hoursTop, Math.round((base.courseTop + 1.25) * 100) / 100);
  return { ...base, hoursTop: hours, codeTop: clampCm(codeTop, Math.round((hours + 0.8) * 100) / 100) };
}

// Bold capitals run about 0.74 em each: the name stays on one line, as large as fits.
const fitSize = (text, widthPx, maxPx, minPx) => Math.max(minPx, Math.min(maxPx, Math.floor(widthPx / (String(text).length * 0.74))));

const SERIF = "Georgia,'Times New Roman',serif";

/**
 * «completed 60 training hours in 2026» — under the course, in its own lettering, a little smaller.
 * The hours are the course's («60 Hours» → 60); a duration that is not hours is written as it is.
 */
function trainingLine(duration, year) {
  const text = String(duration || '').trim();
  if (!text) return '';
  const hours = /^(\d+(?:\.\d+)?)\s*hours?$/i.exec(text);
  const when = year ? ` in ${escapeHtml(String(year))}` : '';
  return hours ? `completed ${hours[1]} training hours${when}` : `completed ${escapeHtml(text)} of training${when}`;
}

/** The whole certificate: the picture, with the client's own lines written on it. */
function certificateHtml({ studentName, courseName, duration, trainer, serialNo, issuedAt, qrUrl, verifyUrl, certCode, year }) {
  const nameSize = fitSize(studentName, 470, 30, 14);
  // «كبر حجم اسم الكورس وخليه بولد واسود فاقع وتحت شوية»: larger, solid black, lower; the sentence under
  // it is the same lettering, a little smaller, and the certificate's own code under that.
  const courseSize = fitSize(courseName, 480, 29, 15);
  const line = trainingLine(duration, year);
  const lineSize = Math.max(11, Math.round(courseSize * 0.62));
  const lines = [
    `<div style="position:absolute;left:57px;width:486px;top:398px;height:50px;display:flex;align-items:flex-end;justify-content:center;text-align:center;font-family:${SERIF};font-size:${nameSize}px;font-weight:900;color:#000;letter-spacing:1px;line-height:1.2;padding-bottom:3px;white-space:nowrap">${escapeHtml(studentName)}</div>`,
    `<div style="position:absolute;left:57px;width:486px;top:604px;height:54px;display:flex;align-items:center;justify-content:center;text-align:center;font-family:${SERIF};font-size:${courseSize}px;font-weight:900;color:#000;line-height:1.15;white-space:nowrap">${escapeHtml(courseName)}</div>`,
    line
      ? `<div style="position:absolute;left:57px;width:486px;top:658px;text-align:center;font-family:${SERIF};font-size:${lineSize}px;font-weight:900;color:#000;line-height:1.2;white-space:nowrap">${line}</div>`
      : '',
    certCode
      ? `<div style="position:absolute;left:57px;width:486px;top:${line ? 681 : 664}px;text-align:center;font-family:monospace;font-size:9px;font-weight:700;letter-spacing:.4px;color:#333">${escapeHtml(certCode)}</div>`
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
function certificateFormHtml({ studentName, courseName, duration, nameTop, courseTop, hoursTop, codeTop, certCode, year }) {
  const at = formLayout({ nameTop, courseTop, hoursTop, codeTop });
  // The sheet is 21 cm = 595 pt wide; the name may use 17 cm of it.
  const namePt = Math.max(15, Math.min(32, Math.floor(482 / (studentName.length * 0.74))));
  const coursePt = Math.max(15, Math.min(30, Math.floor(482 / (courseName.length * 0.68))));
  const line = trainingLine(duration, year);
  const linePt = Math.max(12, Math.round(coursePt * 0.62));
  const band = (top, height, inner) =>
    `<div style="position:absolute;left:0;width:21cm;top:calc(${top}cm - ${height / 2}cm);height:${height}cm;display:flex;align-items:center;justify-content:center;text-align:center;white-space:nowrap">${inner}</div>`;
  return `<div class="form-sheet" id="cert">
<img class="guide" src="${TEMPLATE_URL}" alt="" style="position:absolute;left:0;top:0;width:21cm;height:29.7cm;opacity:.32"/>
${band(at.nameTop, 1.6, `<span style="font-family:${SERIF};font-size:${namePt}pt;font-weight:900;letter-spacing:.06em;color:#000">${escapeHtml(studentName)}</span>`)}
${band(at.courseTop, 1.6, `<span style="font-family:${SERIF};font-size:${coursePt}pt;font-weight:900;letter-spacing:.02em;color:#000">${escapeHtml(courseName)}</span>`)}
${line ? band(at.hoursTop, 1, `<span style="font-family:${SERIF};font-size:${linePt}pt;font-weight:900;letter-spacing:.02em;color:#000">${line}</span>`) : ''}
${certCode ? band(line ? at.codeTop : at.courseTop + 1.25, 0.7, `<span style="font-family:monospace;font-size:8.5pt;font-weight:700;letter-spacing:.08em;color:#333">${escapeHtml(certCode)}</span>`) : ''}
</div>`;
}

module.exports = { certificateHtml, certificateFormHtml, formLayout, formOffsets, trainingLine, FORM_DEFAULTS, TEMPLATE_URL };
